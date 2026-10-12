use markbridge_protocol::{PROTOCOL_VERSION, StartupConnection, StartupState};

/// Startup has no paired profile, listener, storage, or browser access.
pub fn startup_state() -> StartupState {
    StartupState {
        protocol_version: PROTOCOL_VERSION,
        state: StartupConnection::Unpaired,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn startup_is_unpaired() {
        let state = super::startup_state();
        assert_eq!(state.protocol_version, 1);
        assert_eq!(
            state.state,
            markbridge_protocol::StartupConnection::Unpaired
        );
    }
}

pub mod ai;
pub mod bridge;
pub mod editing;
mod maintenance;
pub mod mirror;
pub mod organization;
pub mod preview;
pub mod storage;
pub mod tags;
