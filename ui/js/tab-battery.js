// tab-battery.js — ES Module
import {
    state, socket,
    batteryElements,
    safeSetText, getNullableNumber,
    addLog,
    na,
} from './shared.js';

export function updateBatteryUI() {
    // Capacity
    safeSetText(batteryElements.fullCapacityValue, state.batteryCapacity?.full_capacity);
    safeSetText(batteryElements.capacityLeftValue, state.batteryCapacity?.capacity_left);
    safeSetText(batteryElements.rsocValue, state.batteryCapacity?.rsoc);
    safeSetText(batteryElements.asocValue, state.batteryCapacity?.asoc);
    safeSetText(batteryElements.sohValue, state.batteryCapacity?.soh);
    if (batteryElements.capacityPlaceholder) batteryElements.capacityPlaceholder.style.display = state.batteryCapacity ? 'none' : 'block';

    // State
    safeSetText(batteryElements.voltageValue, state.batteryState?.voltage, (val) => getNullableNumber(val, 2));
    safeSetText(batteryElements.currentValue, state.batteryState?.current, (val) => getNullableNumber(val, 2));
    safeSetText(batteryElements.tempValue, state.batteryState?.temperature);
    if (batteryElements.statePlaceholder) batteryElements.statePlaceholder.style.display = state.batteryState ? 'none' : 'block';

    // Design
    safeSetText(batteryElements.totalCellsInSerieValue, state.batteryDesign?.total_cells_in_serie);
    safeSetText(batteryElements.totalSeriesParallelValue, state.batteryDesign?.total_series_parallel);
    safeSetText(batteryElements.capacityValue, state.batteryDesign?.capacity);
    if (batteryElements.designPlaceholder) batteryElements.designPlaceholder.style.display = state.batteryDesign ? 'none' : 'block';

    // Charging info
    safeSetText(batteryElements.chargeCyclesValue, state.batteryChargingInfo?.charge_cycles);
    safeSetText(batteryElements.maxUnchargedTimeValue, state.batteryChargingInfo?.max_uncharged_time);
    safeSetText(batteryElements.lastUnchargedTimeValue, state.batteryChargingInfo?.last_uncharged_time);
    if (batteryElements.chargingInfoPlaceholder) batteryElements.chargingInfoPlaceholder.style.display = state.batteryChargingInfo ? 'none' : 'block';

    // Cell Voltages
    const cellBody = batteryElements.cellVoltageTableBody;
    if (cellBody) {
        cellBody.innerHTML = '';
        const cellIndices = Object.keys(state.batteryCells).map(Number).sort((a, b) => a - b);
        if (cellIndices.length > 0) {
            if (batteryElements.cellsPlaceholder) batteryElements.cellsPlaceholder.style.display = 'none';
            let row = null;
            cellIndices.forEach((index, i) => {
                if (i % 4 === 0) {
                    row = cellBody.insertRow();
                }
                if (row) {
                    const cell = row.insertCell();
                    cell.innerHTML = `<span class="label">Cell ${index + 1}:</span> <span class="value">${state.batteryCells[index]?.toFixed(3) ?? na} V</span>`;
                }
            });
            // Pad the last row if needed
            if (row && cellIndices.length % 4 !== 0) {
                for (let i = cellIndices.length % 4; i < 4; i++) {
                    row.insertCell().textContent = '';
                }
            }
            // Cell Voltage stats
            if (state.batteryCellsStats) {
                safeSetText(batteryElements.cellMinVoltageValue, state.batteryCellsStats?.minVoltage);
                safeSetText(batteryElements.cellMaxVoltageValue, state.batteryCellsStats?.maxVoltage);
                safeSetText(batteryElements.cellDiffVoltageValue, state.batteryCellsStats?.diffVoltage);
            }
        } else {
            if (batteryElements.cellsPlaceholder) batteryElements.cellsPlaceholder.style.display = 'block';
            cellBody.innerHTML = '';
        }
    } else {
        console.warn("Battery UI Update: Cell voltage table body not found.");
    }
}

batteryElements.syncButton.onclick = () => {
    addLog('REQ', 'Syncing all Battery data...');
    socket.send('READ:4:52:0'); // Capacity
    socket.send('READ:4:52:1'); // State
    socket.send('READ:4:100:0'); // Design info
    socket.send('READ:4:100:1'); // Charging info
    socket.send('READ:4:100:2'); // Cells 0-3
    socket.send('READ:4:100:3'); // Cells 4-7
    socket.send('READ:4:100:4'); // Cells 8-11
    socket.send('READ:4:100:5'); // Cells 12-15
};
