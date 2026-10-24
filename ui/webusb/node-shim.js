// Runs the application's CommonJS modules unchanged in the browser.
//
// Used by the browser (WebUSB) version of the app (boot.js) and by
// tools/webusb-bench: the same server.js / canbus.js / gsusb.js / fw-updater.js
// the Node build uses are fetched and evaluated here, and only the Node built-ins
// they reach for are replaced. gsusb.js already
// talks the WebUSB API through node-usb's WebUSB class, so the 'usb' shim hands it
// a navigator.usb device instead, plus the one node-usb extension it relies on:
// getEndpoint().startPoll(), rebuilt from plain transferIn() calls.
'use strict';

(function () {

// --- setImmediate ---------------------------------------------------------------
// fw-updater polls an hrtime deadline on setImmediate so USB callbacks can run
// between checks. setTimeout(0) is not a substitute: nested timers are clamped to
// 4 ms. A MessageChannel post is a real macrotask without the clamp.
const immediateQueue = [];
const channel = new MessageChannel();
let nextImmediateId = 1;
const cancelledImmediates = new Set();
channel.port1.onmessage = () => {
    const batch = immediateQueue.splice(0, immediateQueue.length);
    for (const { id, fn, args } of batch) {
        if (cancelledImmediates.delete(id)) continue;
        try { fn(...args); } catch (e) { console.error('setImmediate callback failed', e); }
    }
};
function setImmediate(fn, ...args) {
    const id = nextImmediateId++;
    immediateQueue.push({ id, fn, args });
    if (immediateQueue.length === 1) channel.port2.postMessage(0);
    return id;
}
function clearImmediate(id) { cancelledImmediates.add(id); }

// --- process --------------------------------------------------------------------
// performance.now() is coarsened to 100 us without cross-origin isolation. That is
// plenty for the stall buckets fw-updater reports (2, 5, 20 and 50 ms).
const nowNs = () => BigInt(Math.round(performance.now() * 1e6));
const process = {
    env: {},
    platform: 'browser',
    version: navigator.userAgent,
    argv: [],
    hrtime: Object.assign(
        (prev) => {
            const ns = nowNs();
            let s = Number(ns / 1000000000n), n = Number(ns % 1000000000n);
            if (prev) { s -= prev[0]; n -= prev[1]; if (n < 0) { s--; n += 1e9; } }
            return [s, n];
        },
        { bigint: nowNs }),
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
    exit: (code) => { throw new Error(`process.exit(${code}) called`); },
    on() {},
};

// --- Buffer ---------------------------------------------------------------------
// Only what the modules use: from() of arrays, typed arrays and strings, alloc(),
// toString() and the little-endian readers the parser calls.
class Buffer extends Uint8Array {
    static from(value, encoding) {
        if (typeof value === 'string') return Buffer._fromString(value, encoding);
        if (value instanceof ArrayBuffer) return new Buffer(value);
        if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
            const b = new Buffer(value.length);
            b.set(value);
            return b;
        }
        // Node yields an empty buffer for a DataView; keep that behaviour.
        if (value instanceof DataView) return new Buffer(0);
        const b = new Buffer(value.length || 0);
        for (let i = 0; i < b.length; i++) b[i] = value[i] & 0xff;
        return b;
    }
    static _fromString(s, encoding = 'utf8') {
        if (encoding === 'hex') {
            const b = new Buffer(s.length >> 1);
            for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16);
            return b;
        }
        if (encoding === 'base64') {
            const bin = atob(s);
            const b = new Buffer(bin.length);
            for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
            return b;
        }
        if (encoding === 'ascii' || encoding === 'latin1' || encoding === 'binary') {
            const b = new Buffer(s.length);
            for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
            return b;
        }
        return Buffer.from(new TextEncoder().encode(s));
    }
    // fromCharCode(...bytes) overflows the stack on a firmware-sized buffer; go in slices.
    static _binary(view) {
        let s = '';
        for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
        return s;
    }
    static alloc(size, fill = 0) { const b = new Buffer(size); if (fill) b.fill(fill); return b; }
    static isBuffer(v) { return v instanceof Buffer; }
    static concat(list) {
        const b = new Buffer(list.reduce((n, x) => n + x.length, 0));
        let off = 0;
        for (const x of list) { b.set(x, off); off += x.length; }
        return b;
    }
    toString(encoding = 'utf8', start = 0, end = this.length) {
        const view = this.subarray(start, end);
        if (encoding === 'hex') return Array.from(view, (x) => x.toString(16).padStart(2, '0')).join('');
        if (encoding === 'base64') return btoa(Buffer._binary(view));
        if (encoding === 'ascii' || encoding === 'latin1' || encoding === 'binary')
            return Buffer._binary(view);
        return new TextDecoder().decode(view);
    }
    _dv() { return new DataView(this.buffer, this.byteOffset, this.byteLength); }
    readUInt8(o = 0) { return this[o]; }
    readUInt16LE(o = 0) { return this._dv().getUint16(o, true); }
    readUInt16BE(o = 0) { return this._dv().getUint16(o, false); }
    readUInt32LE(o = 0) { return this._dv().getUint32(o, true); }
    readUInt32BE(o = 0) { return this._dv().getUint32(o, false); }
    readInt16LE(o = 0) { return this._dv().getInt16(o, true); }
    readInt32LE(o = 0) { return this._dv().getInt32(o, true); }
}

