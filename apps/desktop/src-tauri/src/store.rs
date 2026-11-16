//! Where the refresh token lives: Windows Credential Manager (macOS Keychain, Linux Secret Service). Never a file.
use std::sync::Mutex;

pub trait TokenStore: Send + Sync {
    fn get(&self) -> Option<String>;
    fn set(&self, token: Option<&str>);
}

pub struct KeyringStore {
    entry: keyring::Entry,
}

impl KeyringStore {
    pub fn new(profile: &str) -> Result<Self, keyring::Error> {
        Ok(Self {
            entry: keyring::Entry::new("ORVYN", &format!("refresh-token:{profile}"))?,
        })
    }
}

impl TokenStore for KeyringStore {
    fn get(&self) -> Option<String> {
        self.entry.get_password().ok()
    }
    fn set(&self, token: Option<&str>) {
        let _ = match token {
            Some(t) => self.entry.set_password(t),
            None => self.entry.delete_credential(),
        };
    }
}

/// Tests.
#[derive(Default)]
pub struct MemoryStore(pub Mutex<Option<String>>);

impl TokenStore for MemoryStore {
    fn get(&self) -> Option<String> {
        self.0.lock().unwrap().clone()
    }
    fn set(&self, token: Option<&str>) {
        *self.0.lock().unwrap() = token.map(str::to_owned);
    }
}
