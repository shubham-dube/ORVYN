# ORVYN for Windows (Tauri 2)

A tray companion: starts with Windows (optional), shows ORVYN notifications as Windows toasts with **Open** and
**Dismiss**, and stays connected live. No window, no password: it connects through the web app.

- Connect: tray → _Connect to ORVYN…_ opens your browser at `/connect`; approve; the browser hands a one-time code to
  the app on `127.0.0.1` (PKCE, RFC 8252). The refresh token goes to **Windows Credential Manager**.
- Tray menu: status, Open ORVYN, Connect / Disconnect, Send a test notification, Pause notifications for 1 hour
  (urgent ones still come through), Start with Windows, Quit.
- Sign it out from any device (Settings → Security) and it disconnects immediately.

## Build and run on your PC

Needs Rust (`winget install Rustlang.Rustup`) and the WebView2 runtime (already on Windows 11).

```powershell
pnpm install
pnpm --filter @orvyn/desktop desktop:dev        # against your local API (pnpm dev running)
pnpm --filter @orvyn/desktop desktop:build      # installer: apps/desktop/src-tauri/target/release/bundle/nsis/*.exe
```

CI builds the Windows installer on every push (artifact **orvyn-windows**).

## Tests

```bash
cd apps/desktop/src-tauri
cargo test                                                 # PKCE, loopback, client, socket messages
ORVYN_LIVE_API=http://localhost:4100 cargo test --test live_api   # connect → live notification → remote sign-out
```
