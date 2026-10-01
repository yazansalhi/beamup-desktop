// BeamUp for Windows: a thin Electron shell around the BeamUp web app that adds what a browser cannot do —
// system tray, start with Windows, the Explorer right-click "Send with BeamUp", and saving straight into a folder.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, nativeImage, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')

const DEFAULT_URL = 'https://beam-connect.com/app'
const APP_ID = 'com.beamup.desktop'
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', apk: 'application/vnd.android.package-archive', exe: 'application/vnd.microsoft.portable-executable' }

// ---------- config & args ----------
const rawArgs = process.argv.slice(app.isPackaged ? 1 : 2)
function argValue(args, name) { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
const configPath = () => path.join(app.getPath('userData'), 'config.json')
let config = {}
function loadConfig() { try { config = JSON.parse(fs.readFileSync(configPath(), 'utf8')) } catch { config = {} } }
function saveConfig() { try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(config, null, 2)) } catch {} }
function receiveFolder() { return config.folder || path.join(app.getPath('downloads'), 'BeamUp') }

let win = null
let tray = null
let quitting = false
let appUrl = DEFAULT_URL
const sendQueue = []            // entries waiting for the renderer
const allowedPaths = new Set()  // only files handed to us may be read by the renderer
const sinks = new Map()         // id -> { fd, path }
let sinkSeq = 1

// ---------- single instance: Explorer launches one process per selected file ----------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const paths = sendPathsFrom(argv.slice(1))
    if (paths.length) queueSend(paths)
    showWindow()
  })
  app.setAppUserModelId(APP_ID)
  app.whenReady().then(main)
}

function sendPathsFrom(args) {
  const i = args.indexOf('--send')
  if (i < 0) return []
  return args.slice(i + 1).filter((a) => !a.startsWith('--'))
}

function entriesFor(paths) {
  const out = []
  const walk = (p, depth) => {
    let st
    try { st = fs.statSync(p) } catch { return }
    if (st.isDirectory()) { if (depth > 6) return; for (const n of fs.readdirSync(p)) walk(path.join(p, n), depth + 1); return }
    if (!st.isFile() || out.length >= 200) return
    const ext = path.extname(p).slice(1).toLowerCase()
    out.push({ path: p, name: path.basename(p), size: st.size, type: MIME[ext] || '', mtime: st.mtimeMs })
  }
  for (const p of paths) walk(path.resolve(p), 0)
  return out
}

let flushTimer = null
function queueSend(paths) {
  for (const e of entriesFor(paths)) { allowedPaths.add(e.path); sendQueue.push(e) }
  clearTimeout(flushTimer)
  flushTimer = setTimeout(flushQueue, 350) // Explorer sends one instance per file; batch them
}
function flushQueue() {
  if (!sendQueue.length || !win || win.webContents.isLoading()) return
  const batch = sendQueue.splice(0)
  win.webContents.send('files:send', batch)
}

// ---------- window ----------
function createWindow(startHidden) {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, show: !startHidden,
    backgroundColor: '#F7FAF9', title: 'BeamUp',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#FFFFFF', symbolColor: '#4B5E5C', height: 36 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  })
  win.setMenuBarVisibility(false)
  win.loadURL(appUrl)
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide() } })
  win.on('closed', () => { win = null })
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { try { if (new URL(url).origin !== new URL(appUrl).origin) { e.preventDefault(); shell.openExternal(url) } } catch {} })
  win.webContents.on('did-finish-load', () => { flushQueue(); maybeScreenshot() })
  win.webContents.on('did-fail-load', (_e, code, desc) => { if (code !== -3) win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlinePage(desc))}`) })
}
function showWindow() { if (!win) createWindow(false); if (win.isMinimized()) win.restore(); win.show(); win.focus() }
function offlinePage(desc) { return `<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:Segoe UI,system-ui;background:#F7FAF9;color:#0E1A19;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center;max-width:420px"><div style="width:64px;height:64px;border-radius:999px;background:#0B7C73;margin:0 auto 16px"></div><h1 style="font-size:24px;margin:0 0 8px">BeamUp can’t reach the server</h1><p style="color:#4B5E5C;margin:0 0 20px">${desc || 'Check your internet connection.'}<br>${appUrl}</p><button onclick="location.href='${appUrl}'" style="height:44px;padding:0 20px;border-radius:999px;border:0;background:#0B7C73;color:#fff;font:700 14px Segoe UI,system-ui">Try again</button></div></body>` }

function maybeScreenshot() {
  const out = argValue(rawArgs, 'screenshot')
  if (!out || !win) return
  setTimeout(async () => { try { const img = await win.webContents.capturePage(); fs.writeFileSync(out, img.toPNG()) } catch (e) { console.error(e) } if (rawArgs.includes('--quit-after')) { quitting = true; app.quit() } }, Number(argValue(rawArgs, 'screenshot-delay') || 5000))
}

// ---------- tray ----------
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')))
  tray.setToolTip('BeamUp — ready to receive')
  refreshTray()
  tray.on('click', showWindow)
}
function refreshTray() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open BeamUp', click: showWindow },
    { label: 'Pair a phone', click: () => { showWindow(); win.webContents.send('navigate', { mode: 'pair' }) } },
    { label: 'Open BeamUp folder', click: openFolder },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: startupEnabled(), click: (item) => setStartup(item.checked) },
    { label: 'Add “Send with BeamUp” to the right-click menu', type: 'checkbox', checked: !!config.contextMenu, click: (item) => setContextMenu(item.checked) },
    { type: 'separator' },
    { label: `BeamUp ${app.getVersion()}`, enabled: false },
    { label: 'Quit', click: () => { quitting = true; app.quit() } },
  ]))
}