// --- events ---------------------------------------------------------------------
class EventEmitter {
    constructor() { this._events = {}; }
    on(name, fn) { (this._events[name] = this._events[name] || []).push(fn); return this; }
    addListener(name, fn) { return this.on(name, fn); }
    once(name, fn) {
        const wrapped = (...a) => { this.off(name, wrapped); fn(...a); };
        wrapped.listener = fn;
        return this.on(name, wrapped);
    }
    off(name, fn) {
        const l = this._events[name];
        if (l) this._events[name] = l.filter((f) => f !== fn && f.listener !== fn);
        return this;
    }
    removeListener(name, fn) { return this.off(name, fn); }
    removeAllListeners(name) { if (name === undefined) this._events = {}; else delete this._events[name]; return this; }
    emit(name, ...args) {
        const l = this._events[name];
        if (!l || !l.length) {
            if (name === 'error') throw args[0];
            return false;
        }
        for (const f of l.slice()) f.apply(this, args);
        return true;
    }
    listenerCount(name) { return (this._events[name] || []).length; }
    listeners(name) { return (this._events[name] || []).slice(); }
    setMaxListeners() { return this; }
}

// --- usb ------------------------------------------------------------------------
// requestDevice() needs a user gesture, which gsusb.start() does not have by the time
// it asks, so the page asks the user first and the shim hands that device back:
// the one picked explicitly, else the first adapter the browser already allows.
let selectedDevice = null;
let knownDevices = [];
let pipelinedWrites = 0;

// server.js polls usb.getDeviceList() for the adapter and reads its name through the
// legacy (libusb style) device API. Answered from the WebUSB devices the page is
// allowed to use; nothing is opened, so this never competes with GSUsb for the device.
function legacyDeviceView(d) {
    const strings = { 1: d.manufacturerName, 2: d.productName, 3: d.serialNumber };
    return {
        deviceDescriptor: {
            idVendor: d.vendorId, idProduct: d.productId,
            iManufacturer: 1, iProduct: 2, iSerialNumber: 3, bNumConfigurations: 1,
        },
        interfaces: [],
        open() {},
        close() {},
        getStringDescriptor(index, cb) { setTimeout(() => cb(null, strings[index] || ''), 0); },
    };
}

// node-usb's endpoint.startPoll(n, size): n bulk IN transfers kept in flight, each
// completion emitted as 'data'. Rebuilt as n transferIn() loops.
class InEndpointPoller extends EventEmitter {
    constructor(device, number) {
        super();
        this.device = device;
        this.number = number;
        this.running = false;
        this.pending = 0;
        this.timeout = 0;
    }
    startPoll(count = 3, size = 1024) {
        this.running = true;
        for (let i = 0; i < count; i++) this._loop(size);
    }
    async _loop(size) {
        this.pending++;
        while (this.running) {
            try {
                const r = await this.device.transferIn(this.number, size);
                if (!this.running) break;
                if (r.status === 'ok') {
                    if (r.data && r.data.byteLength) this.emit('data', r.data);
                } else if (r.status === 'stall') {
                    await this.device.clearHalt('in', this.number);
                } else {
                    this.emit('error', new Error(`transferIn status ${r.status}`));
                }
            } catch (e) {
                // close() aborts the transfers still queued; that is the normal way out.
                if (this.running) {
                    this.running = false;
                    this.emit('error', e);
                }
            }
        }
        if (--this.pending === 0) this.emit('end');
    }
    // WebUSB cannot cancel a single transfer; the ones still queued end when the
    // device is closed, which gsusb.stop() does right after this.
    stopPoll(cb) {
        this.running = false;
        if (cb) setTimeout(cb, 0);
    }
}

