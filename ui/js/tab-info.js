// tab-info.js — ES Module
import {
    state, socket,
    infoElements,
    getNullableString,
    addLog, waitFor,
} from './shared.js';

export function updateInfoUI() {
    // Controller Info
    infoElements.ctrlHwVersionValue.textContent = getNullableString(state.controllerOtherInfo.hwVersion);
    infoElements.ctrlSwVersionValue.textContent = getNullableString(state.controllerOtherInfo.swVersion);
    infoElements.ctrlModelNumberValue.textContent = getNullableString(state.controllerOtherInfo.modelNumber);
    infoElements.ctrlSnValue.textContent = getNullableString(state.controllerOtherInfo.serialNumber);
    infoElements.ctrlProductionDateValue.textContent = getNullableString(state.controllerOtherInfo.productionDate);
    infoElements.ctrlBootloaderVersionValue.textContent = getNullableString(state.controllerOtherInfo.bootloaderVersion);
    infoElements.ctrlCnValue.textContent = getNullableString(state.controllerOtherInfo.customerNumber);
    infoElements.ctrlMfgValue.textContent = getNullableString(state.controllerOtherInfo.manufacturer);
    if (state.controllerOtherInfo.manufacturer !== null && infoElements.ctrlMfgInput.value === "") infoElements.ctrlMfgInput.value = state.controllerOtherInfo.manufacturer;
    const km = (v) => (v === null || v === undefined) ? 'N/A' : v.toFixed(2);
    infoElements.ctrlOdoValue.textContent = km(state.controllerOtherInfo.odoKm);
    infoElements.ctrlRecordOdoValue.textContent = km(state.controllerOtherInfo.recordOdoKm);
    infoElements.ctrlPlaceholder.style.display = (state.controllerOtherInfo.hwVersion || state.controllerOtherInfo.swVersion || state.controllerOtherInfo.modelNumber || state.controllerOtherInfo.bootloaderVersion || state.controllerOtherInfo.serialNumber || state.controllerOtherInfo.manufacturer || state.controllerOtherInfo.customerNumber) ? 'none' : 'block';

    // Display Info
    infoElements.displayHwVersionValue.textContent = getNullableString(state.displayOtherInfo.hwVersion);
    infoElements.displaySwVersionValue.textContent = getNullableString(state.displayOtherInfo.swVersion);
    infoElements.displayModelNumberValue.textContent = getNullableString(state.displayOtherInfo.modelNumber);
    infoElements.displayBootloaderVersionValue.textContent = getNullableString(state.displayOtherInfo.bootloaderVersion);
    infoElements.displaySnValue.textContent = getNullableString(state.displayOtherInfo.serialNumber);
    infoElements.displayProductionDateValue.textContent = getNullableString(state.displayOtherInfo.productionDate);
    infoElements.displayMfgValue.textContent = getNullableString(state.displayOtherInfo.manufacturer);
    if (state.displayOtherInfo.manufacturer !== null && infoElements.displayMfgInput.value === "") infoElements.displayMfgInput.value = state.displayOtherInfo.manufacturer;
    infoElements.displayCnValue.textContent = getNullableString(state.displayOtherInfo.customerNumber);
    if (state.displayOtherInfo.customerNumber !== null && infoElements.displayCnInput.value === "") infoElements.displayCnInput.value = state.displayOtherInfo.customerNumber;
    infoElements.displayPlaceholder.style.display = (state.displayOtherInfo.hwVersion || state.displayOtherInfo.swVersion || state.displayOtherInfo.modelNumber || state.displayOtherInfo.bootloaderVersion || state.displayOtherInfo.serialNumber || state.displayOtherInfo.manufacturer || state.displayOtherInfo.customerNumber) ? 'none' : 'block';

    // Sensor Info
    infoElements.sensorHwVersionValue.textContent = getNullableString(state.sensorOtherInfo.hwVersion);
    infoElements.sensorSwVersionValue.textContent = getNullableString(state.sensorOtherInfo.swVersion);
    infoElements.sensorModelNumberValue.textContent = getNullableString(state.sensorOtherInfo.modelNumber);
    infoElements.sensorSnValue.textContent = getNullableString(state.sensorOtherInfo.serialNumber);
    infoElements.sensorProductionDateValue.textContent = getNullableString(state.sensorOtherInfo.productionDate);
    infoElements.sensorPlaceholder.style.display = (state.sensorOtherInfo.hwVersion || state.sensorOtherInfo.swVersion || state.sensorOtherInfo.modelNumber || state.sensorOtherInfo.serialNumber) ? 'none' : 'block';

    // Battery Info
    infoElements.batteryHwVersionValue.textContent = getNullableString(state.batteryOtherInfo.hwVersion);
    infoElements.batterySwVersionValue.textContent = getNullableString(state.batteryOtherInfo.swVersion);
    infoElements.batteryModelNumberValue.textContent = getNullableString(state.batteryOtherInfo.modelNumber);
    infoElements.batterySnValue.textContent = getNullableString(state.batteryOtherInfo.serialNumber);
    infoElements.batteryProductionDateValue.textContent = getNullableString(state.batteryOtherInfo.productionDate);
    infoElements.batteryPlaceholder.style.display = (state.batteryOtherInfo.hwVersion || state.batteryOtherInfo.swVersion || state.batteryOtherInfo.modelNumber || state.batteryOtherInfo.serialNumber) ? 'none' : 'block';
}

