use super::*;
use futures_util::{SinkExt, StreamExt};
use std::{
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::Semaphore,
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
    let mut maintenance = interval(Duration::from_secs(1));
    let mut rate_window = Instant::now();
    let mut accepted = 0;
    loop {
        tokio::select! {
            biased;
            _ = stopped.changed() => break,
            Some(_) = connections.join_next(), if !connections.is_empty() => {},
            _ = maintenance.tick() => { bridge.state().await; },
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
    let handshake = accept_hdr_async_with_config(
        socket,
        HandshakeCheck {
            port,
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
    // A successful pair exchange still requires hello. Pending human confirmation closes immediately.
    for _ in 0..2 {
        let text = tokio::select! {
            _ = stopped.changed() => break,
            result = timeout_at(deadline, read_text(&mut ws)) => match result { Ok(Ok(text)) => text, _ => break },
        };
        let message = match parse_frame(text.as_bytes()) {
            Ok(message) => message,
            Err(_) => {
                if let Some(rejection) = unsupported_version_result(&text) {
                    let _ = timeout_at(deadline, send(&mut ws, rejection)).await;
                }
                break;
            }
        };
        let request = match &message {
            WireMessage::Pair { request_id, .. } | WireMessage::Hello { request_id, .. } => {
                request_id.0.clone()
            }
            _ => break,
        };
        let (profile, session) = message.identity();
        if matches!(message, WireMessage::Pair { .. }) {
            let result = tokio::select! {
                _ = stopped.changed() => break,
                result = timeout_at(deadline, bridge.pair(&origin, &message)) => match result { Ok(result) => result, Err(_) => break },
            };
            let (accepted, credential, error) = match result {
                Ok(Some(secret)) => (true, Some(secret), None),
                Ok(None) => (false, None, Some(ErrorCode::Unpaired)),
                Err(error) => (false, None, Some(error)),
            };
            let response = envelope(
                "pair_result",
                profile,
                session,
                request,
                serde_json::json!({"accepted":accepted,"credential":credential,"errorCode":error}),
            );
            if let Ok(response) = response
                && !matches!(
                    timeout_at(deadline, send(&mut ws, response)).await,
                    Ok(Ok(()))
                )
            {
                break;
            }
            if !accepted {
                break;
            }
        } else {
            let authenticated = tokio::select! {
                _ = stopped.changed() => break,
                result = timeout_at(deadline, bridge.authenticate(&origin, &message)) => match result { Ok(result) => result, Err(_) => break },
            };
            let (accepted, epoch, error) = match &authenticated {
                Ok((epoch, _)) => (true, *epoch, None),
                Err(error) => (false, SourceEpoch::new(1).expect("constant"), Some(*error)),
            };
            let response = envelope(
                "hello_result",
                profile,
                session,
                request,
                serde_json::json!({"accepted":accepted,"sourceEpoch":epoch,"errorCode":error}),
            );
            if let Ok((_, receiver)) = authenticated {
                binding = Some((profile.clone(), session.clone()));
                closed = Some(receiver);
            }
            if let Ok(response) = response
                && !matches!(
                    timeout_at(deadline, send(&mut ws, response)).await,
                    Ok(Ok(()))
                )
            {
                if binding.is_some() {
                    bridge
                        .disconnected(profile, session, Some(ErrorCode::ReadOnly))
                        .await;
                }
                binding = None;
                break;
            }
            break;
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
            incoming = read_message(ws) => {
                let message = incoming?;
                last_received = Instant::now();
                if rate_window.elapsed() >= Duration::from_secs(1) { rate_window = Instant::now(); frames = 0; }
                frames += 1;
                if frames > 120 { return Err(ErrorCode::LimitExceeded); }
                if message.identity() != (profile, session) { return Err(ErrorCode::WrongProfile); }
                // Check current authority for heartbeats as well as cache messages.
                { bridge.inner.lock().await.authenticated(profile, session)?; }
                match message {
                    WireMessage::Ping { request_id, .. } => send(ws, envelope("pong", profile, session, request_id.0, serde_json::json!({}))?).await?,
                    WireMessage::Pong { .. } => {},
                    WireMessage::TreeFull { .. } | WireMessage::Event { .. } => {
                        if bridge.receive(message).await? { request_sync(bridge, ws, profile, session).await?; }
                    },
                    WireMessage::ResyncRequired { .. } => { request_sync(bridge, ws, profile, session).await?; },
                    _ => return Err(ErrorCode::ReadOnly),
                }
            }
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
    origin: Arc<StdMutex<Option<PairedOrigin>>>,
}
impl Callback for HandshakeCheck {
    fn on_request(
        self,
        request: &Request,
        response: Response,
    ) -> std::result::Result<Response, ErrorResponse> {
        match checked_handshake(self.port, &self.origin, request, response) {
            Ok(response) => Ok(response),
            Err(error) => Err(*error),
        }
    }
}
fn checked_handshake(
    port: u16,
    actual_origin: &Arc<StdMutex<Option<PairedOrigin>>>,
    request: &Request,
    response: Response,
) -> std::result::Result<Response, Box<ErrorResponse>> {
    let reject = || {
        let mut response = ErrorResponse::new(Some("UNPAIRED".to_owned()));
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
        "pair" => "pair_result",
        _ => return None,
    };
    let profile = Id::new(value.get("profileId")?.as_str()?).ok()?;
    let session = Id::new(value.get("sessionId")?.as_str()?).ok()?;
    let request = Id::new(value.get("requestId")?.as_str()?).ok()?;
    let payload = if kind == "hello_result" {
        serde_json::json!({"accepted":false,"sourceEpoch":1,"errorCode":ErrorCode::UnsupportedVersion})
    } else {
        serde_json::json!({"accepted":false,"credential":null,"errorCode":ErrorCode::UnsupportedVersion})
    };
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
