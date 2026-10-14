//! Native OS credential storage. Missing or locked services never fall back to plaintext.
use markbridge_protocol::ErrorCode;

pub trait CredentialStore: Send + Sync {
    fn get(&self, reference: &str) -> Result<String, ErrorCode>;
    fn set(&self, reference: &str, secret: &str) -> Result<(), ErrorCode>;
    fn delete(&self, reference: &str) -> Result<(), ErrorCode>;
}

pub struct OsCredentialStore {
    namespace: String,
}
impl OsCredentialStore {
    pub fn new(namespace: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
        }
    }
    fn validate_identity(&self, reference: &str) -> Result<(), ErrorCode> {
        if self.namespace.is_empty()
            || reference.is_empty()
            || self.namespace.bytes().any(|byte| byte == 0 || byte == b'/')
            || reference.bytes().any(|byte| byte == 0 || byte == b'/')
        {
            Err(ErrorCode::StorageError)
        } else {
            Ok(())
        }
    }
    /// Windows Credential Manager comments hold at most 256 characters.
    /// keyring 3.6.1 writes `{user}@{service}:{user}.{service}` there.
    /// `Markbridge.Task03.{uuid}` plus `credential:` and 32 bytes exceeds that limit,
    /// so `Entry::new` fails before `CredWriteW`. The target stores the identity.
    /// Service and user stay short so `{user}@{service}:{target} (keyring v3.6.1)` fits.
    #[cfg(windows)]
    fn entry(&self, reference: &str) -> Result<keyring::Entry, ErrorCode> {
        const SERVICE: &str = "Markbridge";
        const USER: &str = "pairing";
        const MAX_TARGET_BYTES: usize = 180;
        self.validate_identity(reference)?;
        let target = format!("Markbridge/{}/{}", self.namespace, reference);
        if target.len() > MAX_TARGET_BYTES {
            return Err(ErrorCode::StorageError);
        }
        debug_assert!(
            format!("{USER}@{SERVICE}:{target} (keyring v3.6.1)").len() <= 256,
            "credential comment exceeds the Windows limit"
        );
        keyring::Entry::new_with_target(&target, SERVICE, USER).map_err(|_| ErrorCode::StorageError)
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn entry(&self, reference: &str) -> Result<keyring::Entry, ErrorCode> {
        self.validate_identity(reference)?;
        // Entry::new uses service/account on Keychain and Secret Service, not a Windows target/domain.
        keyring::Entry::new(&self.namespace, reference).map_err(|_| ErrorCode::StorageError)
    }
}
impl CredentialStore for OsCredentialStore {
    fn get(&self, reference: &str) -> Result<String, ErrorCode> {
        #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
        {
            self.entry(reference)?.get_password().map_err(|error| {
                #[cfg(windows)]
                {
                    let _ = error;
                    ErrorCode::Unpaired
                }
                #[cfg(not(windows))]
                {
                    match error {
                        keyring::Error::NoEntry => ErrorCode::Unpaired,
                        _ => ErrorCode::StorageError,
                    }
                }
            })
        }
        #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
        {
            let _ = (&self.namespace, reference);
            Err(ErrorCode::StorageError)
        }
    }
    fn set(&self, reference: &str, secret: &str) -> Result<(), ErrorCode> {
        #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
        {
            self.entry(reference)?
                .set_password(secret)
                .map_err(|_| ErrorCode::StorageError)
        }
        #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
        {
            let _ = (&self.namespace, reference, secret);
            Err(ErrorCode::StorageError)
        }
    }
    fn delete(&self, reference: &str) -> Result<(), ErrorCode> {
        #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
        {
            match self.entry(reference)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(ErrorCode::StorageError),
            }
        }
        #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
        {
            let _ = (&self.namespace, reference);
            Err(ErrorCode::StorageError)
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{CredentialStore, OsCredentialStore};

    #[test]
    fn task_namespace_reference_roundtrip_avoids_comment_limit() {
        let namespace = "Markbridge.Task03.0dab3e15-f02c-4b13-bed6-ef8333ccc59a";
        let reference = format!("credential:{}", "ab".repeat(32));
        let secret = "cd".repeat(32);
        assert!(
            matches!(
                keyring::Entry::new(namespace, &reference),
                Err(keyring::Error::TooLong(_, _))
            ),
            "Entry::new still has to reject this length"
        );
        let store = OsCredentialStore::new(namespace);
        let _cleanup = scopeguard(&store, &reference);
        store.set(&reference, &secret).expect("credential set");
        assert_eq!(store.get(&reference).expect("credential get"), secret);
        store.delete(&reference).expect("credential delete");
        assert!(store.get(&reference).is_err());
    }

    struct Remove<'a>(&'a OsCredentialStore, &'a str);
    impl Drop for Remove<'_> {
        fn drop(&mut self) {
            let _ = self.0.delete(self.1);
        }
    }
    fn scopeguard<'a>(store: &'a OsCredentialStore, reference: &'a str) -> Remove<'a> {
        Remove(store, reference)
    }
}

#[cfg(test)]
mod identity_tests {
    use super::OsCredentialStore;
    #[test]
    fn native_identity_rejects_ambiguous_or_empty_service_and_account() {
        for service in ["", "Markbridge/other", "Markbridge\0other"] {
            assert!(
                OsCredentialStore::new(service)
                    .validate_identity("credential:abc")
                    .is_err()
            );
        }
        let store = OsCredentialStore::new("Markbridge.Task14.synthetic");
        for reference in ["", "credential/other", "credential\0other"] {
            assert!(store.validate_identity(reference).is_err());
        }
        assert!(store.validate_identity("credential:abc").is_ok());
        assert!(
            OsCredentialStore::new("Markbridge.Model")
                .validate_identity("model:abc")
                .is_ok()
        );
    }
}
