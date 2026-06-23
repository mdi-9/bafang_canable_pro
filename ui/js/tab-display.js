// tab-display.js — ES Module
import {
    state, socket,
    displayElements,
    safeSetText, safeSetInput, safeSetFormattedInput,
    getNullableNumber, getNullableBoolean,
    addLog, waitFor, delay,
    sendCustomFrame, encodeToHex,
    decodeCurrentAssistLevel,
    errorDescriptions, errorRecommendations,
    na,
} from './shared.js';

export function updateDisplayUI() {
    // Records
    safeSetText(displayElements.totalMileageValue, state.displayData1?.total_mileage);
    safeSetInput(displayElements.totalMileageInput, state.displayData1, 'total_mileage', Math.round);

    safeSetText(displayElements.singleMileageValue, state.displayData1?.single_mileage, (val) => getNullableNumber(val, 1));
    safeSetFormattedInput(displayElements.singleMileageInput, state.displayData1, 'single_mileage', (val) => val?.toFixed(1));

    safeSetText(displayElements.maxSpeedValue, state.displayData1?.max_speed, (val) => getNullableNumber(val, 1));
    safeSetText(displayElements.averageSpeedValue, state.displayData2?.average_speed, (val) => getNullableNumber(val, 1));
    safeSetText(displayElements.serviceMileageValue, state.displayData2?.service_mileage, (val) => getNullableNumber(val, 1));

    // Realtime State
    safeSetText(displayElements.assistLevelsValue, state.displayRealtime?.assist_levels);
    safeSetText(displayElements.modeValue, state.displayRealtime?.ride_mode);
    safeSetText(displayElements.boostValue, state.displayRealtime?.boost, (val) => getNullableBoolean(val, 'ON', 'OFF'));

    const decodedAssist = decodeCurrentAssistLevel(
        state.displayRealtime?.current_assist_level_code,
        state.displayRealtime?.assist_levels
    );
    safeSetText(displayElements.currentAssistValue, decodedAssist);

    safeSetText(displayElements.lightValue, state.displayRealtime?.light, (val) => getNullableBoolean(val, 'ON', 'OFF'));
    safeSetText(displayElements.upButtonValue, state.displayRealtime?.button_up, (val) => getNullableBoolean(val, 'Pressed', 'Not Pressed'));
    safeSetText(displayElements.downButtonValue, state.displayRealtime?.button_down, (val) => getNullableBoolean(val, 'Pressed', 'Not Pressed'));

    // Shutdown Time
    const shutdownVal = state.displayShutdownTime;
    safeSetText(displayElements.displayShutdownTimeValue, shutdownVal, (val) =>
        (val === 255) ? "OFF" : (val === null || val === undefined ? na : `${val} min`)
    );
}

export function createErrorsTable(errorBody, errors) {
    errorBody.innerHTML = '';
    if (Array.isArray(errors) && errors.length > 0) {
        errors.forEach(code => {
            const row = errorBody.insertRow();
            row.insertCell(0).textContent = code;
            row.insertCell(1).textContent = errorDescriptions[code] || "Unknown Description";
            row.insertCell(2).textContent = errorRecommendations[code] || "-";
        });
    } else if (errors === null) {
        errorBody.innerHTML = '<tr><td colspan="3">Data not yet received.</td></tr>';
    } else {
        errorBody.innerHTML = '<tr><td colspan="3">No errors reported.</td></tr>';
    }
}

displayElements.displayClearErrorsButton.onclick = async () => {
    socket.send("WRITE_SHORT:3:96:7:01");
    await delay(500);
    sendCustomFrame(encodeToHex(5, 3, 4, '6007'), '00');
    await delay(500);
    sendCustomFrame(encodeToHex(5, 3, 6, '0000'), '');
    await delay(500);
    socket.send('READ:3:96:7');
    addLog('SAVE_REQ', 'Clear Display Errors');
};

displayElements.syncButton.onclick = async () => {
    addLog('REQ', 'Syncing all Display data...');
    state.displayErrors = null;
    socket.send('READ:3:96:7'); // Errors
    await waitFor(() => state.displayErrors !== null);
    state.displayData1 = null;
    socket.send('READ:3:99:1'); // Data1
    await waitFor(() => state.displayData1 !== null);
    socket.send('READ:3:99:2'); // Data2
};

displayElements.saveButton.onclick = () => {
    if (!confirm("Are you sure you want to write changes to the Display?")) return;
    addLog('SAVE_REQ', 'Saving Display Changes...');
    let changesMade = false;

    const newTotalStr = displayElements.totalMileageInput.value;
    const newSingleStr = displayElements.singleMileageInput.value;
    if (newTotalStr !== "") {
        const newTotal = parseInt(newTotalStr, 10);
        if (!isNaN(newTotal) && newTotal !== Math.round(state.displayData1?.total_mileage)) {
            socket.send(`WRITE_DISP_TOTAL_MILEAGE:${newTotal}`);
            addLog('SAVE_REQ', `Display Total Mileage: ${newTotal}`);
            changesMade = true;
        } else if (isNaN(newTotal)) { addLog('ERROR', 'Invalid Total Mileage input.'); }
    }
    if (newSingleStr !== "") {
        const newSingle = parseFloat(newSingleStr);
        if (!isNaN(newSingle) && newSingle.toFixed(1) !== state.displayData1?.single_mileage?.toFixed(1)) {
            socket.send(`WRITE_DISP_SINGLE_MILEAGE:${newSingle}`);
            addLog('SAVE_REQ', `Display Single Mileage: ${newSingle}`);
            changesMade = true;
        } else if (isNaN(newSingle)) { addLog('ERROR', 'Invalid Single Mileage input.'); }
    }

    if (!changesMade) {
        addLog('INFO', 'No display changes detected to save.');
    }
};

displayElements.clearServiceButton.onclick = () => {
    const threshold = prompt("Enter new service interval (km):", "5000");
    if (threshold === null) {
        return;
    }
    const thresholdKm = parseInt(threshold, 10);
    if (isNaN(thresholdKm) || thresholdKm < 0) {
        alert("Invalid threshold. Please enter a non-negative number.");
        return;
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(`SET_AND_CLEAN_SERVICE_MILEAGE:${thresholdKm}`);
        addLog(`UI: Sent SET_AND_CLEAN_SERVICE_MILEAGE:${thresholdKm}`);
    } else {
        addLog("UI Error: WebSocket not connected.");
    }
};

displayElements.setTimeButton.onclick = () => {
    if (confirm("Are you sure you want to set the display clock to the current time?")) {
        const now = new Date(); const h = now.getHours(); const m = now.getMinutes(); const s = now.getSeconds();
        socket.send(`WRITE_DISP_TIME:${h}:${m}:${s}`);
        addLog('SAVE_REQ', 'Display Time (Now)');
    }
};
