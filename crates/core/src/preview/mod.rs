//! Public page preview. Ollama loopback is not served by this client.
mod extract;
mod fetch;
mod guard;
mod service;

pub(crate) use fetch::SystemNetwork;
pub use service::Gate;
pub(crate) use service::load_content_preview;
pub(crate) use service::url_fingerprint;

#[cfg(test)]
mod tests;
