//! Task-scoped native credential diagnostics. Output contains only stage and safe error labels.
#[cfg(windows)]
fn main() {
    use markbridge_core::bridge::credentials::{CredentialStore, OsCredentialStore};
    use rand::TryRngCore;
    let Some(namespace) = std::env::args()
        .nth(1)
        .filter(|value| value.starts_with("Markbridge.Task03."))
    else {
        eprintln!("INVALID_NAMESPACE");
        std::process::exit(1);
    };
    let reference = format!("credential:{}", "a".repeat(64));
    let mut bytes = [0u8; 32];
    if rand::rngs::OsRng.try_fill_bytes(&mut bytes).is_err() {
        eprintln!("RANDOM_FAILED");
        std::process::exit(1);
    }
    let secret: String = bytes.iter().map(|value| format!("{value:02x}")).collect();
    let store = OsCredentialStore::new(namespace.clone());
    if let Err(error) = store.set(&reference, &secret) {
        println!(
            "{}",
            serde_json::json!({"stage":"production_set","errorCode":error})
        );
        let raw = keyring::Entry::new(&namespace, &reference)
            .and_then(|entry| entry.set_password(&secret));
        if let Err(error) = raw {
            report("native_set", &error);
        }
        let _ = store.delete(&reference);
        std::process::exit(1);
    }
    println!(
        "{}",
        serde_json::json!({"stage":"production_set","status":"PASS"})
    );
    let fetched = store.get(&reference);
    println!(
        "{}",
        serde_json::json!({"stage":"production_get","status":if fetched.as_ref().is_ok_and(|value| value == &secret) {"PASS"} else {"FAIL"}})
    );
    if let Err(error) = store.delete(&reference) {
        println!(
            "{}",
            serde_json::json!({"stage":"production_delete","errorCode":error})
        );
        std::process::exit(1);
    }
    println!(
        "{}",
        serde_json::json!({"stage":"production_delete","status":"PASS"})
    );
    if fetched.is_err() {
        std::process::exit(1);
    }
}
#[cfg(windows)]
fn report(stage: &str, error: &keyring::Error) {
    let (kind, code) = match error {
        keyring::Error::PlatformFailure(error) => (
            "PlatformFailure",
            error
                .downcast_ref::<std::io::Error>()
                .and_then(std::io::Error::raw_os_error),
        ),
        keyring::Error::NoStorageAccess(error) => (
            "NoStorageAccess",
            error
                .downcast_ref::<std::io::Error>()
                .and_then(std::io::Error::raw_os_error),
        ),
        keyring::Error::NoEntry => ("NoEntry", None),
        keyring::Error::TooLong(_, _) => ("TooLong", None),
        keyring::Error::Invalid(_, _) => ("Invalid", None),
        _ => ("Other", None),
    };
    println!(
        "{}",
        serde_json::json!({"stage":stage,"kind":kind,"rawOsError":code})
    );
}
#[cfg(not(windows))]
fn main() {
    eprintln!("UNSUPPORTED_PLATFORM");
    std::process::exit(1);
}
