// Firmware-update benchmark that needs only the CANable - no bike, no display.
//
// It runs the real application stack (server.js, CanBusService, GSUsb, FwUpdater)
// against the adapter in silent loopback mode: the CAN controller acknowledges its
// own frames internally and never drives the bus lines, so it is safe to leave the
// adapter plugged into a bike. The display is simulated in software, attached to the
// CanBusService itself, so the updater cannot tell it apart from the real one.
//
// What it answers: whether THIS computer produces the long transmit stalls that get
// firmware blocks rejected. On the bike, blocks were rejected after stalls of roughly
// 35 ms and more; on the development PC this benchmark shows about 3 ms.
//
// Modes, to find out which part of the application a stall comes from:
//   (default)  the updater is driven directly, with no WebSocket attached
//   --ws       the update is started over a WebSocket exactly as the UI does it, so
//              the server path and every log/progress message to the client run too
//   --ui       nothing is started automatically: open http://localhost:8080 in the
//              browser and upload any .bin from the Firmware tab as usual (mode HMI).
//              This adds the browser rendering the update on the same machine.
//
// Usage (close the application first - this script starts its own server):
//   node tools/bench-adapter.js [--ws|--ui] [runs] [firmware.bin] [window]
//     runs         transfers to run back to back (default 3; ignored with --ui)
//     firmware.bin any firmware file; only its size matters (default: synthetic 456572 B)
//     window       send window, as in the UI (default 4)
//
// Every run also writes a normal update log to logs/, which can be sent over as is.
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const MODE = flags.includes('--ui') ? 'ui' : flags.includes('--ws') ? 'ws' : 'direct';
const RUNS = Number(args[0]) || 3;
const FW_FILE = args[1];
const WINDOW = args[2] !== undefined ? Number(args[2]) : 4;
const DPC245_SIZE = 456572; // EVistDrive DPC245 image, the one most failures were seen with

// Simulated display, built from the captures. It sees every frame handed to the
// adapter and answers on the CanBusService like the real display would: it buffers
// a 256-chunk block and at the boundary sends 832A<i+1>, whose payload is the flash
// address it has written up to. It deliberately does not go by the adapter's echoes:
// about one per run goes missing, and a real display never depends on them.
function attachVirtualDisplay(canbus) {
    let got, numChunks;
    const reset = () => { got = new Set([0, 1]); numChunks = 0; };
    reset();
    const prefix = () => { let k = 0; while (got.has(k)) k++; return k; };
    const hex = (v) => v.toString(16).toUpperCase().padStart(4, '0');
    const addr = (a) => [(a >>> 24) & 255, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, 0, 0, 8, 0];
    const answer = (id, bytes) => {
        const data = new DataView(new ArrayBuffer(8));
        bytes.forEach((b, i) => data.setUint8(i, b));
        canbus.emit('raw_frame_received', { can_id: parseInt(id, 16), can_dlc: bytes.length, data });
    };
    const send = canbus.sendRawFrame.bind(canbus);
    canbus.sendRawFrame = async (idHex, dataHex) => {
        const sent = await send(idHex, dataHex);
        const f = idHex.toUpperCase();
        setImmediate(() => {
            if (f === '85194000') { reset(); return answer('832A4000', []); }
            if (f === '85196008') return answer('832A6008', [68, 80, 66, 70, 56, 49, 46, 48]);
            if (f === '85184001') {
                numChunks = Math.ceil(parseInt(dataHex.slice(0, 6), 16) / 8);
                return answer('832A4001', [0, 0, 0, 0, 0, 0, 0, 16]);
            }
            const m = /^851([CDE])([0-9A-F]{4})$/.exec(f);
            if (!m) return;
            const i = parseInt(m[2], 16);
            got.add(i);
            if (i === 1) return answer('832A0002', addr(16));
            if (m[1] === 'E') return answer('832A' + hex(numChunks), [0, 0, 0, 0]);
            if ((i - 1) % 256 === 0) answer('832A' + hex(i + 1), addr(prefix() * 8));
        });
        return sent;
    };
}

function run(cmd) {
    try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch (e) { return ''; }
}

// Power management is the prime suspect for multi-millisecond USB stalls on a laptop,
// so record it next to the results.
function describeMachine() {
    const lines = [
        `CPU:        ${os.cpus()[0].model} x${os.cpus().length}`,
        `System:     ${os.type()} ${os.release()}, Node ${process.version}`,
    ];
    if (process.platform === 'win32') {
        const plan = run('powercfg /getactivescheme');
        if (plan) lines.push(`Power plan: ${plan.replace(/^.*?:\s*/, '')}`);
        const battery = run('powershell -NoProfile -Command "(Get-CimInstance Win32_Battery | Select-Object -First 1).BatteryStatus"');
        if (battery) lines.push(`Power:      ${battery === '2' ? 'on AC' : `on battery (BatteryStatus=${battery})`}`);
        else lines.push('Power:      no battery reported (desktop?)');
    }
    return lines;
}

function portFree(port) {
    return new Promise((resolve) => {
        const s = net.createServer()
            .once('error', () => resolve(false))
            .once('listening', () => s.close(() => resolve(true)))
            .listen(port);
    });
}

