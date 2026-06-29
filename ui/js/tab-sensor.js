// tab-sensor.js — ES Module
import {
    state, socket,
    sensorElements,
    safeSetText,
    addLog,
} from './shared.js';

export function updateSensorUI() {
    safeSetText(sensorElements.sensorTorqueValue, state.sensorRealtime?.torque);
    safeSetText(sensorElements.sensorCadenceValue, state.sensorRealtime?.cadence);

    if (sensorElements.realtimePlaceholder) {
        sensorElements.realtimePlaceholder.style.display = state.sensorRealtime ? 'none' : 'block';
    }
}

sensorElements.syncButton.onclick = () => {
    addLog('REQ', 'Syncing all Sensor data...');
    socket.send('READ:1:49:0'); // Realtime
};