// ---------- settings ----------
function startupEnabled() { try { return app.getLoginItemSettings().openAtLogin } catch { return false } }
function setStartup(on) { try { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }) } catch {} refreshTray() }
function exeCommand() { return app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"` }
function reg(args) { return new Promise((resolve) => execFile('reg', args, { windowsHide: true }, (err, out, errOut) => resolve({ ok: !err, out, errOut }))) }
async function setContextMenu(on) {
  if (process.platform !== 'win32') return false
  const keys = ['HKCU\\Software\\Classes\\*\\shell\\BeamUp', 'HKCU\\Software\\Classes\\Directory\\shell\\BeamUp']
  if (on) {
    for (const k of keys) {
      await reg(['add', k, '/ve', '/d', 'Send with BeamUp', '/f'])
      await reg(['add', k, '/v', 'Icon', '/d', `${process.execPath},0`, '/f'])
      await reg(['add', `${k}\\command`, '/ve', '/d', `${exeCommand()} --send "%1"`, '/f'])
    }
  } else {
    for (const k of keys) await reg(['delete', k, '/f'])
  }
  config.contextMenu = !!on; saveConfig(); refreshTray()
  return true
}
function openFolder() { const dir = receiveFolder(); try { fs.mkdirSync(dir, { recursive: true }) } catch {} shell.openPath(dir) }
function settings() { return { startup: startupEnabled(), contextMenu: !!config.contextMenu, folder: receiveFolder(), version: app.getVersion(), hostname: os.hostname(), url: appUrl } }

// ---------- receive sink: the web app streams received files straight into the BeamUp folder ----------
function safeName(name) { return String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+$/, '_').slice(0, 200) }
function uniquePath(dir, name) {
  const ext = path.extname(name); const base = path.basename(name, ext)
  for (let n = 0; n < 1000; n++) { const p = path.join(dir, n ? `${base} (${n})${ext}` : name); if (!fs.existsSync(p)) return p }
  return path.join(dir, `${base}-${Date.now()}${ext}`)
}

function registerIpc() {
  ipcMain.on('settings:hostname', (e) => { e.returnValue = os.hostname() })
  // Test helper (never set by the installer): accept every incoming request so automated runs can exercise the receive path.
  ipcMain.on('settings:test-flags', (e) => { e.returnValue = { acceptAll: rawArgs.includes('--test-accept-all') } })
  ipcMain.handle('settings:get', () => settings())
  ipcMain.handle('settings:startup', (_e, v) => { setStartup(v); return settings() })
  ipcMain.handle('settings:context-menu', async (_e, v) => { await setContextMenu(v); return settings() })
  ipcMain.handle('settings:choose-folder', async () => { const r = await dialog.showOpenDialog(win, { title: 'Save received files to', defaultPath: receiveFolder(), properties: ['openDirectory', 'createDirectory'] }); if (!r.canceled && r.filePaths[0]) { config.folder = r.filePaths[0]; saveConfig() } return settings() })
  ipcMain.handle('settings:open-folder', () => { openFolder(); return true })
  ipcMain.handle('window:show', () => { showWindow(); return true })
  ipcMain.handle('files:pull', () => sendQueue.splice(0))
  ipcMain.handle('files:read-chunk', async (_e, p, offset, length) => {
    if (!allowedPaths.has(p)) throw new Error('not allowed')
    const fh = await fs.promises.open(p, 'r')
    try { const buf = Buffer.alloc(Math.max(0, Math.min(length, 4 * 1024 * 1024))); const { bytesRead } = await fh.read(buf, 0, buf.length, offset); return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead) }
    finally { await fh.close() }
  })
  ipcMain.handle('files:read', async (_e, p) => { if (!allowedPaths.has(p)) throw new Error('not allowed'); const st = await fs.promises.stat(p); if (st.size > 64 * 1024 * 1024) throw new Error('too big'); const b = await fs.promises.readFile(p); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength) })
  ipcMain.handle('sink:exists', (_e, name) => fs.existsSync(path.join(receiveFolder(), safeName(name))))
  ipcMain.handle('sink:open', (_e, name) => { const dir = receiveFolder(); fs.mkdirSync(dir, { recursive: true }); const p = uniquePath(dir, safeName(name)); const fd = fs.openSync(p, 'w'); const id = sinkSeq++; sinks.set(id, { fd, path: p }); return id })
  ipcMain.handle('sink:write', (_e, id, data) => { const s = sinks.get(id); if (!s) throw new Error('no sink'); const buf = Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength); fs.writeSync(s.fd, buf); return buf.length })
  ipcMain.handle('sink:close', (_e, id) => { const s = sinks.get(id); if (!s) return null; try { fs.closeSync(s.fd) } catch {} sinks.delete(id); return s.path })
  ipcMain.handle('sink:abort', (_e, id) => { const s = sinks.get(id); if (!s) return false; try { fs.closeSync(s.fd); fs.unlinkSync(s.path) } catch {} sinks.delete(id); return true })
}

// ---------- main ----------
function main() {
  loadConfig()
  appUrl = argValue(rawArgs, 'url') || config.url || DEFAULT_URL
  registerIpc()
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen'].includes(permission)))
  session.defaultSession.on('will-download', (_e, item) => { const dir = receiveFolder(); try { fs.mkdirSync(dir, { recursive: true }) } catch {} item.setSavePath(uniquePath(dir, safeName(item.getFilename()))) })
  const startHidden = rawArgs.includes('--hidden')
  createWindow(startHidden)
  createTray()
  const paths = sendPathsFrom(rawArgs)
  if (paths.length) { queueSend(paths); showWindow() }
  app.on('activate', showWindow)
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => { /* keep running in the tray */ })
}
