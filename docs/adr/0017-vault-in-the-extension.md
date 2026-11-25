# ADR-0017: The Vault in the Chrome extension

- Status: Accepted
- Date: 2026-11-25
- Related: ADR-0004, spec 0020

## Context

The founder wants passwords saved and filled in Chrome. A page is hostile by default: it can overlay an injected picker
(clickjacking), read anything put in its DOM, and imitate another site.

## Decision

- All cryptography is `packages/vault-crypto`, in the service worker. The API still holds only ciphertext.
- The unlocked key is kept in `chrome.storage.session` (memory, trusted contexts only), so a sleeping service worker does
  not ask for the passphrase every 30 seconds. It is removed on lock, after the auto-lock time, on disconnect and when
  Chrome closes. It is never written to disk.
- **The picker and the save question live in the extension's popup or side panel, never in the page.**
- A password goes to a page only after a click in our UI, to the top frame, over https (or localhost), when the page's
  host equals the saved host or is a subdomain of it. The host is read again just before filling.
- A captured sign-in stays in session memory for at most 5 minutes, until saved or dismissed.

## Consequences

Someone controlling the Chrome profile while it is unlocked can read the Vault; the auto-lock bounds that. There is no
drop-down under the password field, which is the price of being immune to overlay attacks.
