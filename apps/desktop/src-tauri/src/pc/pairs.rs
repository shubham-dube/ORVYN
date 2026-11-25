//! Who may use this PC from elsewhere: the switch, the PIN (Argon2id), the paired devices. Keys live in the Windows
//! Credential Manager; the rest is a small file. Changed only here, at the PC (ADR-0019).
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};

use super::seal::{b64, pairing_text, random, unb64, Key};

pub const PIN_TRIES: u32 = 5;
pub const PIN_MIN: usize = 6;
const PIN_MAX: usize = 64;
const PAIRS_MAX: usize = 10;
/// A code nobody used stops working.
const UNUSED_FOR_MS: i64 = 10 * 60_000;

pub trait KeyStore: Send + Sync {
    fn get(&self, id: &str) -> Option<String>;
    fn set(&self, id: &str, value: Option<&str>) -> bool;
}

pub struct KeyringKeys;

impl KeyStore for KeyringKeys {
    fn get(&self, id: &str) -> Option<String> {
        keyring::Entry::new("ORVYN", &format!("pc-pair:{id}"))
            .ok()?
            .get_password()
            .ok()
    }
    fn set(&self, id: &str, value: Option<&str>) -> bool {
        let Ok(e) = keyring::Entry::new("ORVYN", &format!("pc-pair:{id}")) else {
            return false;
        };
        match value {
            Some(v) => e.set_password(v).is_ok(),
            None => e.delete_credential().is_ok(),
        }
    }
}

/// Tests.
#[derive(Default)]
pub struct MemoryKeys(Mutex<HashMap<String, String>>);

