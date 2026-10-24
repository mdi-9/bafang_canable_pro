// The server side of the browser (WebUSB) version, in a dedicated worker.
//
// server.js and the modules it uses run here unchanged through node-shim.js, and the
// CANable is reached over WebUSB from this thread. In the Node build the server is a
// separate process; running it on the page's own thread instead meant that anything
// blocking the UI - a confirm() dialog before a save, a heavy chart redraw - also
// stopped the USB reads. The adapter then filled up with bus traffic and dropped the
// first frames sent after the dialog closed: the opening frame of a parameter write,
// so the controller acknowledged the rest but kept the old values. A worker keeps
// reading whatever the UI thread is doing, as the Node process did.
//
// boot.js talks to this worker with messages carrying the same strings the UI and
// server exchange over a WebSocket in the Node build.
/* global NodeShim, importScripts */
'use strict';

importScripts('node-shim.js');

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

const started = new Date();
const stamp = `${started.toISOString().slice(0, 10)}-${started.toTimeString().slice(0, 8).replace(/:/g, '-')}`;

// Everything the server side prints (sent frames, ACK timeouts, connect errors) is
// kept as a session log, so a test away from a developer console can be sent over.
const consoleLines = [];
NodeShim.logFiles.set(`logs/console-${stamp}.log`, consoleLines);
for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
        original(...args);
        const text = args.map((a) => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return `${a.name}: ${a.message}`;
            try { return JSON.stringify(a, (k, v) => (typeof v === 'bigint' ? v.toString() : v)); } catch (e) { return String(a); }
        }).join(' ');
        consoleLines.push(`${new Date().toISOString().slice(11, 23)} ${level === 'log' || level === 'info' ? '' : level.toUpperCase() + ' '}${text}`);
        if (consoleLines.length > 200000) consoleLines.splice(0, 50000);
    };
}

// --- 'ws', 'http', 'child_process' for server.js --------------------------------
let wsServer = null;
const sockets = new Map(); // bridge id -> ServerSocket

// The server's end of one bridged connection (one UI page).
class ServerSocket {
    constructor(id) {
        this.id = id;
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
    send(message) { postMessage({ type: 'msg', id: this.id, data: String(message) }); }
    terminate() {}
    close() {}
}
class WsServer {
    constructor() { this.handlers = { connection: [] }; wsServer = this; }
    on(event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); return this; }
    close(cb) { if (cb) cb(); }
}
NodeShim.registerBuiltin('ws', { Server: WsServer, OPEN: 1 });
NodeShim.registerBuiltin('http', {
    createServer: () => ({
        listen(port, cb) { if (cb) setTimeout(cb, 0); return this; },
        close(cb) { if (cb) cb(); },
    }),
});
NodeShim.registerBuiltin('child_process', { exec() {} });

// --- adapters -------------------------------------------------------------------
// The chooser runs on the page (it needs a user gesture); an adapter allowed there is
// visible here through getDevices().
async function refreshDevices() {
    const list = (await navigator.usb.getDevices()).filter(isAdapter);
    NodeShim.setDevices(list);
    postMessage({ type: 'devices', count: list.length });
    // Tell the UI now rather than at server.js's next 3 s presence poll.
    for (const s of sockets.values()) s.receive('GET_CAN_INTERFACE_STATUS');
}

// Every frame the adapter confirms it put on the bus (its echo: the real bus order of
// what we sent) and every frame received, with a timestamp.
function traceCanTraffic(canbus) {
    const lines = [];
    NodeShim.logFiles.set(`logs/can-trace-${stamp}.log`, lines);
    const t0 = performance.now();
    const add = (dir, f) => {
        if (!f || !f.data) return;
        const n = Math.min(f.can_dlc || 0, 8), bytes = [];
        for (let i = 0; i < n && i < f.data.byteLength; i++) bytes.push(f.data.getUint8(i).toString(16).toUpperCase().padStart(2, '0'));
        const id = ((f.can_id >>> 0) & 0x1FFFFFFF).toString(16).toUpperCase().padStart(8, '0');
        lines.push(`${((performance.now() - t0) / 1000).toFixed(4)} ${dir} ${id} [${n}] ${bytes.join(' ')}`);
        if (lines.length > 300000) lines.splice(0, 100000);
    };
    canbus.on('raw_frame_sent', (f) => add('TX', f));
    canbus.on('raw_frame_received', (f) => add('RX', f));
}

// --- messages from the page -----------------------------------------------------
onmessage = (e) => {
    const m = e.data;
    switch (m.type) {
    case 'open': {
        const s = new ServerSocket(m.id);
        sockets.set(m.id, s);
        for (const fn of wsServer.handlers.connection) fn(s);
        break;
    }
    case 'msg':
        if (sockets.has(m.id)) sockets.get(m.id).receive(m.data);
        break;
    case 'close':
        sockets.delete(m.id);
        break;
    case 'refresh':
        refreshDevices();
        break;
    case 'listLogs':
        postMessage({ type: 'logs', files: [...NodeShim.logFiles].map(([path, lines]) => ({ path, lines: lines.length })) });
        break;
    case 'getLog': {
        const lines = NodeShim.logFiles.get(m.path) || [];
        postMessage({ type: 'log', path: m.path, text: lines.join('\n') + '\n' });
        break;
    }
    }
};

async function start() {
    navigator.usb.addEventListener('connect', refreshDevices);
    navigator.usb.addEventListener('disconnect', refreshDevices);
    await refreshDevices();
    // Modules live at the repository root, two levels above this file.
    await NodeShim.preload('../../', MODULES);
    NodeShim.require('./server');
    const canbus = NodeShim.require('./canbus');
    traceCanTraffic(canbus);
    // server.js turns a failed connect into a bare FOUND status; the reason only reaches
    // the console. In a browser that reason is usually WebUSB specific (another tab or
    // program holds the adapter), so show it in the UI log as well.
    canbus.on('can_status', (connected, message) => {
        if (connected || !/error|fail/i.test(message || '')) return;
        let hint = '';
        if (/claim|access|in use|busy|open/i.test(message))
            hint = ' - close any other tab or program using the adapter (another copy of this page, the Node app), then try again';
        for (const s of sockets.values()) s.send(`CAN_ERROR: ${message}${hint}`);
    });
    console.log('[webusb] server.js running in a worker');
}

start().then(
    () => postMessage({ type: 'ready' }),
    (e) => { console.error('[webusb]', e); postMessage({ type: 'fail', message: e.message || String(e) }); });
