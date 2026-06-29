// tab-data-backup.js — ES Module
import {
    state, socket,
    backupElements,
    autoPopup,
} from './shared.js';

backupElements.createBackupButton.onclick = () => {
    if (Object.keys(state.allEventsStore).length === 0) {
        alert('No data to backup! Do sync data first by navigating through the tabs and using the sync buttons.');
        return;
    }
    let data = JSON.stringify(state.allEventsStore);
    let blob = new Blob([data], { type: 'application/json' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '_canable_backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

backupElements.restoreBackupButton.onclick = () => {
    const fileInput = backupElements.restoreBackupInput;
    if (fileInput.files.length === 0) return;

    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            clearAllInputs();
            socket.send(`RESTORE_BACKUP:${e.target.result}`);
            fileInput.value = "";
            autoPopup("Data will be restored.");
        } catch (error) {
            console.error('Error parsing backup file:', error);
        }
    };
    reader.readAsText(file);
};

function clearAllInputs() {
    // Clear global data stores so UI update functions don't repopulate fields from stale data
    state.displayData1 = null; state.displayData2 = null; state.displayRealtime = null; state.displayErrors = null; state.displayShutdownTime = null;
    Object.keys(state.displayOtherInfo).forEach(k => state.displayOtherInfo[k] = null);
    state.sensorRealtime = null;
    Object.keys(state.sensorOtherInfo).forEach(k => state.sensorOtherInfo[k] = null);
    state.batteryCapacity = null; state.batteryState = null; state.batteryCells = {}; state.batteryDesign = null; state.batteryChargingInfo = null; state.batteryCellsStats = null;
    Object.keys(state.batteryOtherInfo).forEach(k => state.batteryOtherInfo[k] = null);
    state.controllerRealtime0 = null; state.controllerRealtime1 = null; state.controllerState = null; state.controllerErrors = null;
    state.controllerParams0 = null; state.controllerParams1 = null; state.controllerParams2 = null; state.controllerSpeedParams = null;
    Object.keys(state.controllerOtherInfo).forEach(k => state.controllerOtherInfo[k] = null);
    state.lastControllerP0 = null; state.lastControllerP1 = null; state.lastControllerP2 = null;
    state.lastControllerP1Read = null; state.lastControllerP2Read = null;
    state.lastStartupAngle = null;
    state.rawParamData = {}; state.allEventsStore = {};

    // Clear all input fields
    document.querySelectorAll('input').forEach(input => {
        if (input.type === 'checkbox' || input.type === 'radio') {
            input.checked = false;
        } else if (input.type !== 'button' && input.type !== 'submit' && input.type !== 'reset' && input.type !== 'file') {
            input.value = '';
        }
    });
    // Clear all textarea fields
    document.querySelectorAll('textarea').forEach(textarea => {
        textarea.value = '';
    });
    // Reset all select fields
    document.querySelectorAll('select').forEach(select => {
        select.selectedIndex = 0;
    });
}