// The 256-byte 6017/6018 blocks of newer controllers are BESST's Riding Record: 6017 the
// totals ("ODO"), 6018 the day trip ("DST", cleared by a trip reset on the display).
// Values are 32-bit LE, distance in 10 m and time in seconds; speed is not stored.
const RIDE_LEVELS = 9;
const RIDE_BLOCKS = {
    total: { type: 'controller_params_6017', timeAt: 18, distAt: 156 },
    trip: { type: 'controller_params_6018', timeAt: 0, distAt: 36 },
};
// 6017 also keeps the block total and a distance not assigned to any level (offset 192);
// the total is their sum and is what the controller broadcasts as 32 13.
const RIDE_TOTAL_AT = 0;
const RIDE_UNASSIGNED_AT = 192;

// Set when the table shows blocks restored from a backup file rather than read from the bike.
let rideStatsFromBackup = false;

const u32 = (b, i) => (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24) >>> 0;

function decodeRideBlock({ type, timeAt, distAt }) {
    const bytes = state.rawParamData[type];
    if (!Array.isArray(bytes) || bytes.length !== 256) return null;
    const levels = [];
    for (let k = 0; k < RIDE_LEVELS; k++)
        levels.push({ km: u32(bytes, distAt + 4 * k) / 100, s: u32(bytes, timeAt + 4 * k) });
    const km = levels.reduce((sum, l) => sum + l.km, 0);
    const s = levels.reduce((sum, l) => sum + l.s, 0);
    return { bytes, levels, sum: { km, s } };
}

function rideCells(row, sumKm) {
    if (!row) return '<td>-</td><td>-</td><td>-</td><td>-</td>';
    const speed = row.s > 0 ? (row.km / (row.s / 3600)).toFixed(1) : '0.0';
    const pct = sumKm > 0 ? (100 * row.km / sumKm).toFixed(2) : '0.00';
    return `<td>${row.km.toFixed(2)}</td><td>${(row.s / 3600).toFixed(2)}</td><td>${speed}</td><td>${pct} %</td>`;
}

export function updateRideStatsUI({ fromBackup } = {}) {
    if (fromBackup !== undefined) rideStatsFromBackup = fromBackup;
    const total = decodeRideBlock(RIDE_BLOCKS.total);
    const trip = decodeRideBlock(RIDE_BLOCKS.trip);
    const rows = [`<tr class="sum"><td>Sum</td>${rideCells(total?.sum, total?.sum.km)}${rideCells(trip?.sum, trip?.sum.km)}</tr>`];
    for (let k = 0; k < RIDE_LEVELS; k++)
        rows.push(`<tr><td>Level ${k + 1}</td>${rideCells(total?.levels[k], total?.sum.km)}${rideCells(trip?.levels[k], trip?.sum.km)}</tr>`);
    infoElements.rideStatsBody.innerHTML = rows.join('');

    const notes = [];
    if (total) {
        const blockKm = u32(total.bytes, RIDE_TOTAL_AT) / 100;
        const unassignedKm = u32(total.bytes, RIDE_UNASSIGNED_AT) / 100;
        notes.push(`Total in block: ${blockKm.toFixed(2)} km (levels ${total.sum.km.toFixed(2)} km + ${unassignedKm.toFixed(2)} km not assigned to a level).`);
    }
    for (const [label, block] of [['6017', RIDE_BLOCKS.total], ['6018', RIDE_BLOCKS.trip]]) {
        const bytes = state.rawParamData[block.type];
        if (Array.isArray(bytes) && bytes.length !== 256)
            notes.push(`Block ${label} has ${bytes.length} bytes; only the 256-byte blocks of newer controllers hold the riding record.`);
    }
    if ((total || trip) && rideStatsFromBackup) notes.push('Restored from a backup file, not read from the bike.');
    if (!total && !trip && notes.length === 0) notes.push('Riding record not yet read.');
    infoElements.rideStatsNote.textContent = notes.join(' ');
    infoElements.rideStatsNote.style.display = notes.length ? 'block' : 'none';
}

async function rideStatsRead() {
    for (const [sub, block] of [[23, RIDE_BLOCKS.total], [24, RIDE_BLOCKS.trip]]) {
        delete state.rawParamData[block.type];
        socket.send(`READ:2:96:${sub}`);
        if (!await waitFor(() => state.rawParamData[block.type] !== undefined, 3000))
            addLog('WARN', `No answer to the riding record read (60${sub.toString(16)}).`);
    }
    updateRideStatsUI({ fromBackup: false });
}

