use super::*;
use futures_util::{SinkExt, StreamExt};
use std::{
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{Semaphore, mpsc},
    task::JoinSet,
    time::{Instant, interval, timeout, timeout_at},
};
use tokio_tungstenite::{
    WebSocketStream, accept_hdr_async_with_config,
    tungstenite::{
        Message,
        handshake::server::{Callback, ErrorResponse, Request, Response},
        protocol::WebSocketConfig,
    },
};

pub(super) async fn serve(
    bridge: Bridge,
    listener: TcpListener,
    mut stopped: watch::Receiver<bool>,
) {
    let permits = Arc::new(Semaphore::new(32));
    let mut connections = JoinSet::new();
    let mut rate_window = Instant::now();
    let mut accepted = 0;
    loop {
        tokio::select! {
            biased;
            _ = stopped.changed() => break,
            Some(_) = connections.join_next(), if !connections.is_empty() => {},
            socket = listener.accept() => {
                let Ok((socket, peer)) = socket else { break; };
                if !peer.ip().is_loopback() { continue; }
                if rate_window.elapsed() >= Duration::from_secs(1) { rate_window = Instant::now(); accepted = 0; }
                accepted += 1;
                if accepted > 16 { continue; }
                let Ok(permit) = permits.clone().try_acquire_owned() else { continue; };
                let bridge = bridge.clone();
                let stopped = stopped.clone();
                connections.spawn(async move {
                    let _permit = permit;
                    connection(bridge, socket, stopped).await;
                });
            }
        }
    }
    // Cancellation covers unauthenticated handshakes and authenticated sessions.
    while connections.join_next().await.is_some() {}
}

async fn connection(bridge: Bridge, socket: TcpStream, mut stopped: watch::Receiver<bool>) {
    let deadline = Instant::now() + Duration::from_secs(5);
    let origin = Arc::new(StdMutex::new(None));
    let actual_origin = origin.clone();
    let port = match socket.local_addr() {
        Ok(addr) => addr.port(),
        Err(_) => return,
    };
    let allowed_origin = bridge.allowed_origin();
    let handshake = accept_hdr_async_with_config(
        socket,
        HandshakeCheck {
            port,
            allowed_origin,
            origin: actual_origin,
        },
        Some(
            WebSocketConfig::default()
                .max_message_size(Some(MAX_FRAME_BYTES))
                .max_frame_size(Some(MAX_FRAME_BYTES)),
        ),
    );
    let mut ws = tokio::select! {
        _ = stopped.changed() => return,
        result = timeout_at(deadline, handshake) => match result { Ok(Ok(ws)) => ws, _ => return },
    };
    let Some(origin) = origin.lock().ok().and_then(|value| value.clone()) else {
        return;
    };
    let mut binding = None;
    let mut closed = None;
    let text = tokio::select! {
        _ = stopped.changed() => String::new(),
        result = timeout_at(deadline, read_text(&mut ws)) => match result { Ok(Ok(text)) => text, _ => String::new() },
    };
    if !text.is_empty() {
        match parse_frame(text.as_bytes()) {
            Ok(message @ WireMessage::Hello { .. }) => {
                let request = match &message {
                    WireMessage::Hello { request_id, .. } => request_id.0.clone(),
                    _ => None,
                };
                let (requested_profile, session) = message.identity();
                let authenticated = tokio::select! {
                    _ = stopped.changed() => None,
                    result = timeout_at(deadline, bridge.connect_extension(&origin, &message)) => result.ok(),
                };
                if let Some(authenticated) = authenticated {
                    let (accepted, resolved_profile, display_name, epoch, write_paused, error) =
                        match &authenticated {
                            Ok(auth) => (
                                true,
                                Some(auth.profile_id.clone()),
                                Some(auth.display_name.clone()),
                                auth.source_epoch,
                                auth.write_paused,
                                None,
                            ),
                            Err(error) => (
                                false,
                                None,
                                None,
                                SourceEpoch::new(1).expect("constant"),
                                false,
                                Some(*error),
                            ),
                        };
                    let envelope_profile = resolved_profile.as_ref().unwrap_or(requested_profile);
                    let response = envelope(
                        "hello_result",
                        envelope_profile,
                        session,
                        request,
                        serde_json::json!({
                            "accepted": accepted,
                            "profileId": resolved_profile,
                            "displayName": display_name,
                            "sourceEpoch": epoch,
                            "writePaused": write_paused,
                            "errorCode": error,
                        }),
                    );
                    if let Ok(auth) = authenticated {
                        binding = Some((auth.profile_id, session.clone()));
                        closed = Some(auth.closed);
                    }
                    if let Ok(response) = response
                        && !matches!(
                            timeout_at(deadline, send(&mut ws, response)).await,
                            Ok(Ok(()))
                        )
                    {
                        if let Some((ref profile, ref sess)) = binding {
                            bridge
                                .disconnected(profile, sess, Some(ErrorCode::ReadOnly))
                                .await;
                        }
                        binding = None;
                    }
                }
            }
            Ok(_) => {}
            Err(_) => {
                if let Some(rejection) = unsupported_version_result(&text) {
                    let _ = timeout_at(deadline, send(&mut ws, rejection)).await;
                }
            }
        }
    }
    if let (Some((profile, session)), Some(mut closed)) = (binding, closed) {
        let result = authenticated_loop(
            &bridge,
            &mut ws,
            &profile,
            &session,
            &mut closed,
            &mut stopped,
        )
        .await;
        bridge.disconnected(&profile, &session, result.err()).await;
    }
    let _ = timeout(Duration::from_millis(250), ws.close(None)).await;
}

