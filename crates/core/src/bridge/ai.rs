//! Bridge entry points for one AI suggestion. Confirmed title changes go through `apply_edit`.
use std::sync::Arc;

use markbridge_protocol::{
    AiApplyResult, AiConnection, AiDraft, AiFailure, AiSettings, AiSuggestion, ApplyResult,
    BridgeConnection, EditAction, ErrorCode, Id, OperationState, RequiredNullable, TagCommand,
    Title,
};

use super::{Bridge, Result, credentials::CredentialStore};
use crate::ai::{self, ModelSecrets};

pub(super) struct Secrets(Arc<dyn CredentialStore>);

impl ModelSecrets for Secrets {
    fn read(&self, reference: &str) -> std::result::Result<Option<String>, ErrorCode> {
        match self.0.get(reference) {
            Ok(value) => Ok(Some(value)),
            Err(ErrorCode::Unpaired) => Ok(None),
            Err(error) => Err(error),
        }
    }
    fn write(&self, reference: &str, value: &str) -> std::result::Result<(), ErrorCode> {
        self.0.set(reference, value)
    }
    fn remove(&self, reference: &str) -> std::result::Result<(), ErrorCode> {
        self.0.delete(reference)
    }
}

#[derive(Default)]
pub(crate) struct EmptyCredentials;

impl CredentialStore for EmptyCredentials {
    fn get(&self, _reference: &str) -> Result<String> {
        Err(ErrorCode::Unpaired)
    }
    fn set(&self, _reference: &str, _value: &str) -> Result<()> {
        Err(ErrorCode::StorageError)
    }
    fn delete(&self, _reference: &str) -> Result<()> {
        Ok(())
    }
}

impl Bridge {
    pub(super) fn secrets(&self) -> Secrets {
        Secrets(self.model_credentials.clone())
    }

    pub async fn ai_settings(&self) -> Result<AiSettings> {
        let storage = self.inner.lock().await.storage()?.share();
        ai::settings(&storage).await
    }

    pub async fn save_ai_config(
        &self,
        enabled: bool,
        provider: String,
        base_url: String,
        model: String,
    ) -> Result<AiSettings> {
        let storage = self.inner.lock().await.storage()?.share();
        ai::save_config(
            &storage,
            &self.ai_audit,
            enabled,
            &provider,
            &base_url,
            &model,
        )
        .await
    }

    pub async fn set_ai_credential(&self, secret: String) -> Result<AiSettings> {
        let storage = self.inner.lock().await.storage()?.share();
        ai::set_credential(&storage, &self.secrets(), &self.ai_audit, &secret).await
    }

    pub async fn clear_ai_credential(&self) -> Result<AiSettings> {
        let storage = self.inner.lock().await.storage()?.share();
        ai::clear_credential(&storage, &self.secrets(), &self.ai_audit).await
    }

    pub async fn test_ai_connection(&self) -> Result<AiConnection> {
        let storage = self.inner.lock().await.storage()?.share();
        ai::test_connection(
            &storage,
            &self.secrets(),
            self.model_transport.as_ref(),
            &self.ai_audit,
        )
        .await
    }

