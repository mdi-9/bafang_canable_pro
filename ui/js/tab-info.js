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
    infoElements.ctrlMfgValue.textContent = getNullableString(state.controllerOtherInfo.manufacturer);
    if (state.controllerOtherInfo.manufacturer !== null && infoElements.ctrlMfgInput.value === "") infoElements.ctrlMfgInput.value = state.controllerOtherInfo.manufacturer;
    infoElements.ctrlPlaceholder.style.display = (state.controllerOtherInfo.hwVersion || state.controllerOtherInfo.swVersion || state.controllerOtherInfo.modelNumber || state.controllerOtherInfo.serialNumber || state.controllerOtherInfo.manufacturer) ? 'none' : 'block';

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