// The subset of node-usb's WebUSBDevice that gsusb.js calls.
class WebUsbDeviceAdapter {
    constructor(dev) {
        this.dev = dev;
        this.device = { interfaces: [] };
    }
    get productName() { return this.dev.productName; }
    get manufacturerName() { return this.dev.manufacturerName; }
    get serialNumber() { return this.dev.serialNumber; }
    get configuration() { return this.dev.configuration; }
    async open() { if (!this.dev.opened) await this.dev.open(); }
    async close() { if (this.dev.opened) await this.dev.close(); }
    async reset() {
        // gsusb.start() resets before claiming. Not every OS/browser pairing allows it
        // on a composite device; the start sequence works without it, so log and go on.
        try { await this.dev.reset(); }
        catch (e) { console.warn(`[webusb] reset() not available here, continuing: ${e.message}`); }
    }
    async selectConfiguration(n) {
        if (this.dev.configuration && this.dev.configuration.configurationValue === n) return;
        await this.dev.selectConfiguration(n);
    }
    claimInterface(i) { return this.dev.claimInterface(i); }
    async releaseInterface(i) {
        try { await this.dev.releaseInterface(i); } catch (e) { console.warn(`[webusb] releaseInterface: ${e.message}`); }
    }
    clearHalt(dir, ep) { return this.dev.clearHalt(dir, ep); }
    transferIn(ep, len) { return this.dev.transferIn(ep, len); }
    // With pipelinedWrites = 0 every write is awaited, as node-usb does. Above 0 a
    // write returns as soon as it is queued, with at most that many still in flight:
    // in Chromium one transferOut round trip costs ~800 us and sometimes 10-25 ms, and
    // awaiting each one puts that whole latency between consecutive frames. A failure
    // is reported on the next write instead of the one that failed.
    async transferOut(ep, data) {
        if (!pipelinedWrites) return this.dev.transferOut(ep, data);
        this.inFlight = this.inFlight || [];
        while (this.inFlight.length >= pipelinedWrites) await Promise.race(this.inFlight);
        if (this.deferredFailure) {
            const failure = this.deferredFailure;
            this.deferredFailure = null;
            if (failure instanceof Error) throw failure;
            return { status: failure, bytesWritten: 0 };
        }
        const p = this.dev.transferOut(ep, data)
            .then((r) => { if (r.status !== 'ok') this.deferredFailure = r.status; },
                  (e) => { this.deferredFailure = e; })
            .finally(() => { this.inFlight.splice(this.inFlight.indexOf(p), 1); });
        this.inFlight.push(p);
        return { status: 'ok', bytesWritten: data.byteLength };
    }
    controlTransferIn(setup, len) { return this.dev.controlTransferIn(setup, len); }
    controlTransferOut(setup, data) { return this.dev.controlTransferOut(setup, data); }
    async getEndpoint(address) { return new InEndpointPoller(this.dev, address & 0x7f); }
}

const usbModule = {
    WebUSB: class {
        async requestDevice() {
            const dev = selectedDevice || knownDevices[0];
            if (!dev) throw new Error('No adapter selected - press "Select adapter" first');
            return new WebUsbDeviceAdapter(dev);
        }
    },
    getDeviceList: () => knownDevices.map(legacyDeviceView),
};

