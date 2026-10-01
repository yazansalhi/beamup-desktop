# BeamUp for Windows

Electron shell around the BeamUp web app (`/app`). It adds what the browser cannot do: a system-tray app that keeps
receiving, start with Windows, the Explorer right-click **Send with BeamUp** (files and folders), and saving received
files straight into `Downloads\BeamUp` (or a folder you pick) without prompts.

```bash
npm install
npm start                      # loads http://localhost:3011/app (dev servers must be running)
npm run dist                   # dist/BeamUp-Setup-<version>.exe (NSIS, per-user, no admin)
```

Flags: `--url=https://…/app` (overrides the server; also `config.json` → `url` in `%APPDATA%\BeamUp`), `--hidden` (start in
the tray; used by Start with Windows), `--send <path…>` (what the right-click menu passes), `--screenshot=<png>` + `--quit-after` (test helper).

How files move: Explorer → `--send` → main process queues entries → renderer gets `{path,name,size,type}` through the
`window.beamupDesktop` bridge and reads 64 KiB chunks over IPC while the WebRTC engine streams them. Received files are
written through the `sink*` bridge calls into the BeamUp folder as they arrive, so size is only limited by disk.

The installer is unsigned until a code-signing certificate is bought: SmartScreen shows "unknown publisher" on first run.
