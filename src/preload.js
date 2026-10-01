// Bridge between the BeamUp web app and the Windows shell (context-isolated, sandboxed).
const { contextBridge, ipcRenderer } = require('electron')

let hostname = ''
let testFlags = {}
try { hostname = ipcRenderer.sendSync('settings:hostname') } catch {}
try { testFlags = ipcRenderer.sendSync('settings:test-flags') || {} } catch {}

contextBridge.exposeInMainWorld('beamupDesktop', {
  platform: process.platform,
  hostname,
  testFlags,
  onSendFiles: (cb) => { ipcRenderer.on('files:send', (_e, entries) => cb(entries)) },
  onNavigate: (cb) => { ipcRenderer.on('navigate', (_e, q) => cb(q)) },
  pullSendQueue: () => ipcRenderer.invoke('files:pull'),
  readChunk: (p, offset, length) => ipcRenderer.invoke('files:read-chunk', p, offset, length),
  readFile: (p) => ipcRenderer.invoke('files:read', p),
  sinkExists: (name) => ipcRenderer.invoke('sink:exists', name),
  sinkOpen: (name) => ipcRenderer.invoke('sink:open', name),
  sinkWrite: (id, data) => ipcRenderer.invoke('sink:write', id, data instanceof Uint8Array ? data : new Uint8Array(data)),
  sinkClose: (id) => ipcRenderer.invoke('sink:close', id),
  sinkAbort: (id) => ipcRenderer.invoke('sink:abort', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setStartup: (v) => ipcRenderer.invoke('settings:startup', !!v),
  setContextMenu: (v) => ipcRenderer.invoke('settings:context-menu', !!v),
  chooseFolder: () => ipcRenderer.invoke('settings:choose-folder'),
  openFolder: () => ipcRenderer.invoke('settings:open-folder'),
  show: () => ipcRenderer.invoke('window:show'),
})
