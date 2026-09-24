// Firmware-update benchmark that needs only the CANable - no bike, no display.
//
// It runs the real application stack (server.js, CanBusService, GSUsb, FwUpdater)
// against the adapter in silent loopback mode: the CAN controller acknowledges its
// own frames internally and never drives the bus lines, so it is safe to leave the
// adapter plugged into a bike. The display is simulated in software.
//
// What it answers: whether THIS computer produces the long transmit stalls that get
// firmware blocks rejected. On the bike, blocks were rejected after stalls of roughly
// 35 ms and more; on the development PC this benchmark shows about 3 ms.
//
// Usage (close the application first - this script starts its own server):
//   node tools/bench-adapter.js [runs] [firmware.bin] [window]
//     runs         how many transfers to run back to back (default 3)
//     firmware.bin any firmware file; only its size matters (default: synthetic 456572 B)
//     window       send window, as in the UI (default 4)
//
// Every run also writes a normal update log to logs/, which can be sent over as is.
'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUNS = Number(process.argv[2]) || 3;
const FW_FILE = process.argv[3];
const WINDOW = process.argv[4] !== undefined ? Number(process.argv[4]) : 4;
const DPC245_SIZE = 456572; // EVistDrive DPC245 image, the one most failures were seen with

// Simulated display, built from the captures: it buffers a 256-chunk block and at the
// block boundary answers 832A<i+1>, whose payload address is how far it has written.
class VirtualDisplay extends EventEmitter {
    constructor(numChunks, send) {
        super();
        this.n = numChunks;
        this.send = send;
        this.got = new Set([0, 1]);
    }
    prefix() { let k = 0; while (this.got.has(k)) k++; return k; }
    hex(v) { return v.toString(16).toUpperCase().padStart(4, '0'); }
    addr(a) { return [(a >>> 24) & 255, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, 0, 0, 8, 0]; }
    ack(id, bytes) {
        const data = new DataView(new ArrayBuffer(8));
        bytes.forEach((b, i) => data.setUint8(i, b));
        this.emit('raw_frame_received', { can_id: parseInt(id, 16), can_dlc: bytes.length, data });
    }
    async sendRawFrame(id, dataHex) {
        await this.send(id, dataHex);
        const f = id.toUpperCase();
        setImmediate(() => {
            if (f === '85194000') return this.ack('832A4000', []);
            if (f === '85196008') return this.ack('832A6008', [68, 80, 66, 70, 56, 49, 46, 48]);
            if (f === '85184001') return this.ack('832A4001', [0, 0, 0, 0, 0, 0, 0, 16]);
            const m = /^851([CDE])([0-9A-F]{4})$/.exec(f);
            if (!m) return;
            const i = parseInt(m[2], 16);
            this.got.add(i);
            if (i === 1) return this.ack('832A0002', this.addr(16));
            if (m[1] === 'E') return this.ack('832A' + this.hex(this.n), [0, 0, 0, 0]);
            if ((i - 1) % 256 === 0) this.ack('832A' + this.hex(i + 1), this.addr(this.prefix() * 8));
        });
        return true;
    }
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

function pick(lines, re) {
    const l = lines.find((x) => re.test(x));
    return l ? l.replace(/^\[\w+\]\s*/, '') : '';
}

(async () => {
    if (!(await portFree(8080))) {
        console.error('Port 8080 is busy - close the application before running the benchmark.');
        process.exit(1);
    }
    console.log('=== Machine ===');
    describeMachine().forEach((l) => console.log('  ' + l));

    require(path.join(ROOT, 'server.js'));
    // At startup the server briefly opens the adapter itself to read its name; starting
    // the transfer during that window both fails to open the device and skews timing.
    await new Promise((r) => setTimeout(r, 4000));

    const FwUpdater = require(path.join(ROOT, 'fw-updater'));
    const canbus = require(path.join(ROOT, 'canbus'));
    const res = await canbus.canDevice.start(250000, 0x03); // listen-only + loopback = silent loopback
    if (!res || !res.ok) {
        console.error(`\nAdapter not available: ${(res && res.msg) || 'unknown error'}`);
        process.exit(1);
    }
    canbus.isStarted = true;
    // canbus.start() normally wires this; the bench opens the device directly.
    canbus.canDevice.on('echo', (f) => canbus.emit('raw_frame_sent', f));
    await canbus.canDevice.startPolling();

    const buf = FW_FILE ? fs.readFileSync(FW_FILE) : Buffer.alloc(DPC245_SIZE);
    console.log(`\n=== ${RUNS} run(s), ${buf.length} B ${FW_FILE ? path.basename(FW_FILE) : '(synthetic)'}, send window ${WINDOW} ===`);

    const worst = [];
    for (let r = 1; r <= RUNS; r++) {
        const display = new VirtualDisplay(Math.ceil((buf.length - 16) / 8), (id, d) => canbus.sendRawFrame(id, d));
        const forward = (f) => display.emit('raw_frame_sent', f);
        canbus.on('raw_frame_sent', forward);
        const fw = new FwUpdater(display);
        fw.maxInFlight = WINDOW;
        fw.upgradeEndHoldMs = 0;           // no real display to hold the heartbeat for
        fw.emitProgress = async () => {};  // keeps the console readable
        const lines = [];
        const log = fw.logMessage.bind(fw);
        fw.logMessage = (m, t = 'INFO', ws = true) => { lines.push(`[${t}] ${m}`); log(m, t, false); };
        await fw.startUpdateProcedure(buf, 'HMI');
        canbus.removeListener('raw_frame_sent', forward);

        const stalls = pick(lines, /Stalls:/);
        const gc = pick(lines, /GC:/);
        const w = Number((/worst (\d+)us; worst event loop/.exec(stalls) || [])[1] || 0);
        worst.push(w);
        console.log(`\n--- run ${r}: ${lines.some((l) => l.includes('completed successfully')) ? 'completed' : 'FAILED'}`);
        console.log('  ' + pick(lines, /All data chunks|Stopped at/));
        console.log('  ' + stalls.replace(/ \(BESST reference.*$/, ''));
        console.log('  ' + gc);
    }

    const max = Math.max(...worst);
    console.log('\n=== Verdict ===');
    console.log(`  worst stall per run: ${worst.map((w) => (w / 1000).toFixed(1) + ' ms').join(', ')}`);
    if (max >= 30000) {
        console.log('  THIS COMPUTER REPRODUCES THE PROBLEM: stalls of 30 ms or more occur without a bike.');
        console.log('  Next: plug in the charger, set the "High performance" power plan and disable');
        console.log('  USB selective suspend, then run this again.');
    } else if (max >= 10000) {
        console.log('  Borderline: stalls of 10-30 ms. Not enough on their own to explain rejected blocks,');
        console.log('  but well above the ~3 ms measured on the development PC.');
    } else {
        console.log('  This computer is clean (under 10 ms). The long stalls seen on the bike come from');
        console.log('  something this benchmark does not have: the real display/bus or a connected browser.');
    }
    process.exit(0);
})();