impl KeyStore for MemoryKeys {
    fn get(&self, id: &str) -> Option<String> {
        self.0.lock().unwrap().get(id).cloned()
    }
    fn set(&self, id: &str, value: Option<&str>) -> bool {
        let mut m = self.0.lock().unwrap();
        match value {
            Some(v) => m.insert(id.into(), v.into()),
            None => m.remove(id),
        };
        true
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Pair {
    pub id: String,
    /// empty until it was used once
    pub name: String,
    pub made: i64,
    pub last: Option<i64>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct Saved {
    on: bool,
    pin: Option<String>,
    /// wrong PINs in a row
    wrong: u32,
    pairs: Vec<Pair>,
}

#[derive(Debug, PartialEq)]
pub enum Pin {
    Right,
    Wrong { left: u32 },
    Locked,
}

pub struct Pairs {
    path: PathBuf,
    keys: Box<dyn KeyStore>,
    saved: Saved,
}

impl Pairs {
    pub fn load(path: PathBuf, keys: Box<dyn KeyStore>) -> Self {
        let saved = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Self { path, keys, saved }
    }

    fn save(&self) -> Result<(), String> {
        let go = || -> std::io::Result<()> {
            if let Some(d) = self.path.parent() {
                std::fs::create_dir_all(d)?;
            }
            let tmp = self.path.with_extension("tmp");
            std::fs::write(&tmp, serde_json::to_vec(&self.saved)?)?;
            std::fs::rename(tmp, &self.path)
        };
        go().map_err(|_| "Couldn’t save that on this PC".to_owned())
    }

    pub fn on(&self) -> bool {
        self.saved.on && self.saved.pin.is_some()
    }
    pub fn has_pin(&self) -> bool {
        self.saved.pin.is_some()
    }
    pub fn locked(&self) -> bool {
        self.saved.wrong >= PIN_TRIES
    }
    pub fn list(&self) -> Vec<Pair> {
        self.saved.pairs.clone()
    }

    pub fn set_on(&mut self, on: bool) -> Result<(), String> {
        if on && self.saved.pin.is_none() {
            return Err("Choose a PIN first".into());
        }
        self.saved.on = on;
        self.save()
    }

    pub fn set_pin(&mut self, pin: &str) -> Result<(), String> {
        let n = pin.chars().count();
        if !(PIN_MIN..=PIN_MAX).contains(&n) {
            return Err(format!("The PIN needs {PIN_MIN} to {PIN_MAX} characters"));
        }
        let first = pin.chars().next();
        if pin.chars().all(|c| Some(c) == first) || "01234567890".contains(pin) || "09876543210".contains(pin) {
            return Err("That one is too easy to guess".into());
        }
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(pin.as_bytes(), &salt)
            .map_err(|_| "Couldn’t use that PIN".to_owned())?;
        self.saved.pin = Some(hash.to_string());
        self.saved.wrong = 0;
        self.save()
    }

    /// Only at the PC.
    pub fn unlock(&mut self) -> Result<(), String> {
        self.saved.wrong = 0;
        self.save()
    }

    /// The try is written down before it is checked, so pulling the plug gives no free ones.
    pub fn check_pin(&mut self, pin: &str) -> Pin {
        if self.locked() {
            return Pin::Locked;
        }
        let Some(hash) = self.saved.pin.clone() else {
            return Pin::Locked;
        };
        self.saved.wrong += 1;
        if self.save().is_err() {
            self.saved.wrong = PIN_TRIES; // can't count: no tries
            return Pin::Locked;
        }
        let right = pin.len() <= 4 * PIN_MAX
            && PasswordHash::new(&hash).is_ok_and(|h| Argon2::default().verify_password(pin.as_bytes(), &h).is_ok());
        if right {
            self.saved.wrong = 0;
            let _ = self.save();
            return Pin::Right;
        }
        match PIN_TRIES - self.saved.wrong {
            0 => Pin::Locked,
            left => Pin::Wrong { left },
        }
    }

    /// The code for one more device, shown once.
    pub fn pair(&mut self, pc: &str, now: i64) -> Result<String, String> {
        self.forget_unused(now, true);
        if self.saved.pairs.len() >= PAIRS_MAX {
            return Err("Remove a device first".into());
        }
        let (id, key) = (b64(&random::<12>()), random::<32>());
        if !self.keys.set(&id, Some(&b64(&key))) {
            return Err("Windows wouldn’t keep the key".into());
        }
        self.saved.pairs.push(Pair {
            id: id.clone(),
            name: String::new(),
            made: now,
            last: None,
        });
        self.save()?;
        Ok(pairing_text(&id, &key, pc))
    }

    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        self.keys.set(id, None);
        self.saved.pairs.retain(|p| p.id != id);
        self.save()
    }

    /// Another person may sign in here next.
    pub fn clear(&mut self) {
        for p in std::mem::take(&mut self.saved.pairs) {
            self.keys.set(&p.id, None);
        }
        self.saved = Saved::default();
        let _ = self.save();
    }

    fn forget_unused(&mut self, now: i64, all: bool) {
        let old: Vec<_> = self
            .saved
            .pairs
            .iter()
            .filter(|p| p.last.is_none() && (all || now - p.made > UNUSED_FOR_MS))
            .map(|p| p.id.clone())
            .collect();
        for id in old {
            let _ = self.remove(&id);
        }
    }

    pub fn key(&mut self, id: &str, now: i64) -> Option<Key> {
        self.forget_unused(now, false);
        self.saved.pairs.iter().find(|p| p.id == id)?;
        unb64(&self.keys.get(id)?)?.try_into().ok()
    }

    pub fn name(&self, id: &str) -> Option<String> {
        self.saved.pairs.iter().find(|p| p.id == id).map(|p| p.name.clone())
    }

    /// After the right PIN.
    pub fn used(&mut self, id: &str, name: &str, now: i64) {
        if let Some(p) = self.saved.pairs.iter_mut().find(|p| p.id == id) {
            if p.name.is_empty() {
                let clean: String = name.chars().filter(|c| !c.is_control()).take(60).collect();
                p.name = if clean.trim().is_empty() {
                    "A device".into()
                } else {
                    clean
                };
            }
            p.last = Some(now);
            let _ = self.save();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(name: &str) -> Pairs {
        let path = std::env::temp_dir().join(format!("orvyn-pairs-{name}-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        Pairs::load(path, Box::<MemoryKeys>::default())
    }

    #[test]
    fn five_wrong_pins_lock_it_until_someone_is_here_even_after_a_restart() {
        let mut p = pairs("pin");
        assert!(p.set_on(true).is_err());
        assert!(p.set_pin("12345").is_err());
        assert!(p.set_pin("123456").is_err());
        assert!(p.set_pin("777777").is_err());
        p.set_pin("826193").unwrap();
        p.set_on(true).unwrap();
        assert!(!std::fs::read_to_string(&p.path).unwrap().contains("826193"));
        assert_eq!(p.check_pin("000000"), Pin::Wrong { left: 4 });
        assert_eq!(p.check_pin("826193"), Pin::Right);
        for left in [4, 3, 2, 1] {
            assert_eq!(p.check_pin("x"), Pin::Wrong { left });
        }
        assert_eq!(p.check_pin("x"), Pin::Locked);
        assert_eq!(p.check_pin("826193"), Pin::Locked);
        let mut again = Pairs::load(p.path.clone(), Box::<MemoryKeys>::default());
        assert!(again.on());
        assert_eq!(again.check_pin("826193"), Pin::Locked);
        again.unlock().unwrap();
        assert_eq!(again.check_pin("826193"), Pin::Right);
    }

    #[test]
    fn a_code_is_for_one_device_expires_unused_and_goes_when_removed() {
        let mut p = pairs("pair");
        let id = |t: &str| t.split('.').nth(1).unwrap().to_owned();
        let a = id(&p.pair("PC", 0).unwrap());
        assert!(p.key(&a, 1000).is_some());
        assert!(p.key(&a, UNUSED_FOR_MS + 1).is_none());
        let b = id(&p.pair("PC", 0).unwrap());
        p.used(&b, "Phone\n", 5);
        assert_eq!(p.name(&b).as_deref(), Some("Phone"));
        assert!(p.key(&b, UNUSED_FOR_MS * 9).is_some());
        let c = id(&p.pair("PC", 0).unwrap());
        let d = id(&p.pair("PC", 1).unwrap()); // a new code replaces an unused one
        assert!(p.key(&c, 2).is_none() && p.key(&d, 2).is_some());
        p.remove(&b).unwrap();
        assert!(p.key(&b, 6).is_none());
        p.clear();
        assert!(p.list().is_empty() && !p.on() && !p.has_pin());
    }
}
