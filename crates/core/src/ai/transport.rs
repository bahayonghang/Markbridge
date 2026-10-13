//! Model HTTP calls. Public page fetch is a different client and stays loopback-denied.
#[cfg(test)]
use std::{
    collections::VecDeque,
    sync::atomic::{AtomicUsize, Ordering},
};
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

use futures_util::StreamExt;
#[cfg(test)]
use tokio::sync::Mutex;
use tokio::sync::watch;

const BODY_LIMIT: usize = 64 * 1024;

#[derive(Clone)]
pub(crate) struct CancelFlag(Arc<watch::Sender<bool>>);

impl CancelFlag {
    pub(crate) fn new() -> Self {
        Self(Arc::new(watch::channel(false).0))
    }
    pub(crate) fn cancel(&self) {
        self.0.send_replace(true);
    }
    pub(crate) fn same_request(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
    pub(crate) fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }
    pub(crate) async fn cancelled(&self) {
        let mut watch = self.0.subscribe();
        loop {
            if *watch.borrow() {
                return;
            }
            if watch.changed().await.is_err() {
                return;
            }
        }
    }
}

pub(crate) struct ModelRequest {
    pub url: String,
    pub body: String,
    pub bearer: Option<String>,
    pub cancel: CancelFlag,
}

pub(crate) struct ModelResponse {
    pub status: u16,
    pub body: String,
    pub retry_after: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ModelError {
    TimedOut,
    Unreachable,
    Cancelled,
}

pub(crate) trait ModelTransport: Send + Sync {
    fn post<'a>(
        &'a self,
        request: &'a ModelRequest,
    ) -> Pin<Box<dyn Future<Output = Result<ModelResponse, ModelError>> + Send + 'a>>;
}

pub(crate) struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> Result<Self, markbridge_protocol::ErrorCode> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| markbridge_protocol::ErrorCode::StorageError)?;
        Ok(Self { client })
    }
}

impl ModelTransport for ReqwestTransport {
    fn post<'a>(
        &'a self,
        request: &'a ModelRequest,
    ) -> Pin<Box<dyn Future<Output = Result<ModelResponse, ModelError>> + Send + 'a>> {
        Box::pin(async move {
            if request.cancel.is_cancelled() {
                return Err(ModelError::Cancelled);
            }
            let mut builder = self
                .client
                .post(&request.url)
                .header("content-type", "application/json")
                .header("accept", "application/json");
            if let Some(token) = &request.bearer {
                builder = builder.header("authorization", format!("Bearer {token}"));
            }
            let pending = builder.body(request.body.clone()).send();
            let response = tokio::select! {
                biased;
                _ = request.cancel.cancelled() => return Err(ModelError::Cancelled),
                response = pending => response,
            };
            let response = match response {
                Ok(response) => response,
                Err(error) if error.is_timeout() => return Err(ModelError::TimedOut),
                Err(_) => return Err(ModelError::Unreachable),
            };
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok());
            let status = response.status().as_u16();
            let mut stream = response.bytes_stream();
            let mut body = Vec::new();
            loop {
                let chunk = tokio::select! {
                    biased;
                    _ = request.cancel.cancelled() => return Err(ModelError::Cancelled),
                    chunk = stream.next() => chunk,
                };
                let Some(chunk) = chunk else {
                    break;
                };
                let chunk = chunk.map_err(|_| ModelError::Unreachable)?;
                if body.len().saturating_add(chunk.len()) > BODY_LIMIT {
                    return Err(ModelError::Unreachable);
                }
                body.extend_from_slice(&chunk);
            }
            let body = String::from_utf8(body).map_err(|_| ModelError::Unreachable)?;
            Ok(ModelResponse {
                status,
                body,
                retry_after,
            })
        })
    }
}

#[derive(Default)]
pub(crate) struct IdleTransport;

impl ModelTransport for IdleTransport {
    fn post<'a>(
        &'a self,
        _request: &'a ModelRequest,
    ) -> Pin<Box<dyn Future<Output = Result<ModelResponse, ModelError>> + Send + 'a>> {
        Box::pin(async { Err(ModelError::Unreachable) })
    }
}

#[cfg(test)]
pub(crate) enum ScriptedStep {
    Respond {
        status: u16,
        body: String,
        retry_after: Option<u64>,
    },
    Fail(ModelError),
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct ScriptedTransport {
    calls: AtomicUsize,
    auths: AtomicUsize,
    urls: Mutex<Vec<String>>,
    bodies: Mutex<Vec<String>>,
    steps: Mutex<VecDeque<ScriptedStep>>,
}

#[cfg(test)]
impl ScriptedTransport {
    pub(crate) fn new(steps: Vec<ScriptedStep>) -> Self {
        Self {
            steps: Mutex::new(steps.into()),
            ..Self::default()
        }
    }
    pub(crate) fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
    pub(crate) fn auths(&self) -> usize {
        self.auths.load(Ordering::SeqCst)
    }
    pub(crate) async fn urls(&self) -> Vec<String> {
        self.urls.lock().await.clone()
    }
    pub(crate) async fn bodies(&self) -> Vec<String> {
        self.bodies.lock().await.clone()
    }
}

#[cfg(test)]
impl ModelTransport for ScriptedTransport {
    fn post<'a>(
        &'a self,
        request: &'a ModelRequest,
    ) -> Pin<Box<dyn Future<Output = Result<ModelResponse, ModelError>> + Send + 'a>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if request.bearer.is_some() {
                self.auths.fetch_add(1, Ordering::SeqCst);
            }
            self.urls.lock().await.push(request.url.clone());
            self.bodies.lock().await.push(request.body.clone());
            let step = self.steps.lock().await.pop_front();
            let Some(step) = step else {
                return Err(ModelError::Unreachable);
            };
            match step {
                ScriptedStep::Fail(error) => Err(error),
                ScriptedStep::Respond {
                    status,
                    body,
                    retry_after,
                } => Ok(ModelResponse {
                    status,
                    body,
                    retry_after,
                }),
            }
        })
    }
}