    pub async fn suggest_ai(
        &self,
        profile_id: Id,
        chrome_id: Id,
        request_id: Id,
    ) -> Result<AiSuggestion> {
        let (memory_title, memory_url) = {
            let inner = self.inner.lock().await;
            let profile = inner
                .profiles
                .get(profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            let node = profile
                .nodes
                .iter()
                .find(|node| node.chrome_id == chrome_id)
                .ok_or(ErrorCode::InvalidMessage)?;
            (
                node.title.as_str().to_owned(),
                node.url.as_ref().map(|url| url.as_str().to_owned()),
            )
        };
        let storage = self.inner.lock().await.storage()?.share();
        ai::suggest(
            &storage,
            &self.secrets(),
            self.model_transport.as_ref(),
            &self.ai_gate,
            &self.ai_audit,
            ai::SuggestRequest {
                profile_id,
                chrome_id,
                request_id,
                memory_title,
                memory_url,
            },
        )
        .await
    }

    pub async fn cancel_ai(&self, request_id: Id) -> Result<()> {
        let storage = self.inner.lock().await.storage()?.share();
        ai::cancel(&storage, &self.ai_gate, &self.ai_audit, request_id).await
    }

    pub async fn apply_ai(&self, draft: AiDraft) -> Result<AiApplyResult> {
        let (memory_title, memory_url, live, revision) = {
            let inner = self.inner.lock().await;
            let profile = inner
                .profiles
                .get(draft.profile_id.as_str())
                .ok_or(ErrorCode::WrongProfile)?;
            let node = profile
                .nodes
                .iter()
                .find(|node| node.chrome_id == draft.chrome_id)
                .ok_or(ErrorCode::InvalidMessage)?;
            let live = profile.view.connection == BridgeConnection::Live
                && !profile.writes_blocked
                && !profile.busy;
            (
                node.title.as_str().to_owned(),
                node.url.as_ref().map(|url| url.as_str().to_owned()),
                live,
                profile.view.revision.get(),
            )
        };
        let storage = self.inner.lock().await.storage()?.share();
        let decision = ai::prepare_apply(
            &storage,
            &self.ai_audit,
            ai::ApplyInput {
                job_id: draft.job_id.clone(),
                profile_id: draft.profile_id.clone(),
                chrome_id: draft.chrome_id.clone(),
                input_fingerprint: draft.input_fingerprint.as_str(),
                title: &draft.title,
                tags: &draft.tags,
                summary: draft.summary.0.as_deref(),
                apply_title: draft.apply_title,
                apply_tags: draft.apply_tags,
                apply_summary: draft.apply_summary,
                memory_title: &memory_title,
                memory_url: memory_url.as_deref(),
            },
        )
        .await?;
        let plan = match decision {
            Ok(plan) => plan,
            Err(refusal) => return Ok(refusal),
        };
        if plan.title.is_some() && !live {
            return Err(ErrorCode::ReadOnly);
        }
        if !storage.claim_ai_job(plan.job_id.clone()).await? {
            return Ok(refused(plan.job_id, AiFailure::Cancelled));
        }
        let browser = if let Some(title) = plan.title.clone() {
            match self
                .apply_edit(
                    plan.profile_id.clone(),
                    revision,
                    EditAction::Update {
                        chrome_id: plan.chrome_id.clone(),
                        title: Some(Title::new(title)?),
                        url: None,
                    },
                    false,
                )
                .await
            {
                Ok(result)
                    if matches!(
                        result.state,
                        OperationState::Applying | OperationState::Applied
                    ) =>
                {
                    Some(result)
                }
                Ok(result) => {
                    storage.release_ai_job(plan.job_id.clone()).await?;
                    return Ok(with_browser(plan.job_id, result, false, false));
                }
                Err(error) => {
                    storage.release_ai_job(plan.job_id).await?;
                    return Err(error);
                }
            }
        } else {
            None
        };
        if let Err(error) = self.write_local(&storage, &plan).await {
            if browser.is_some() {
                let _ = storage.mark_ai_applied(plan.job_id).await;
            } else {
                storage.release_ai_job(plan.job_id).await?;
            }
            return Err(error);
        }
        let tags_applied = !plan.tags.is_empty();
        let summary_applied = plan.summary.is_some();
        let kept = ai::mark_applied(
            &storage,
            &self.ai_audit,
            plan.job_id.clone(),
            &plan.profile_id,
        )
        .await?;
        Ok(AiApplyResult {
            job_id: plan.job_id,
            browser: RequiredNullable(browser),
            tags_applied,
            summary_applied,
            failure: RequiredNullable((!kept).then_some(AiFailure::Cancelled)),
            failure_message: RequiredNullable((!kept).then(|| AiFailure::Cancelled.message(None))),
        })
    }

    async fn write_local(
        &self,
        storage: &crate::storage::Storage,
        plan: &ai::ApplyPlan,
    ) -> Result<()> {
        for tag in &plan.tags {
            self.mutate_tags(
                plan.profile_id.clone(),
                TagCommand::Add {
                    chrome_ids: vec![plan.chrome_id.clone()],
                    name: tag.clone(),
                },
            )
            .await?;
        }
        if let Some(summary) = &plan.summary {
            storage
                .set_summary(plan.bookmark_id.clone(), summary.clone())
                .await?;
        }
        Ok(())
    }

    pub fn ai_audit_lines(&self) -> Vec<String> {
        self.ai_audit.lines()
    }
}

fn refused(job_id: Id, failure: AiFailure) -> AiApplyResult {
    AiApplyResult {
        job_id,
        browser: RequiredNullable(None),
        tags_applied: false,
        summary_applied: false,
        failure: RequiredNullable(Some(failure)),
        failure_message: RequiredNullable(Some(failure.message(None))),
    }
}

fn with_browser(
    job_id: Id,
    browser: ApplyResult,
    tags_applied: bool,
    summary_applied: bool,
) -> AiApplyResult {
    let failure = browser.error_code.0;
    AiApplyResult {
        job_id,
        browser: RequiredNullable(Some(browser)),
        tags_applied,
        summary_applied,
        failure: RequiredNullable(failure.map(|_| AiFailure::StaleTarget)),
        failure_message: RequiredNullable(failure.map(|_| AiFailure::StaleTarget.message(None))),
    }
}
