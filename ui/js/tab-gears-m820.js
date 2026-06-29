// tab-gears-m820.js — ES Module
import {
    state, socket,
    gearsElementsM820, checksumElements,
    safeSetText, safeSetInput,
    addLog, waitFor,
    calculateStartPulse,
    START_PULSE_MIN, START_PULSE_MAX,
    uiToInternalAssistMap,
} from './shared.js';
import { handleAssistInputChange, handleTorqueInputChange, updatePasCurvesChartUnified, updateStartRampChartUnified } from './tab-gears.js';

export function updateGearsUIM820() {
    // --- Startup Angle ---
    safeSetText(gearsElementsM820.controllerStartupAngleValueEl, state.lastStartupAngle);
    safeSetInput(gearsElementsM820.controllerStartupAngleInputEl, { lastStartupAngle: state.lastStartupAngle }, 'lastStartupAngle');
    if (gearsElementsM820.startupAnglePlaceholderEl) {
        gearsElementsM820.startupAnglePlaceholderEl.style.display = (state.lastStartupAngle !== null && state.lastStartupAngle !== undefined) ? 'none' : 'block';
    }

    // --- Assist Levels Table ---
    const assistBody = gearsElementsM820.assistLevelTableBody;
    if (!assistBody) {
        console.error("Gears UI Update failed: assistLevelTableBody element not found!");
        if (gearsElementsM820.assistLevelPlaceholder) gearsElementsM820.assistLevelPlaceholder.style.display = 'block';
        return;
    }
    assistBody.innerHTML = '';

    const totalDisplayLevels = state.displayRealtime?.assist_levels;
    let currentLevelMapping = null;

    if (totalDisplayLevels && uiToInternalAssistMap[totalDisplayLevels]) {
        currentLevelMapping = uiToInternalAssistMap[totalDisplayLevels];
    }

    if (!currentLevelMapping) {
        console.warn(`Gears UI Update: No valid mapping for totalDisplayLevels: ${totalDisplayLevels}. Or displayRealtime not available. currentLevelMapping is null.`);
        if (gearsElementsM820.assistLevelPlaceholder) gearsElementsM820.assistLevelPlaceholder.style.display = 'block';
        if (gearsElementsM820.torqueProfilePlaceholder) gearsElementsM820.torqueProfilePlaceholder.style.display = 'block';
        return;
    }

    const p1 = state.lastControllerP1;

    if (!p1 || !p1.assist_levels) {
        console.warn("Gears UI Update: Missing P1 data, or their internal assist_levels arrays.");
        if (gearsElementsM820.assistLevelPlaceholder) gearsElementsM820.assistLevelPlaceholder.style.display = 'block';
        if (gearsElementsM820.torqueProfilePlaceholder) gearsElementsM820.torqueProfilePlaceholder.style.display = 'block';
        return;
    }

    if (gearsElementsM820.assistLevelPlaceholder) gearsElementsM820.assistLevelPlaceholder.style.display = 'none';

    for (let displayedLevel = 1; displayedLevel <= totalDisplayLevels; displayedLevel++) {
        const internalIndex = currentLevelMapping[displayedLevel];

        if (internalIndex === undefined) {
            console.warn(`No internal Bafang index found for displayed level ${displayedLevel} with ${totalDisplayLevels} total levels.`);
            continue;
        }
        if (internalIndex < 0 || internalIndex >= 9) {
            console.warn(`Internal Bafang index ${internalIndex} is out of bounds for displayed level ${displayedLevel}.`);
            continue;
        }

        const row = assistBody.insertRow();
        row.insertCell(0).textContent = displayedLevel;

        const cellCurrent = row.insertCell();
        const inputCurrent = document.createElement('input');
        inputCurrent.type = 'number';
        inputCurrent.min = 0; inputCurrent.max = 100; inputCurrent.step = 1;
        inputCurrent.value = (p1.assist_levels[internalIndex] && typeof p1.assist_levels[internalIndex].current_limit === 'number')
                               ? p1.assist_levels[internalIndex].current_limit : '';
        inputCurrent.placeholder = '0-100';
        inputCurrent.dataset.internalType = 'p1';
        inputCurrent.dataset.internalIndex = internalIndex.toString();
        inputCurrent.dataset.param = 'current_limit';
        inputCurrent.addEventListener('change', handleAssistInputChange);
        cellCurrent.appendChild(inputCurrent);
        cellCurrent.append(' %');

        const cellSpeed = row.insertCell();
        const inputSpeed = document.createElement('input');
        inputSpeed.type = 'number';
        inputSpeed.min = 0; inputSpeed.max = 100; inputSpeed.step = 1;
        inputSpeed.value = (p1.assist_levels[internalIndex] && typeof p1.assist_levels[internalIndex].speed_limit === 'number')
                             ? p1.assist_levels[internalIndex].speed_limit : '';
        inputSpeed.placeholder = '0-100';
        inputSpeed.dataset.internalType = 'p1';
        inputSpeed.dataset.internalIndex = internalIndex.toString();
        inputSpeed.dataset.param = 'speed_limit';
        inputSpeed.addEventListener('change', handleAssistInputChange);
        cellSpeed.appendChild(inputSpeed);
        cellSpeed.append(' %');
    }

    // --- Torque Profiles Table (from P2) ---
    const torqueBody = gearsElementsM820.torqueProfileTableBody;
    if (!torqueBody) {
        console.error("Gears UI Update failed: torqueProfileTableBody element not found!");
        if (gearsElementsM820.torqueProfilePlaceholder) gearsElementsM820.torqueProfilePlaceholder.style.display = 'block';
        return;
    }
    torqueBody.innerHTML = '';

    const p2 = state.lastControllerP2;
    const angle = state.lastStartupAngle;
    const signals = state.lastControllerP1?.pedal_sensor_signals_per_rotation;

    if (!p2 || !Array.isArray(p2.torque_profiles) || p2.torque_profiles.length < 6) {
        console.warn("Gears UI Update: P2 data or torque_profiles missing/invalid for torque table.");
        if (gearsElementsM820.torqueProfilePlaceholder) gearsElementsM820.torqueProfilePlaceholder.style.display = 'block';
        return;
    }

    if (p2.checksum_missmatch)
        checksumElements.gearsP2ChecksumWarning.style.display = 'block';
    else
        checksumElements.gearsP2ChecksumWarning.style.display = 'none';

    if (gearsElementsM820.torqueProfilePlaceholder) gearsElementsM820.torqueProfilePlaceholder.style.display = 'none';

    for (let i = 0; i < 6; i++) {
        const profileData = p2.torque_profiles[i];
        const row = torqueBody.insertRow();
        row.insertCell(0).textContent = i * 3 + ' to ' + (i * 3 + 3) + ' mph';

        const createInputCell = (paramName, value, min, max, step = 1, unit = '', isReadOnly = false, title = '') => {
            const cell = row.insertCell();
            const input = document.createElement('input');
            input.type = 'number';
            input.min = min; input.max = max; input.step = step;
            input.value = (typeof value === 'number') ? value : '';
            input.placeholder = `${min}-${max}`;
            input.dataset.profileIndex = i.toString();
            input.dataset.param = paramName;
            if (isReadOnly) {
                input.readOnly = true;
                input.disabled = true;
                if (title) input.title = title;
            } else {
                input.addEventListener('change', handleTorqueInputChange);
            }
            cell.appendChild(input);
            if (unit) cell.append(` ${unit}`);
            return cell;
        };

        createInputCell('start_torque_value', profileData?.start_torque_value, 0, 255, 1, '');
        createInputCell('max_torque_value', profileData?.max_torque_value, 0, 255, 1, '');
        createInputCell('return_torque_value', profileData?.return_torque_value, 0, 255, 1, '');
        createInputCell('max_current', profileData?.max_current, 0, 100, 1, '');
        createInputCell('min_current', profileData?.min_current, 0, 100, 1, '');

        let startPulseValue = '';
        let startPulseReadOnly = false;
        let startPulseTitle = '';
        if (i === 0) {
            startPulseValue = calculateStartPulse(angle, signals);
            startPulseReadOnly = true;
            startPulseTitle = "Calculated from Startup Angle & Cadence Signals (P1)";
        } else {
            startPulseValue = (profileData && typeof profileData.start_pulse === 'number') ? profileData.start_pulse : '';
        }
        createInputCell('start_pulse', startPulseValue, START_PULSE_MIN, START_PULSE_MAX, 1, '', startPulseReadOnly, startPulseTitle);

        createInputCell('current_decay_time', profileData?.current_decay_time, 5, 1275, 5, '');
        createInputCell('torque_decay_time', profileData?.torque_decay_time, 5, 1275, 5, '');
        createInputCell('stop_delay', profileData?.stop_delay, 2, 510, 2, '');
    }

    // --- Global Acceleration ---
    if (!p2 || !p2.acceleration_level) {
        console.warn("Gears UI Update: P2 data or global acceleration missing.");
        return;
    }

    safeSetText(gearsElementsM820.globalAccelerationValueEl, p2.acceleration_level);
    safeSetInput(gearsElementsM820.globalAccelerationInputEl, p2, 'acceleration_level');

    // --- Charts ---
    updatePasCurvesChartUnified(true);
    updateStartRampChartUnified(true);
}

