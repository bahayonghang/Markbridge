use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u8 = 1;

/// Foundation IPC state. Task 02 owns the paired transport protocol.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupState {
    #[schemars(range(min = 1, max = 1))]
    pub protocol_version: u8,
    pub state: StartupConnection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StartupConnection {
    Unpaired,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_fixture_roundtrips_without_extra_fields() {
        let fixture = include_str!("../../../tests/fixtures/protocol/startup-state.json");
        let state: StartupState = serde_json::from_str(fixture).unwrap();
        assert_eq!(state.protocol_version, PROTOCOL_VERSION);
        assert_eq!(state.state, StartupConnection::Unpaired);
        let actual = serde_json::to_value(state).unwrap();
        let expected: serde_json::Value = serde_json::from_str(fixture).unwrap();
        assert_eq!(actual, expected);
        assert!(
            serde_json::from_str::<StartupState>(
                r#"{"protocolVersion":1,"state":"unpaired","token":"forbidden"}"#
            )
            .is_err()
        );
    }
}

pub mod wire;
pub use wire::*;
pub mod bridge;
pub use bridge::*;
pub mod preview;
pub use preview::*;

#[cfg(test)]
mod wire_tests;