// --- fs / path / nanotimer / perf_hooks / os ------------------------------------
// utils.setupLogger writes session logs; here they are kept in memory so the page
// can offer them for download.
const logFiles = new Map();
const fsModule = {
    createWriteStream(path) {
        const lines = [];
        logFiles.set(path, lines);
        return {
            destroyed: false,
            writableEnded: false,
            write(s) { lines.push(s); return true; },
            end(cb) { this.writableEnded = true; if (cb) setTimeout(cb, 0); },
            on() { return this; },
            once() { return this; },
        };
    },
    promises: {
        mkdir: async () => {},
        readdir: async () => [],
    },
};
const pathModule = {
    join: (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'),
    basename: (p) => p.split('/').pop(),
    dirname: (p) => p.split('/').slice(0, -1).join('/'),
};

// nanotimer's setTimeout(task, args, '300u'): below a few ms it spins on
// setImmediate against an hrtime deadline. Same here, so delayu() behaves alike.
class NanoTimer {
    setTimeout(task, args, interval) {
        const m = /^(\d+(?:\.\d+)?)([smun])$/.exec(String(interval));
        const value = m ? Number(m[1]) : 0;
        const ms = !m ? 0 : m[2] === 's' ? value * 1000 : m[2] === 'm' ? value : m[2] === 'u' ? value / 1000 : value / 1e6;
        const run = () => task(...(Array.isArray(args) ? args : args === '' || args === undefined ? [] : [args]));
        if (ms > 25) { setTimeout(run, ms); return; }
        const deadline = performance.now() + ms;
        const poll = () => { if (performance.now() >= deadline) run(); else setImmediate(poll); };
        setImmediate(poll);
    }
    clearTimeout() {}
}

// monitorEventLoopDelay: how late a timer firing every `resolution` ms runs. Same
// idea as Node's histogram, reporting nanoseconds.
function monitorEventLoopDelay({ resolution = 10 } = {}) {
    let timer = null, expected = 0, samples = [];
    const h = {
        min: 0, max: 0, mean: 0,
        enable() {
            if (timer) return true;
            expected = performance.now() + resolution;
            const tick = () => {
                const now = performance.now();
                const lagNs = Math.max(0, now - expected) * 1e6;
                samples.push(lagNs);
                if (lagNs > h.max) h.max = lagNs;
                if (!h.min || lagNs < h.min) h.min = lagNs;
                h.mean = h.mean + (lagNs - h.mean) / samples.length;
                expected = now + resolution;
                timer = setTimeout(tick, resolution);
            };
            timer = setTimeout(tick, resolution);
            return true;
        },
        disable() { clearTimeout(timer); timer = null; return true; },
        reset() { samples = []; h.min = 0; h.max = 0; h.mean = 0; },
        percentile(p) {
            if (!samples.length) return 0;
            const s = samples.slice().sort((a, b) => a - b);
            return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
        },
    };
    return h;
}
// The browser exposes no GC timings; an observer that never fires reports 0.
class GcObserver { observe() {} disconnect() {} }

const osModule = {
    getPriority() { throw new Error('process priority is not available in a browser'); },
    setPriority() { throw new Error('process priority is not available in a browser'); },
    constants: { priority: { PRIORITY_HIGH: -14 } },
    platform: () => 'browser',
    cpus: () => [],
    type: () => 'browser',
    release: () => navigator.userAgent,
};

const builtins = {
    'usb': usbModule,
    'events': { EventEmitter },
    'node:events': { EventEmitter },
    'process': process,
    'node:process': process,
    'fs': fsModule,
    'path': pathModule,
    'nanotimer': NanoTimer,
    'perf_hooks': { monitorEventLoopDelay, PerformanceObserver: GcObserver, performance },
    'os': osModule,
};

// --- CommonJS loader ------------------------------------------------------------
// require() is synchronous, so every source is fetched up front and evaluated on
// first require, in the same order Node would.
const sources = new Map();
const cache = new Map();

function resolve(name) {
    const base = name.replace(/^\.\//, '');
    return base.endsWith('.js') ? base : base + '.js';
}

function requireModule(name) {
    if (builtins[name]) return builtins[name];
    const file = resolve(name);
    if (cache.has(file)) return cache.get(file).exports;
    const src = sources.get(file);
    if (src === undefined) throw new Error(`Module not preloaded: ${name}`);
    const module = { exports: {} };
    cache.set(file, module);
    // process, Buffer and setImmediate come from globalThis, not parameters: a module
    // may declare its own (canframe.js: const process = require('node:process')).
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename',
        `${src}\n//# sourceURL=${location.origin}/${file}`);
    fn(requireModule, module, module.exports, '', file);
    return module.exports;
}

async function preload(baseUrl, files) {
    await Promise.all(files.map(async (f) => {
        const r = await fetch(baseUrl + f, { cache: 'no-store' });
        if (!r.ok) throw new Error(`Fetching ${f}: HTTP ${r.status}`);
        sources.set(f, await r.text());
    }));
}

// Some modules use these as free globals rather than through require().
Object.assign(globalThis, { process, Buffer, setImmediate, clearImmediate });

globalThis.NodeShim = {
    preload,
    require: requireModule,
    selectDevice(dev) {
        selectedDevice = dev;
        if (dev && !knownDevices.includes(dev)) knownDevices.push(dev);
    },
    // The adapters the browser currently allows, refreshed on plug/unplug.
    setDevices(list) {
        knownDevices = list.slice();
        if (selectedDevice && !knownDevices.includes(selectedDevice)) selectedDevice = null;
    },
    registerBuiltin(name, mod) { builtins[name] = mod; },
    setPipelinedWrites(n) { pipelinedWrites = Math.max(0, n | 0); },
    logFiles,
    Buffer,
};

})();
