//! OS credential storage. Unsupported platforms fail closed until child 14.
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
        if self.namespace.is_empty()
            || reference.is_empty()
            || self.namespace.bytes().any(|byte| byte == 0 || byte == b'/')
            || reference.bytes().any(|byte| byte == 0 || byte == b'/')
        {
            return Err(ErrorCode::StorageError);
        }
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
}
impl CredentialStore for OsCredentialStore {
    fn get(&self, reference: &str) -> Result<String, ErrorCode> {
        #[cfg(windows)]
        {
            self.entry(reference)?
                .get_password()
                .map_err(|_| ErrorCode::Unpaired)
        }
        #[cfg(not(windows))]
        {
            let _ = (&self.namespace, reference);
            Err(ErrorCode::StorageError)
        }
    }
    fn set(&self, reference: &str, secret: &str) -> Result<(), ErrorCode> {
        #[cfg(windows)]
        {
            self.entry(reference)?
                .set_password(secret)
                .map_err(|_| ErrorCode::StorageError)
        }
        #[cfg(not(windows))]
        {
            let _ = (&self.namespace, reference, secret);
            Err(ErrorCode::StorageError)
        }
    }
    fn delete(&self, reference: &str) -> Result<(), ErrorCode> {
        #[cfg(windows)]
        {
            match self.entry(reference)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(ErrorCode::StorageError),
            }
        }
        #[cfg(not(windows))]
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