async fn authenticated_loop(
    bridge: &Bridge,
    ws: &mut WebSocketStream<TcpStream>,
    profile: &Id,
    session: &Id,
    closed: &mut watch::Receiver<bool>,
    stopped: &mut watch::Receiver<bool>,
) -> Result<()> {
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel();
    bridge.bind_outbound(profile, session, outbound_tx).await;
    let mut outbound_open = true;
    request_sync(bridge, ws, profile, session).await?;
    let mut heartbeat = interval(Duration::from_secs(20));
    heartbeat.tick().await;
    let mut reconcile = interval(Duration::from_secs(300));
    reconcile.tick().await;
    let mut last_received = Instant::now();
    let mut rate_window = Instant::now();
    let mut frames = 0_u32;
    loop {
        tokio::select! {
            biased;
            _ = stopped.changed() => return Ok(()),
            _ = closed.changed() => return Ok(()),
            _ = heartbeat.tick() => {
                if last_received.elapsed() > Duration::from_secs(65) { return Err(ErrorCode::ReadOnly); }
                send(ws, envelope("ping", profile, session, Some(random_id("ping")?), serde_json::json!({}))?).await?;
            },
            _ = reconcile.tick() => { request_sync(bridge, ws, profile, session).await?; },
            outgoing = outbound_rx.recv(), if outbound_open => {
                match outgoing {
                    Some(message) => {
                        let close_after = matches!(message, WireMessage::PauseSync { .. });
                        send(ws, message).await?;
                        if close_after {
                            return Ok(());
                        }
                    }
                    None => outbound_open = false,
                }
            },
            incoming = read_message(ws) => {
                let message = incoming?;
                last_received = Instant::now();
                if rate_window.elapsed() >= Duration::from_secs(1) { rate_window = Instant::now(); frames = 0; }
                frames += 1;
                if frames > 120 { return Err(ErrorCode::LimitExceeded); }
                if let Err(err) = handle_incoming_message(bridge, ws, profile, session, message).await {
                    flush_pause_sync(ws, &mut outbound_rx).await;
                    return Err(err);
                }
            }
        }
    }
}

async fn handle_incoming_message(
    bridge: &Bridge,
    ws: &mut WebSocketStream<TcpStream>,
    profile: &Id,
    session: &Id,
    message: WireMessage,
) -> Result<()> {
    if message.identity() != (profile, session) {
        return Err(ErrorCode::WrongProfile);
    }
    // Check current authority for heartbeats as well as cache messages.
    bridge
        .inner
        .lock()
        .await
        .authenticated(profile, session)
        .map(|_| ())?;
    match message {
        WireMessage::Ping { request_id, .. } => {
            send(
                ws,
                envelope(
                    "pong",
                    profile,
                    session,
                    request_id.0,
                    serde_json::json!({}),
                )?,
            )
            .await?;
        }
        WireMessage::Pong { .. } => {}
        WireMessage::TreeFull { .. } | WireMessage::Event { .. } => {
            if bridge.receive(message).await? {
                request_sync(bridge, ws, profile, session).await?;
            }
        }
        WireMessage::ResyncRequired { .. } => {
            request_sync(bridge, ws, profile, session).await?;
        }
        // An operation receipt is the extension's acknowledgement. Treating it as a command closes the session and freezes the write.
        WireMessage::OperationReceipt { .. } => {
            bridge.receive(message).await?;
        }
        _ => return Err(ErrorCode::ReadOnly),
    }
    Ok(())
}