gearsElementsM820.syncButton.onclick = async () => {
    addLog('REQ', 'Syncing Gears data ...');
    state.lastControllerP1 = null;
    socket.send('READ:2:96:17'); // Request Controller P1
    await waitFor(() => state.lastControllerP1 !== null);
    state.lastControllerP2 = null;
    socket.send('READ:2:96:18'); // Request Controller P2
    await waitFor(() => state.lastControllerP2 !== null);
    socket.send('READ_STARTUP_ANGLE');
};

gearsElementsM820.saveButton.onclick = async () => {
    const angleStr = gearsElementsM820.controllerStartupAngleInputEl?.value;
    const angleValue = (angleStr !== undefined && angleStr !== "") ? parseInt(angleStr, 10) : null;
    let angleIsValid = (angleValue !== null && !isNaN(angleValue) && angleValue >= 0 && angleValue <= 360);
    if (angleStr !== "" && !angleIsValid) {
        addLog('ERROR', `Invalid Startup Angle value entered: ${angleStr}. Must be 0-360.`);
        alert(`Invalid Startup Angle value entered: ${angleStr}. Must be between 0 and 360.`);
        return;
    }

    if (!state.lastControllerP1 || !state.lastControllerP2) {
        let missing = [];
        if (!state.lastControllerP1) missing.push("P1 (Assist Limits)");
        if (!state.lastControllerP2) missing.push("P2 (Torque)");
        addLog('ERROR', `Cannot save Assist Settings - read required Controller data first: ${missing.join(', ')}`);
        return;
    }

    if (!confirm("Are you sure you want to write Assist Level AND Torque Profile changes to the Controller?")) return;
    addLog('SAVE_REQ', 'Saving Gears & Assist Changes...');
    let changesMade = false;

    if (state.lastControllerP1) {
        socket.send(`WRITE_LONG_P1:${JSON.stringify(state.lastControllerP1)}`);
        addLog('SAVE_REQ', 'Controller Parameter 1 (Assist Levels)');
        changesMade = true;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (state.lastControllerP2) {
        const globalAccelerationStr = gearsElementsM820.globalAccelerationInputEl?.value;
        const globalAccelerationValue = (globalAccelerationStr !== undefined && globalAccelerationStr !== "") ? parseInt(globalAccelerationStr, 10) : null;
        let globalAccelerationIsValid = (globalAccelerationValue !== null && !isNaN(globalAccelerationValue) && globalAccelerationValue >= 1 && globalAccelerationValue <= 8);
        if (globalAccelerationIsValid) {
            state.lastControllerP2.acceleration_level = globalAccelerationValue;
        }
        socket.send(`WRITE_LONG_P2:${JSON.stringify(state.lastControllerP2)}`);
        addLog('SAVE_REQ', 'Controller Parameter 2 (Torque Profiles)');
        changesMade = true;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (angleIsValid && angleValue !== state.lastStartupAngle) {
        socket.send(`WRITE_STARTUP_ANGLE:${angleValue}`);
        addLog('SAVE_REQ', `Startup Angle: ${angleValue}`);
        changesMade = true;
    }

    if (!changesMade) {
        addLog('INFO', 'No P1 or P2 data available to save.');
    }
};
