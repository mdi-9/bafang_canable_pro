// Browser (WebUSB) version of the application: no Node install, no server process.
//
// server.js runs unchanged in a dedicated worker (server-worker.js) and reaches the
// CANable over WebUSB from there. The UI keeps talking to it exactly as before: the
// global WebSocket is replaced by a bridge to that worker before the UI modules load,
// so every UI <-> server message is the same string it is over the network in the
// Node build. The worker matters: on the page's own thread a confirm() dialog stopped
// the USB reads and the next parameter write lost its opening frame.
//
// Active only when the UI is served from a static web server with the repository
// root as document root (the page is at .../ui/, or at the root through index.html
// there, which sets <base href="ui/">), because the server modules are fetched from
// the directory above. Served by server.js (page at /, no base) nothing here runs and
// the UI uses its real WebSocket. Needs Chrome or Edge, over https or http://localhost.
'use strict';

(function () {
if (!new URL(document.baseURI).pathname.includes('/ui/')) return;

// Same list as GSUSBConstants.GS_USB_DEVICES.
const USB_FILTERS = [
    { vendorId: 0x1D50, productId: 0x606F },
    { vendorId: 0x1209, productId: 0x606F },
    { vendorId: 0x1CD2, productId: 0x606F },
    { vendorId: 0x16D0, productId: 0x10B8 },
];

let worker = null;
let markReady, markFailed;
const ready = new Promise((resolve, reject) => { markReady = resolve; markFailed = reject; });
ready.catch(() => {}); // reported on the page; each socket reports it again

// --- the UI's WebSocket ---------------------------------------------------------
const clients = new Map(); // bridge id -> BridgeWebSocket
let nextClientId = 1;

class BridgeWebSocket {
    constructor() {
        this.id = nextClientId++;
        this.readyState = BridgeWebSocket.CONNECTING;
        this.onopen = this.onmessage = this.onclose = this.onerror = null;
        this.listeners = {};
        ready.then(() => this.connect(), (e) => this.fail(e));
    }
    connect() {
        clients.set(this.id, this);
        worker.postMessage({ type: 'open', id: this.id });
        this.readyState = BridgeWebSocket.OPEN;
        this.emit('open', { type: 'open' });
    }
    fail(e) {
        this.readyState = BridgeWebSocket.CLOSED;
        this.emit('error', { type: 'error', message: e.message });
        this.emit('close', { type: 'close' });
    }
    send(message) {
        if (this.readyState !== BridgeWebSocket.OPEN) throw new Error('Bridge not open');
        onOutgoing(message);
        worker.postMessage({ type: 'msg', id: this.id, data: String(message) });
    }
    deliver(text) {
        onIncoming(text);
        this.emit('message', { type: 'message', data: text });
    }
    emit(type, event) {
        const handler = this['on' + type];
        if (handler) handler.call(this, event);
        (this.listeners[type] || []).forEach((fn) => fn.call(this, event));
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
    close() {
        if (this.readyState !== BridgeWebSocket.OPEN) return;
        this.readyState = BridgeWebSocket.CLOSED;
        clients.delete(this.id);
        worker.postMessage({ type: 'close', id: this.id });
    }
}
Object.assign(BridgeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
window.WebSocket = BridgeWebSocket;

// --- firmware update guard ------------------------------------------------------
// A sleeping screen can suspend the page and its worker, and a hidden tab may be
// throttled: say so for the duration of an update, and hold a screen wake lock.
let wakeLock = null;
function onOutgoing(message) {
    if (typeof message === 'string' && message.startsWith('FW_UPDATE_START:')) {
        ui.fwBanner.hidden = false;
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }, () => {});
    }
}
function onIncoming(text) {
    if (text.startsWith('FW_UPDATE_END')) {
        ui.fwBanner.hidden = true;
        if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
        if (!ui.logs.hidden) worker.postMessage({ type: 'listLogs' });
    }
}

// --- adapter selection and logs panel -------------------------------------------
const ui = {};
function buildPanel() {
    const css = document.createElement('style');
    css.textContent = `
      #webusb-panel { position: fixed; left: 12px; bottom: 12px; z-index: 9999; display: flex; gap: 6px; align-items: center;
        flex-wrap: wrap; max-width: calc(100vw - 24px); padding: 6px 8px; border-radius: 8px; font: 13px/1.3 system-ui, sans-serif;
        background: #1f2937; color: #f3f4f6; box-shadow: 0 2px 10px rgba(0,0,0,.3); }
      #webusb-panel button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid #60a5fa;
        background: #2563eb; color: #fff; cursor: pointer; }
      #webusb-panel button.secondary { background: transparent; color: #bfdbfe; }
      #webusb-logs { position: fixed; left: 12px; bottom: 56px; z-index: 9999; max-height: 50vh; overflow: auto; min-width: 260px;
        max-width: calc(100vw - 24px); padding: 8px; border-radius: 8px; background: #111827; color: #f3f4f6;
        font: 12px/1.5 ui-monospace, Consolas, monospace; box-shadow: 0 2px 10px rgba(0,0,0,.3); }
      #webusb-logs a { color: #93c5fd; display: block; }
      #webusb-fw { position: fixed; top: 0; left: 0; right: 0; z-index: 10000; padding: 8px 12px; text-align: center;
        background: #b45309; color: #fff; font: 600 14px/1.3 system-ui, sans-serif; }
      /* Room below the page for the panel, so it never covers the last rows. */
      body { padding-bottom: 64px; }
      @media (max-width: 640px) {
        #webusb-panel { left: 8px; right: 8px; bottom: 8px; max-width: none; flex-wrap: nowrap; }
        #webusb-state { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #webusb-logs { left: 8px; right: 8px; bottom: 56px; min-width: 0; max-width: none; }
      }`;
    document.head.appendChild(css);

    const panel = document.createElement('div');
    panel.id = 'webusb-panel';
    panel.innerHTML = `<span>WebUSB</span><span id="webusb-state"></span>
      <button id="webusb-select">Select adapter</button>
      <button id="webusb-logbtn" class="secondary">Logs</button>`;
    const logs = document.createElement('div');
    logs.id = 'webusb-logs';
    logs.hidden = true;
    const fw = document.createElement('div');
    fw.id = 'webusb-fw';
    fw.hidden = true;
    fw.textContent = 'Firmware update running in the browser - keep this page on screen and the device awake until it finishes.';
    document.body.append(panel, logs, fw);

    Object.assign(ui, {
        state: panel.querySelector('#webusb-state'),
        select: panel.querySelector('#webusb-select'),
        logBtn: panel.querySelector('#webusb-logbtn'),
        logs, fwBanner: fw,
    });
    ui.select.onclick = selectAdapter;
    ui.logBtn.onclick = () => {
        ui.logs.hidden = !ui.logs.hidden;
        if (!ui.logs.hidden) worker.postMessage({ type: 'listLogs' });
    };
}

function showState(text) { if (ui.state) ui.state.textContent = text; }

function showDevices(count) {
    ui.select.hidden = count > 0;
    showState(count ? '' : '- no adapter allowed yet');
}

async function selectAdapter() {
    try {
        await navigator.usb.requestDevice({ filters: USB_FILTERS });
    } catch (e) {
        return; // chooser dismissed
    }
    worker.postMessage({ type: 'refresh' });
}

// Session logs (firmware update, sniffer, ride logger, console, CAN trace) live in
// the worker's memory; each one can be saved as a file. Lost on reload or close.
function showLogs(files) {
    ui.logs.innerHTML = '';
    ui.logBtn.textContent = `Logs (${files.length})`;
    if (!files.length) { ui.logs.textContent = 'No logs in this session yet.'; return; }
    for (const { path, lines } of files.slice().reverse()) {
        const a = document.createElement('a');
        a.textContent = `${path.split('/').pop()} (${lines} lines)`;
        a.href = '#';
        a.onclick = (e) => { e.preventDefault(); worker.postMessage({ type: 'getLog', path }); };
        ui.logs.appendChild(a);
    }
}

function saveLog(path, text) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = path.split('/').pop();
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// --- installable app, offline start ---------------------------------------------
// The manifest and the service worker sit at the repository root, one level above the
// page, so they cover both / and /ui/. Added from here, not in ui/index.html, because
// the Node build serves ui/ as its root and has neither.
function setUpPwa() {
    const root = new URL('../', document.baseURI);
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = new URL('manifest.webmanifest', root).href;
    document.head.appendChild(manifest);
    const theme = document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#1f2937';
    document.head.appendChild(theme);
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = new URL('icons/icon.svg', root).href;
    document.head.appendChild(icon);
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register(new URL('sw.js', root).href, { scope: root.href })
            .catch((e) => console.warn('[webusb] offline support unavailable:', e.message));
    }
}
setUpPwa();

// --- start ----------------------------------------------------------------------
function start() {
    buildPanel();
    // "Log to file" names the Node app's logs folder; here the files stay in the page.
    for (const el of document.querySelectorAll('.log-target'))
        el.textContent = '→ kept in this page, save it with Logs (bottom of the screen)';
    if (!('usb' in navigator)) {
        showState('- not available in this browser');
        ui.select.hidden = true;
        markFailed(new Error('WebUSB is not available: use Chrome or Edge, over https or http://localhost'));
        return;
    }
    worker = new Worker('webusb/server-worker.js');
    worker.onmessage = (e) => {
        const m = e.data;
        switch (m.type) {
        case 'ready': markReady(); break;
        case 'fail': showState('- failed to start, see the browser console'); markFailed(new Error(m.message)); break;
        case 'msg': if (clients.has(m.id)) clients.get(m.id).deliver(m.data); break;
        case 'devices': showDevices(m.count); break;
        case 'logs': showLogs(m.files); break;
        case 'log': saveLog(m.path, m.text); break;
        }
    };
    worker.onerror = (e) => {
        console.error('[webusb] worker error', e.message);
        showState('- failed to start, see the browser console');
        markFailed(new Error(e.message || 'worker failed'));
    };
}

// The panel needs <body>; the bridge already exists, and the UI modules only wait on
// `ready` before their socket opens.
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