async fn flush_pause_sync(
    ws: &mut WebSocketStream<TcpStream>,
    outbound_rx: &mut mpsc::UnboundedReceiver<WireMessage>,
) {
    while let Ok(message) = outbound_rx.try_recv() {
        if matches!(message, WireMessage::PauseSync { .. }) {
            let _ = send(ws, message).await;
            break;
        }
    }
}

async fn request_sync(
    bridge: &Bridge,
    ws: &mut WebSocketStream<TcpStream>,
    profile: &Id,
    session: &Id,
) -> Result<()> {
    if let Some(message) = bridge.request_tree(profile, session).await? {
        send(ws, message).await?;
    }
    Ok(())
}

struct HandshakeCheck {
    port: u16,
    allowed_origin: PairedOrigin,
    origin: Arc<StdMutex<Option<PairedOrigin>>>,
}
impl Callback for HandshakeCheck {
    fn on_request(
        self,
        request: &Request,
        response: Response,
    ) -> std::result::Result<Response, ErrorResponse> {
        match checked_handshake(
            self.port,
            &self.allowed_origin,
            &self.origin,
            request,
            response,
        ) {
            Ok(response) => Ok(response),
            Err(error) => Err(*error),
        }
    }
}
fn checked_handshake(
    port: u16,
    allowed_origin: &PairedOrigin,
    actual_origin: &Arc<StdMutex<Option<PairedOrigin>>>,
    request: &Request,
    response: Response,
) -> std::result::Result<Response, Box<ErrorResponse>> {
    let reject = || {
        let mut response = ErrorResponse::new(Some("FORBIDDEN".to_owned()));
        *response.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN;
        Box::new(response)
    };
    if request.uri().path() != "/"
        || request.uri().query().is_some()
        || request.headers().get_all("origin").iter().count() != 1
        || request
            .headers()
            .get("host")
            .and_then(|value| value.to_str().ok())
            != Some(format!("127.0.0.1:{port}").as_str())
    {
        return Err(reject());
    }
    let parsed = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| PairedOrigin::new(value).ok())
        .ok_or_else(reject)?;
    if &parsed != allowed_origin {
        return Err(reject());
    }
    *actual_origin.lock().map_err(|_| reject())? = Some(parsed);
    Ok(response)
}
fn unsupported_version_result(text: &str) -> Option<WireMessage> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value
        .get("protocolVersion")
        .and_then(|version| version.as_u64())
        == Some(1)
    {
        return None;
    }
    let kind = match value.get("type").and_then(|item| item.as_str())? {
        "hello" => "hello_result",
        _ => return None,
    };
    let profile = Id::new(value.get("profileId")?.as_str()?).ok()?;
    let session = Id::new(value.get("sessionId")?.as_str()?).ok()?;
    let request = Id::new(value.get("requestId")?.as_str()?).ok()?;
    let payload = serde_json::json!({
        "accepted": false,
        "profileId": null,
        "displayName": null,
        "sourceEpoch": 1,
        "writePaused": false,
        "errorCode": ErrorCode::UnsupportedVersion
    });
    envelope(kind, &profile, &session, Some(request), payload).ok()
}
async fn read_text(ws: &mut WebSocketStream<TcpStream>) -> Result<String> {
    match ws.next().await {
        Some(Ok(Message::Text(text))) => Ok(text.to_string()),
        _ => Err(ErrorCode::InvalidMessage),
    }
}
async fn read_message(ws: &mut WebSocketStream<TcpStream>) -> Result<WireMessage> {
    parse_frame(read_text(ws).await?.as_bytes())
}
async fn send(ws: &mut WebSocketStream<TcpStream>, message: WireMessage) -> Result<()> {
    let frame = serde_json::to_string(&message).map_err(|_| ErrorCode::InvalidMessage)?;
    timeout(Duration::from_secs(2), ws.send(Message::Text(frame.into())))
        .await
        .map_err(|_| ErrorCode::ReadOnly)?
        .map_err(|_| ErrorCode::ReadOnly)
}
