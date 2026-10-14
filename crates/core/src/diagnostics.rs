//! A read-only projection of published status, with no log or content collection.
use markbridge_protocol::{
    BridgeConnection, BridgeState, Counter, DiagnosticArchitecture, DiagnosticConnections,
    DiagnosticMirrors, DiagnosticPlatform, DiagnosticReport, MirrorFileStatus, PROTOCOL_VERSION,
    Version,
};

pub fn report(state: &BridgeState) -> DiagnosticReport {
    let connections = |connection| {
        Counter::new(
            state
                .profiles
                .iter()
                .filter(|profile| profile.connection == connection)
                .count() as u64,
        )
        .expect("profile count fits protocol counter")
    };
    let mirrors = |status| {
        Counter::new(
            state
                .mirrors
                .iter()
                .filter(|mirror| mirror.file_status == status)
                .count() as u64,
        )
        .expect("mirror count fits protocol counter")
    };
    DiagnosticReport {
        format_version: Version::new(1).expect("diagnostic format"),
        app_version: env!("CARGO_PKG_VERSION").into(),
        protocol_version: Version::new(PROTOCOL_VERSION.into()).expect("protocol version"),
        schema_version: Counter::new(crate::storage::SCHEMA_VERSION.into())
            .expect("schema version"),
        platform: match std::env::consts::OS {
            "windows" => DiagnosticPlatform::Windows,
            "macos" => DiagnosticPlatform::Macos,
            "linux" => DiagnosticPlatform::Linux,
            _ => DiagnosticPlatform::Other,
        },
        architecture: match std::env::consts::ARCH {
            "x86_64" => DiagnosticArchitecture::X86_64,
            "aarch64" => DiagnosticArchitecture::Aarch64,
            _ => DiagnosticArchitecture::Other,
        },
        bridge_listening: state.port.0.is_some(),
        bridge_error_code: state.error_code.clone(),
        connections: DiagnosticConnections {
            unpaired: connections(BridgeConnection::Unpaired),
            connecting: connections(BridgeConnection::Connecting),
            reconciling: connections(BridgeConnection::Reconciling),
            live: connections(BridgeConnection::Live),
            cached_read_only: connections(BridgeConnection::CachedReadOnly),
            error: connections(BridgeConnection::Error),
        },
        mirrors: DiagnosticMirrors {
            current: mirrors(MirrorFileStatus::Current),
            stale: mirrors(MirrorFileStatus::Stale),
            unavailable: mirrors(MirrorFileStatus::Unavailable),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_keeps_only_fixed_status_counts_and_excludes_private_source_fields() {
        let mut value = serde_json::json!({
            "protocolVersion": 1, "revision": 98301, "port": 54321, "errorCode": "STORAGE_ERROR",
            "profiles": [], "mirrors": [],
            "pending": [{ "profileId": "pending-private", "displayName": "sk-pending-secret",
                "instanceId": "instance-private", "origin": "https://private.example/?token=canary#fragment", "expiresAt": 98302 }]
        });
        for connection in [
            "unpaired",
            "connecting",
            "reconciling",
            "live",
            "cached_read_only",
            "error",
            "live",
        ] {
            value["profiles"]
                .as_array_mut()
                .unwrap()
                .push(serde_json::json!({
                    "profileId": "profile-private", "instanceId": "instance-private",
                    "displayName": "C:\\Private\\raw-bookmark-title", "connection": connection,
                    "nodeCount": 98303, "revision": 98304, "lastSyncedAt": 98305, "errorCode": null
                }));
        }
        for status in ["current", "stale", "unavailable"] {
            value["mirrors"].as_array_mut().unwrap().push(serde_json::json!({
                "mirrorSourceId": "mirror-private", "displayName": "Authorization: Bearer sk-secret-key",
                "association": "independent", "pairedProfileId": "profile-private", "fileStatus": status,
                "watching": true, "nodeCount": 98306, "revision": 98307, "lastSyncedAt": 98308,
                "errorCode": null, "canWriteBrowser": false
            }));
        }
        let state: BridgeState = serde_json::from_value(value).unwrap();
        let actual = serde_json::to_value(report(&state)).unwrap();
        assert_eq!(
            actual["connections"],
            serde_json::json!({
                "unpaired":1, "connecting":1, "reconciling":1, "live":2, "cachedReadOnly":1, "error":1
            })
        );
        assert_eq!(
            actual["mirrors"],
            serde_json::json!({"current":1, "stale":1, "unavailable":1})
        );
        assert_eq!(actual["bridgeListening"], true);
        assert_eq!(actual["bridgeErrorCode"], "STORAGE_ERROR");
        assert_eq!(actual["schemaVersion"], crate::storage::SCHEMA_VERSION);
        let encoded = serde_json::to_string(&actual).unwrap();
        for private in [
            "private",
            "sk-",
            "token",
            "fragment",
            "Authorization",
            "54321",
            "9830",
            "title",
            "url",
            "origin",
            "displayName",
            "profileId",
            "instanceId",
            "mirrorSourceId",
        ] {
            assert!(
                !encoded.contains(private),
                "private source field was exported"
            );
        }
        assert_eq!(
            serde_json::from_value::<DiagnosticReport>(actual.clone()).unwrap(),
            report(&state)
        );
        let mut extra = actual;
        extra["path"] = serde_json::json!("C:\\Private\\user");
        assert!(serde_json::from_value::<DiagnosticReport>(extra).is_err());
    }

    #[test]
    fn unpaired_diagnostics_do_not_need_a_listener_or_source() {
        let state: BridgeState = serde_json::from_value(serde_json::json!({
            "protocolVersion":1, "revision":0, "port":null, "errorCode":null,
            "profiles":[], "pending":[], "mirrors":[]
        }))
        .unwrap();
        let report = report(&state);
        assert!(!report.bridge_listening);
        assert_eq!(report.connections.live.get(), 0);
        assert_eq!(report.mirrors.current.get(), 0);
    }
}
