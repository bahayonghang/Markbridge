//! Single-bookmark AI assistance. Provider calls do not use the public page client.
mod endpoint;
mod schema;
mod service;
mod transport;

/// OS credential service for model keys. This is not the pairing namespace.
pub const MODEL_CREDENTIAL_SERVICE: &str = "Markbridge.Model";

pub(crate) use service::{
    ApplyInput, ApplyPlan, Audit, Gate, ModelSecrets, ModelTextError, RawPrompt, SuggestRequest,
    cancel, clear_credential, mark_applied, model_text, prepare_apply, save_config, set_credential,
    settings, suggest, test_connection,
};
pub(crate) use transport::{CancelFlag, IdleTransport, ModelTransport, ReqwestTransport};
#[cfg(test)]
pub(crate) use transport::{
    ModelError, ModelRequest, ModelResponse, ScriptedStep, ScriptedTransport,
};

#[cfg(test)]
mod tests;