const worst = [];
function report(lines, label) {
    const pick = (re) => { const l = lines.find((x) => re.test(x)); return l ? l.replace(/^\[\w+\]\s*/, '') : ''; };
    const stalls = pick(/Stalls:/);
    worst.push(Number((/worst (\d+)us; worst event loop/.exec(stalls) || [])[1] || 0));
    console.log(`\n--- ${label}: ${lines.some((l) => l.includes('completed successfully')) ? 'completed' : 'FAILED'}`);
    console.log('  ' + pick(/All data chunks|Stopped at/));
    console.log('  ' + stalls.replace(/ \(BESST reference.*$/, ''));
    console.log('  ' + pick(/GC:/));
}

function verdict() {
    const max = Math.max(...worst);
    console.log('\n=== Verdict ===');
    console.log(`  mode ${MODE}, worst stall per run: ${worst.map((w) => (w / 1000).toFixed(1) + ' ms').join(', ')}`);
    if (max >= 30000) {
        console.log('  THIS SETUP REPRODUCES THE PROBLEM: stalls of 30 ms or more occur without a bike.');
    } else if (max >= 10000) {
        console.log('  Borderline: stalls of 10-30 ms. Not enough on their own to explain rejected blocks,');
        console.log('  but well above the ~3 ms measured on the development PC.');
    } else {
        console.log('  Clean (under 10 ms): nothing in this setup produces the long stalls seen on the bike.');
    }
}

(async () => {
    if (!(await portFree(8080))) {
        console.error('Port 8080 is busy - close the application before running the benchmark.');
        process.exit(1);
    }
    console.log('=== Machine ===');
    describeMachine().forEach((l) => console.log('  ' + l));

    const FwUpdater = require(path.join(ROOT, 'fw-updater'));
    // Collect what every updater logs - including the ones server.js creates in the
    // --ws/--ui modes - without changing what it writes to the console or logs/.
    let current = null;
    const origLog = FwUpdater.prototype.logMessage;
    FwUpdater.prototype.logMessage = function (m, t = 'INFO', ws = true) {
        if (current) current.push(`[${t}] ${m}`);
        return origLog.call(this, m, t, ws);
    };
    // The 30 s host-present hold after an HMI update has nothing to hold for here and
    // happens after the stall figures are final, so skip it to keep runs short.
    const origHmi = FwUpdater.prototype.setupForHMI;
    FwUpdater.prototype.setupForHMI = function () { origHmi.call(this); this.upgradeEndHoldMs = 0; };

    require(path.join(ROOT, 'server.js'));
    // At startup the server briefly opens the adapter itself to read its name; starting
    // the transfer during that window both fails to open the device and skews timing.
    await new Promise((r) => setTimeout(r, 4000));

    const canbus = require(path.join(ROOT, 'canbus'));
    // Connect through the application's own path, only forcing silent loopback
    // (listen-only + loopback) so no second node is needed to acknowledge frames.
    const startDevice = canbus.canDevice.start.bind(canbus.canDevice);
    canbus.canDevice.start = (bitrate) => startDevice(bitrate, 0x03);
    await canbus.init();
    if (!canbus.isConnected()) {
        console.error('\nAdapter not available - is the CANable plugged in?');
        process.exit(1);
    }
    // In loopback the adapter also receives a copy of everything it sends, which the
    // real application never sees. Keep those copies out of the receive path so they
    // do not add parsing load that a real update does not have.
    canbus.canDevice.removeAllListeners('frame');
    canbus.canDevice.on('frame', (f) => { if (((f.can_id >>> 24) & 0xff) !== 0x85) canbus._handleFrameReceived(f); });
    attachVirtualDisplay(canbus);

    const buf = FW_FILE ? fs.readFileSync(FW_FILE) : Buffer.alloc(DPC245_SIZE);
    console.log(`\n=== mode ${MODE}, ${buf.length} B ${FW_FILE ? path.basename(FW_FILE) : '(synthetic)'}, send window ${WINDOW} ===`);

    if (MODE === 'ui') {
        console.log('\n  Open http://localhost:8080, go to the Firmware tab, choose "HMI", window ' + WINDOW + ',');
        console.log('  pick any .bin and start the upload. Repeat as often as you like; each update');
        console.log('  is summarised here. Stop with Ctrl+C.');
        current = [];
        FwUpdater.prototype.logMessage = function (m, t = 'INFO', ws = true) {
            if (current) current.push(`[${t}] ${m}`);
            const r = origLog.call(this, m, t, ws);
            if (typeof m === 'string' && m.startsWith('Runtime:')) {
                report(current, `update ${worst.length + 1}`);
                verdict();
                current = [];
            }
            return r;
        };
        return; // keep serving until Ctrl+C
    }

    if (MODE === 'ws') {
        const WebSocket = require('ws');
        const sock = new WebSocket('ws://localhost:8080');
        // server.js only attaches its message handler after an awaited presence check on
        // connection, so anything sent straight after 'open' is dropped. Its status
        // broadcast is sent right before the handler is attached - wait for that.
        await new Promise((res, rej) => { sock.once('message', res); sock.once('error', rej); });
        const b64 = buf.toString('base64');
        for (let r = 1; r <= RUNS; r++) {
            current = [];
            const ended = new Promise((res) => {
                const onMsg = (msg) => { if (String(msg).startsWith('FW_UPDATE_END')) { sock.off('message', onMsg); res(); } };
                sock.on('message', onMsg);
            });
            sock.send(`FW_UPDATE_START:HMI:${WINDOW}:${b64}`);
            await ended;
            report(current, `run ${r}`);
        }
        sock.close();
    } else {
        for (let r = 1; r <= RUNS; r++) {
            current = [];
            const fw = new FwUpdater(canbus);
            fw.maxInFlight = WINDOW;
            fw.emitProgress = async () => {};  // no client to report to in this mode
            await fw.startUpdateProcedure(buf, 'HMI');
            report(current, `run ${r}`);
        }
    }
    verdict();
    process.exit(0);
})();
