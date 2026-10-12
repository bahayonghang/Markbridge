//! Batch organization. Model output is data. Chrome writes go through the mutation engine.
mod check;
mod record;
mod schedule;
mod service;

pub(crate) use check::{SCOPE_LIMIT, sample_rows, validate_coverage};
pub(crate) use record::{
    AssignRow, FolderRow, Record, ScopeRow, StepFact, apply_gate, code_name, edit_assignment, fail,
    input_fingerprint, needed_folders, next_unsent, rehash, reserved_ids, review_folders,
    sorted_scope, to_plan_with_job,
};
pub(crate) use service::{
    MSG_CANCELLED, MSG_FORMAT, MSG_HASH, MSG_NO_DELETE, MSG_OFFLINE, MSG_PAUSED, MSG_STALE,
    ModelEnv, classify_scope, job_id, propose_folders,
};

#[cfg(test)]
mod tests;
