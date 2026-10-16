// tab-data-backup.js — ES Module
import {
    state,
    backupElements, displayElements,
    autoPopup, addLog,
    TRANSIENT_EVENT_TYPES,
} from './shared.js';
import { handleBafangEvent } from './websocket.js';
import { updateControllerUI } from './tab-controller.js';
import { updateDisplayUI } from './tab-display.js';
import { populateHexEditor } from './tab-debug.js';
import { updateInfoUI, updateRideStatsUI } from './tab-info.js';

// Tabs whose fields are filled from device data. Restoring clears only these, so the
// firmware, sniffer, logger and debug tabs keep what the user set there.
const DATA_TAB_IDS = ['tab-controller', 'tab-display', 'tab-sensor', 'tab-battery', 'tab-gears', 'tab-gearsM820', 'tab-info'];

function localTimestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

backupElements.createBackupButton.onclick = () => {
    // Same flat format as before ({ type: event }), so older versions can still read it;
    // only live values, faults and acknowledgements are left out.
    const settings = Object.fromEntries(
        Object.entries(state.allEventsStore).filter(([type]) => !TRANSIENT_EVENT_TYPES.has(type)));
    if (Object.keys(settings).length === 0) {
        alert('No data to backup! Do sync data first by navigating through the tabs and using the sync buttons.');
        return;
    }
    const blob = new Blob([JSON.stringify(settings)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${localTimestamp()}_canable_backup.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
};

// A backup is an object keyed by event type, each value an event carrying that same
// type, its data and a timestamp. Returns the events worth restoring, or null when
// the file does not look like a backup at all.
function eventsFromBackup(backup) {
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) return null;
    const events = Object.entries(backup)
        .filter(([key, ev]) => ev && typeof ev === 'object' && ev.type === key && 'data' in ev && 'timestamp_us' in ev)
        .map(([, ev]) => ev);
    if (events.length === 0) return null;
    return events.filter((ev) => !TRANSIENT_EVENT_TYPES.has(ev.type));
}

backupElements.restoreBackupButton.onclick = () => {
    const fileInput = backupElements.restoreBackupInput;
    if (fileInput.files.length === 0) return;

    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        fileInput.value = "";
        // Everything is checked before the UI is touched: a wrong or damaged file used
        // to clear every field first and then fail silently on the server.
        let backup;
        try {
            backup = JSON.parse(e.target.result);
        } catch (error) {
            autoPopup(`"${file.name}" is not a valid JSON file: ${error.message}`, 'red');
            return;
        }
        const events = eventsFromBackup(backup);
        if (events === null) {
            autoPopup(`"${file.name}" is not a backup created by this application.`, 'red');
            return;
        }
        if (events.length === 0) {
            autoPopup(`"${file.name}" contains no settings to restore.`, 'red');
            return;
        }

        // Replayed here rather than sent through the server: instant, so nothing can be
        // written to the bike half way through, and limited to this browser tab.
        clearAllInputs();
        let failed = 0;
        for (const ev of events) {
            try {
                handleBafangEvent(ev, { fromBackup: true });
            } catch (error) {
                failed++;
                console.error(`Restoring ${ev.type} failed:`, error);
            }
        }
        const hasBikeData = restoreSaveBaselines();
        populateHexEditor();
        const skipped = Object.keys(backup).length - events.length;
        const summary = `Restored ${events.length - failed} item(s) from ${file.name}`
            + (skipped ? `, skipped ${skipped} item(s) holding live data or not recognised` : '')
            + (failed ? `, ${failed} failed (see console)` : '');
        addLog('RESTORE', summary);
        autoPopup(summary, failed ? 'red' : 'green');
        if (!hasBikeData) {
            const hint = 'Nothing has been read from the bike yet, so Save has nothing to compare the backup with. '
                + 'Sync the tabs first, then restore the backup again and save.';
            addLog('WARN', hint);
            alert(hint);
        }
    };
    reader.onerror = () => autoPopup(`Could not read "${file.name}".`, 'red');
    reader.readAsText(file);
};

// The Controller, Display and Info tabs save only the fields that differ from the
// values read, so after the replay above they would find nothing to write. Their
// comparison values go back to what was read from the bike; the input fields keep the
// backup's, and Save writes the difference. The Gears tabs and the Debug blocks write
// their whole restored data instead and are left as restored.
// Returns false when nothing was read from the bike in this session.
function restoreSaveBaselines() {
    const live = (type) => state.liveEventsStore[type]?.data ?? null;
    state.controllerParams1 = live('controller_params_1');
    state.displayData1 = live('display_data_1');
    state.controllerOtherInfo.manufacturer = live('controller_mfg')?.manufacturer ?? null;
    state.displayOtherInfo.manufacturer = live('display_mfg')?.manufacturer ?? null;
    state.displayOtherInfo.customerNumber = live('display_cn')?.customer_number ?? null;

    // Mileage is a record of the ride, not a setting: a backup must never wind the
    // display's odometer back, so these fields show the bike's values again.
    displayElements.totalMileageInput.value = '';
    displayElements.singleMileageInput.value = '';

    updateControllerUI();
    updateDisplayUI();
    updateInfoUI();
    return Object.keys(state.liveEventsStore).some((type) => !TRANSIENT_EVENT_TYPES.has(type));
}

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
    // lastControllerP1Read/P2Read are kept: they are what was really read from the bike,
    // which the checksum-fix buttons must keep writing, not the restored values.
    state.lastStartupAngle = null;
    state.rawParamData = {}; state.allEventsStore = {};
    updateRideStatsUI({ fromBackup: false });

    // Clear the fields of the data tabs. Checkboxes are left alone: the only one there
    // ("Auto correction") is a UI preference, not device data.
    for (const id of DATA_TAB_IDS) {
        const tab = document.getElementById(id);
        if (!tab) continue;
        tab.querySelectorAll('input').forEach(input => {
            if (!['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(input.type)) {
                input.value = '';
            }
        });
        tab.querySelectorAll('textarea').forEach(textarea => { textarea.value = ''; });
        tab.querySelectorAll('select').forEach(select => { select.selectedIndex = 0; });
    }
}
