// Browser (WebUSB) version of the application: no Node install, no server process.
//
// server.js itself runs inside this page, unchanged, through node-shim.js; the CANable
// is reached over WebUSB. The UI keeps talking to it exactly as before: the global
// WebSocket is replaced by an in-page bridge before the UI modules load, so every
// UI <-> server message is the same string it is over the network in the Node build.
//
// Active only when the UI is served from a static web server with the repository
// root as document root (the page is then at .../ui/), because the server modules
// are fetched from the directory above. Served by server.js (page at /) nothing here
// runs and the UI uses its real WebSocket. Needs Chrome or Edge, over https or
// http://localhost.
/* global NodeShim */
'use strict';

(function () {
if (!location.pathname.includes('/ui/')) return;

const MODULES = [
    'server.js', 'canbus.js', 'gsusb.js', 'canframe.js', 'bafang-parser.js', 'bafang-serializer.js',
    'request-manager.js', 'bafang-can-requests.js', 'bafang-constants.js',
    'bafang-can-read-commands.js', 'bafang-can-write-commands.js', 'bafang-can-broadcast-commands.js',
    'fw-updater.js', 'sniffer.js', 'logger.js', 'utils.js',
];
// Same list as GSUSBConstants.GS_USB_DEVICES.
const USB_FILTERS = [
    { vendorId: 0x1D50, productId: 0x606F },
    { vendorId: 0x1209, productId: 0x606F },
    { vendorId: 0x1CD2, productId: 0x606F },
    { vendorId: 0x16D0, productId: 0x10B8 },
];
const isAdapter = (d) => USB_FILTERS.some((f) => f.vendorId === d.vendorId && f.productId === d.productId);

let markReady, markFailed;
const ready = new Promise((resolve, reject) => { markReady = resolve; markFailed = reject; });
ready.catch(() => {}); // reported on the page; each socket reports it again

// --- 'ws' for server.js ---------------------------------------------------------
let wsServer = null;
const clients = new Set();

// The server's end of one bridged connection.
class ServerSocket {
    constructor(client) {
        this.client = client;
        this.readyState = 1;
        this.handlers = {};
        // server.js attaches its 'message' handler only after an awaited presence
        // check; over a real socket anything sent before that is lost. Hold it instead.
        this.early = [];
    }
    on(event, fn) {
        (this.handlers[event] = this.handlers[event] || []).push(fn);
        if (event === 'message' && this.early.length) this.early.splice(0).forEach((m) => this.receive(m));
        return this;
    }
    receive(message) {
        const fns = this.handlers.message;
        if (!fns || !fns.length) { this.early.push(message); return; }
        for (const fn of fns) fn(message);
    }
    send(message) {
        const text = String(message);
        setImmediate(() => this.client.deliver(text));
    }
    terminate() {}
    close() {}
}
class WsServer {
    constructor() { this.handlers = { connection: [] }; wsServer = this; }
    on(event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); return this; }
    close(cb) { if (cb) cb(); }
}

// --- the UI's WebSocket ---------------------------------------------------------
class BridgeWebSocket {
    constructor() {
        this.readyState = BridgeWebSocket.CONNECTING;
        this.onopen = this.onmessage = this.onclose = this.onerror = null;
        this.listeners = {};
        ready.then(() => this.connect(), (e) => this.fail(e));
    }
    connect() {
        this.server = new ServerSocket(this);
        clients.add(this);
        this.readyState = BridgeWebSocket.OPEN;
        for (const fn of wsServer.handlers.connection) fn(this.server);
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
        setImmediate(() => this.server.receive(message));
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
    close() {}
}
Object.assign(BridgeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
window.WebSocket = BridgeWebSocket;

// --- firmware update guard ------------------------------------------------------
// A hidden tab is throttled, and a sleeping screen can suspend the page: either would
// stall the transfer. Say so for the duration, and hold a screen wake lock.
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
        refreshLogs();
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden && !ui.fwBanner.hidden) console.warn('[webusb] Tab hidden during a firmware update - it will be throttled');
});

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
        background: #b45309; color: #fff; font: 600 14px/1.3 system-ui, sans-serif; }`;
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
    fw.textContent = 'Firmware update running in the browser - keep this tab visible and the computer awake until it finishes.';
    document.body.append(panel, logs, fw);

    Object.assign(ui, {
        state: panel.querySelector('#webusb-state'),
        select: panel.querySelector('#webusb-select'),
        logBtn: panel.querySelector('#webusb-logbtn'),
        logs, fwBanner: fw,
    });
    ui.select.onclick = selectAdapter;
    ui.logBtn.onclick = () => { ui.logs.hidden = !ui.logs.hidden; refreshLogs(); };
}

function showState(text) { if (ui.state) ui.state.textContent = text; }

async function refreshDevices() {
    const list = (await navigator.usb.getDevices()).filter(isAdapter);
    NodeShim.setDevices(list);
    if (ui.select) ui.select.hidden = list.length > 0;
    showState(list.length ? '' : '- no adapter allowed yet');
    // Tell the UI now rather than at server.js's next 3 s presence poll.
    for (const c of clients) c.send('GET_CAN_INTERFACE_STATUS');
}

async function selectAdapter() {
    try {
        const dev = await navigator.usb.requestDevice({ filters: USB_FILTERS });
        NodeShim.selectDevice(dev);
    } catch (e) {
        return; // chooser dismissed
    }
    await refreshDevices();
}

// Session logs (firmware update, sniffer, ride logger) live in memory here; each one
// can be saved as a file. They are lost when the page is closed or reloaded.
function refreshLogs() {
    if (!ui.logs || ui.logs.hidden || !window.NodeShim) return;
    ui.logs.innerHTML = '';
    const files = [...NodeShim.logFiles.entries()];
    ui.logBtn.textContent = `Logs (${files.length})`;
    if (!files.length) { ui.logs.textContent = 'No logs in this session yet.'; return; }
    for (const [path, lines] of files.reverse()) {
        const a = document.createElement('a');
        const name = path.split('/').pop();
        a.textContent = `${name} (${lines.length} lines)`;
        a.href = '#';
        a.onclick = (e) => {
            e.preventDefault();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }));
            link.download = name;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        };
        ui.logs.appendChild(a);
    }
}

// --- start ----------------------------------------------------------------------
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Could not load ${src}`));
        document.head.appendChild(s);
    });
}

async function start() {
    buildPanel();
    if (!('usb' in navigator)) {
        showState('- not available in this browser');
        ui.select.hidden = true;
        throw new Error('WebUSB is not available: use Chrome or Edge, over https or http://localhost');
    }
    await loadScript('webusb/node-shim.js');
    NodeShim.registerBuiltin('ws', { Server: WsServer, OPEN: 1 });
    NodeShim.registerBuiltin('http', {
        createServer: () => ({
            listen(port, cb) { if (cb) setTimeout(cb, 0); return this; },
            close(cb) { if (cb) cb(); },
        }),
    });
    NodeShim.registerBuiltin('child_process', { exec() {} });
    navigator.usb.addEventListener('connect', refreshDevices);
    navigator.usb.addEventListener('disconnect', refreshDevices);
    await refreshDevices();
    await NodeShim.preload('../', MODULES);
    NodeShim.require('./server');
    console.log('[webusb] server.js running in the page');
}

// The panel needs <body>; the bridge must exist before the UI modules run, which it
// does already - they only wait on `ready`.
const begin = () => start().then(markReady, (e) => {
    console.error('[webusb]', e);
    markFailed(e);
});
if (document.body) begin(); else document.addEventListener('DOMContentLoaded', begin);
})();
