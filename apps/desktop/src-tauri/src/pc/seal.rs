//! Messages between a phone or browser and this PC (ADR-0019): XChaCha20-Poly1305 under the key made at pairing, bound
//! to the session, the direction and a counter. The same construction as packages/vault-crypto/src/pc.ts (shared test
//! vectors).
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;

pub type Key = [u8; 32];

pub fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    rand::rngs::OsRng.fill_bytes(&mut b);
    b
}

pub fn b64(b: &[u8]) -> String {
    B64.encode(b)
}

pub fn unb64(s: &str) -> Option<Vec<u8>> {
    B64.decode(s).ok()
}

fn aad(sid: &str, dir: char, n: u64) -> String {
    format!("orvyn-pc-v1|{sid}|{dir}|{n}")
}

fn seal_with(key: &Key, sid: &str, dir: char, n: u64, plain: &str, nonce: [u8; 24]) -> String {
    let aad = aad(sid, dir, n);
    let ct = XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plain.as_bytes(),
                aad: aad.as_bytes(),
            },
        )
        .expect("encrypting in memory");
    let mut out = nonce.to_vec();
    out.extend(ct);
    format!("m.{n}.{}", b64(&out))
}

fn open(key: &Key, sid: &str, dir: char, n: u64, frame: &str) -> Option<String> {
    let mut parts = frame.split('.');
    if parts.next()? != "m" || parts.next()? != n.to_string() {
        return None;
    }
    let raw = unb64(parts.next()?)?;
    if parts.next().is_some() || raw.len() < 24 + 16 {
        return None;
    }
    let aad = aad(sid, dir, n);
    let plain = XChaCha20Poly1305::new(key.into())
        .decrypt(
            XNonce::from_slice(&raw[..24]),
            Payload {
                msg: &raw[24..],
                aad: aad.as_bytes(),
            },
        )
        .ok()?;
    String::from_utf8(plain).ok()
}

/// One side of a session: counts what it sends and what it opens.
pub struct Channel {
    key: Key,
    sid: String,
    me: char,
    sent: u64,
    opened: u64,
}

impl Channel {
    /// `me`: 'p' for the PC, 'c' for the phone or browser.
    pub fn new(key: Key, sid: String, me: char) -> Self {
        Self {
            key,
            sid,
            me,
            sent: 0,
            opened: 0,
        }
    }

    pub fn seal(&mut self, plain: &str) -> String {
        let f = seal_with(&self.key, &self.sid, self.me, self.sent, plain, random());
        self.sent += 1;
        f
    }

    /// None for anything but the next message of the other side.
    pub fn open(&mut self, frame: &str) -> Option<String> {
        let from = if self.me == 'p' { 'c' } else { 'p' };
        let t = open(&self.key, &self.sid, from, self.opened, frame)?;
        self.opened += 1;
        Some(t)
    }
}

/// The code this PC shows once.
pub fn pairing_text(id: &str, key: &Key, name: &str) -> String {
    format!("ORVYN-PC1.{id}.{}.{}", b64(key), b64(name.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_bytes_as_the_browser_and_the_android_app() {
        let v: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../packages/vault-crypto/fixtures/pc-vectors.json"
        ))
        .unwrap();
        let s = |p: &serde_json::Value| p.as_str().unwrap().to_owned();
        let key: Key = unb64(&s(&v["key"])).unwrap().try_into().unwrap();
        let nonce: [u8; 24] = unb64(&s(&v["nonce"])).unwrap().try_into().unwrap();
        let sid = s(&v["sid"]);
        for m in v["messages"].as_array().unwrap() {
            let (dir, n) = (s(&m["dir"]).chars().next().unwrap(), m["n"].as_u64().unwrap());
            assert_eq!(seal_with(&key, &sid, dir, n, &s(&m["plain"]), nonce), s(&m["frame"]));
            assert_eq!(open(&key, &sid, dir, n, &s(&m["frame"])), Some(s(&m["plain"])));
        }
        let p = &v["pairing"];
        assert_eq!(pairing_text(&s(&p["id"]), &key, &s(&p["name"])), s(&p["text"]));
    }

    #[test]
    fn refuses_changed_repeated_reordered_reflected_and_foreign_messages() {
        let key = random::<32>();
        let mut phone = Channel::new(key, "s1".into(), 'c');
        let mut pc = Channel::new(key, "s1".into(), 'p');
        let (a, b) = (phone.seal("a"), phone.seal("b"));
        assert!(pc.open(&b).is_none());
        let mut bad = a.clone().into_bytes();
        let at = bad.len() - 10;
        bad[at] = if bad[at] == b'A' { b'B' } else { b'A' };
        assert!(pc.open(&String::from_utf8(bad).unwrap()).is_none());
        assert!(phone.open(&a).is_none());
        assert!(Channel::new(key, "s2".into(), 'p').open(&a).is_none());
        assert!(Channel::new(random(), "s1".into(), 'p').open(&a).is_none());
        assert_eq!(pc.open(&a).as_deref(), Some("a"));
        assert!(pc.open(&a).is_none());
        assert_eq!(pc.open(&b).as_deref(), Some("b"));
        for junk in ["", "m", "m.2", "m.2.", "m.2.AAAA", "m.2.AAAA.x", "x.2.AAAA"] {
            assert!(pc.open(junk).is_none());
        }
    }
}