async function controllerInfoSend() {
    state.controllerOtherInfo.hwVersion = null;
    socket.send('READ:2:96:0');
    await waitFor(() => state.controllerOtherInfo.hwVersion !== null);
    state.controllerOtherInfo.swVersion = null;
    socket.send('READ:2:96:1');
    await waitFor(() => state.controllerOtherInfo.swVersion !== null);
    state.controllerOtherInfo.serialNumber = null;
    socket.send('READ:2:96:3');
    await waitFor(() => state.controllerOtherInfo.serialNumber !== null);
    state.controllerOtherInfo.modelNumber = null;
    socket.send('READ:2:96:2');
    await waitFor(() => state.controllerOtherInfo.modelNumber !== null);
    state.controllerOtherInfo.bootloaderVersion = null;
    socket.send('READ:2:96:8');
    await waitFor(() => state.controllerOtherInfo.bootloaderVersion !== null);
    state.controllerOtherInfo.customerNumber = null;
    socket.send('READ:2:96:4');
    await waitFor(() => state.controllerOtherInfo.customerNumber !== null);
    socket.send('READ:2:96:5');
}

async function displayInfoSend() {
    state.displayOtherInfo.hwVersion = null;
    socket.send('READ:3:96:0');
    await waitFor(() => state.displayOtherInfo.hwVersion !== null);
    state.displayOtherInfo.swVersion = null;
    socket.send('READ:3:96:1');
    await waitFor(() => state.displayOtherInfo.swVersion !== null);
    state.displayOtherInfo.serialNumber = null;
    socket.send('READ:3:96:3');
    await waitFor(() => state.displayOtherInfo.serialNumber !== null);
    state.displayOtherInfo.bootloaderVersion = null;
    socket.send('READ:3:96:8');
    await waitFor(() => state.displayOtherInfo.bootloaderVersion !== null);
    state.displayOtherInfo.manufacturer = null;
    socket.send('READ:3:96:5');
    await waitFor(() => state.displayOtherInfo.manufacturer !== null);
    state.displayOtherInfo.customerNumber = null;
    socket.send('READ:3:96:4');
    await waitFor(() => state.displayOtherInfo.customerNumber !== null);
    socket.send('READ:3:96:2');
}

async function sensorInfoSend() {
    state.sensorOtherInfo.hwVersion = null;
    socket.send('READ:1:96:0');
    await waitFor(() => state.sensorOtherInfo.hwVersion !== null);
    state.sensorOtherInfo.swVersion = null;
    socket.send('READ:1:96:1');
    await waitFor(() => state.sensorOtherInfo.swVersion !== null);
    state.sensorOtherInfo.serialNumber = null;
    socket.send('READ:1:96:3');
    await waitFor(() => state.sensorOtherInfo.serialNumber !== null);
    socket.send('READ:1:96:2');
}

async function batteryInfoSend() {
    state.batteryOtherInfo.hwVersion = null;
    socket.send('READ:4:96:0');
    await waitFor(() => state.batteryOtherInfo.hwVersion !== null);
    state.batteryOtherInfo.swVersion = null;
    socket.send('READ:4:96:1');
    await waitFor(() => state.batteryOtherInfo.swVersion !== null);
    state.batteryOtherInfo.serialNumber = null;
    socket.send('READ:4:96:3');
    await waitFor(() => state.batteryOtherInfo.serialNumber !== null);
    socket.send('READ:4:96:2');
}

infoElements.syncButton.onclick = () => {
    addLog('REQ', 'Syncing all Device Info...');
    controllerInfoSend();
    displayInfoSend();
    sensorInfoSend();
    batteryInfoSend();
};

infoElements.rideStatsReadButton.onclick = () => {
    addLog('REQ', 'Reading the riding record (6017, 6018)...');
    rideStatsRead();
};

updateRideStatsUI();

infoElements.saveButton.onclick = () => {
    if (!confirm("Are you sure you want to save changes to device information?")) return;
    addLog('SAVE_REQ', 'Saving Device Info Changes...');
    let changesMade = false;

    const newCtrlMfg = infoElements.ctrlMfgInput.value;
    if (newCtrlMfg !== "" && newCtrlMfg !== state.controllerOtherInfo.manufacturer) {
        socket.send(`WRITE_LONG_STRING:2:96:5:${newCtrlMfg}`);
        addLog('SAVE_REQ', `Controller Manufacturer: ${newCtrlMfg}`);
        changesMade = true;
    }

    const newDisplayMfg = infoElements.displayMfgInput.value;
    if (newDisplayMfg !== "" && newDisplayMfg !== state.displayOtherInfo.manufacturer) {
        socket.send(`WRITE_LONG_STRING:3:96:5:${newDisplayMfg}`);
        addLog('SAVE_REQ', `Display Manufacturer: ${newDisplayMfg}`);
        changesMade = true;
    }

    const newDisplayCn = infoElements.displayCnInput.value;
    if (newDisplayCn !== "" && newDisplayCn !== state.displayOtherInfo.customerNumber) {
        socket.send(`WRITE_LONG_STRING:3:96:4:${newDisplayCn}`);
        addLog('SAVE_REQ', `Display Customer Number: ${newDisplayCn}`);
        changesMade = true;
    }

    if (!changesMade) {
        addLog('INFO', 'No device info changes detected to save.');
    }
};
