// tab-gears.js — ES Module
/* global Plotly */
import {
    state, socket,
    gearsElements, checksumElements,
    safeSetText, safeSetInput,
    addLog, waitFor,
    calculateStartPulse,
    START_PULSE_MIN, START_PULSE_MAX,
    uiToInternalAssistMap,
    MAX_HUMAN_POWER_X_AXIS, MAX_TIME_X_AXIS_START_RAMP, EFFICIENCY_FACTOR,
    pasCurvesContainer, pasCurvesPlaceholder,
    startRampContainer, startRampPlaceholder,
    pasCurvesContainerM820, pasCurvesPlaceholderM820,
    startRampContainerM820, startRampPlaceholderM820,
} from './shared.js';

export function updateGearsUI() {
    // --- Startup Angle ---
    safeSetText(gearsElements.controllerStartupAngleValueEl, state.lastStartupAngle);
    safeSetInput(gearsElements.controllerStartupAngleInputEl, { lastStartupAngle: state.lastStartupAngle }, 'lastStartupAngle');
    if (gearsElements.startupAnglePlaceholderEl) {
        gearsElements.startupAnglePlaceholderEl.style.display = (state.lastStartupAngle !== null && state.lastStartupAngle !== undefined) ? 'none' : 'block';
    }

    // --- Assist Levels Table ---
    const assistBody = gearsElements.assistLevelTableBody;
    if (!assistBody) {
        console.error("Gears UI Update failed: assistLevelTableBody element not found!");
        if (gearsElements.assistLevelPlaceholder) gearsElements.assistLevelPlaceholder.style.display = 'block';
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
        if (gearsElements.assistLevelPlaceholder) gearsElements.assistLevelPlaceholder.style.display = 'block';
        if (gearsElements.torqueProfilePlaceholder) gearsElements.torqueProfilePlaceholder.style.display = 'block';
        return;
    }

    const p0 = state.lastControllerP0;
    const p1 = state.lastControllerP1;

    if (!p0 || !p1 || !p0.acceleration_levels || !p1.assist_levels || !p0.assist_ratio_levels || typeof p0.assist_ratio_upper_limit !== 'number') {
        console.warn("Gears UI Update: Missing P0 or P1 data, or their internal assist_levels/acceleration_levels arrays.");
        if (gearsElements.assistLevelPlaceholder) gearsElements.assistLevelPlaceholder.style.display = 'block';
        if (gearsElements.torqueProfilePlaceholder) gearsElements.torqueProfilePlaceholder.style.display = 'block';
        return;
    }

    if (gearsElements.assistLevelPlaceholder) gearsElements.assistLevelPlaceholder.style.display = 'none';

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

        const assistRatioMaxValue = p0.assist_ratio_upper_limit;
        const cellinputassistRatio = row.insertCell();
        const inputRatio = document.createElement('input');
        inputRatio.type = 'number';
        inputRatio.min = 1;
        inputRatio.max = assistRatioMaxValue;
        inputRatio.step = 1;
        inputRatio.value = (p0.assist_ratio_levels[internalIndex] && typeof p0.assist_ratio_levels[internalIndex].assist_ratio_level === 'number')
                               ? p0.assist_ratio_levels[internalIndex].assist_ratio_level : '';
        inputRatio.placeholder = `1-${assistRatioMaxValue}`;
        inputRatio.dataset.internalType = 'p0';
        inputRatio.dataset.internalIndex = internalIndex.toString();
        inputRatio.dataset.param = 'assist_ratio_level';
        inputRatio.addEventListener('change', handleAssistInputChange);
        cellinputassistRatio.appendChild(inputRatio);
        cellinputassistRatio.append('');

        const cellAccel = row.insertCell();
        const inputAccel = document.createElement('input');
        inputAccel.type = 'number';
        inputAccel.min = 1; inputAccel.max = 8; inputAccel.step = 1;
        inputAccel.value = (p0.acceleration_levels[internalIndex] && typeof p0.acceleration_levels[internalIndex].acceleration_level === 'number')
                               ? p0.acceleration_levels[internalIndex].acceleration_level : '';
        inputAccel.placeholder = '1-8';
        inputAccel.dataset.internalType = 'p0';
        inputAccel.dataset.internalIndex = internalIndex.toString();
        inputAccel.dataset.param = 'acceleration_level';
        inputAccel.addEventListener('change', handleAssistInputChange);
        cellAccel.appendChild(inputAccel);
        cellAccel.append('');
    }

    // --- Torque Profiles Table (from P2) ---
    const torqueBody = gearsElements.torqueProfileTableBody;
    if (!torqueBody) {
        console.error("Gears UI Update failed: torqueProfileTableBody element not found!");
        if (gearsElements.torqueProfilePlaceholder) gearsElements.torqueProfilePlaceholder.style.display = 'block';
        return;
    }
    torqueBody.innerHTML = '';

    const p2 = state.lastControllerP2;
    const angle = state.lastStartupAngle;
    const signals = state.lastControllerP1?.pedal_sensor_signals_per_rotation;

    if (!p2 || !Array.isArray(p2.torque_profiles) || p2.torque_profiles.length < 6) {
        console.warn("Gears UI Update: P2 data or torque_profiles missing/invalid for torque table.");
        if (gearsElements.torqueProfilePlaceholder) gearsElements.torqueProfilePlaceholder.style.display = 'block';
        return;
    }

    if (p2.checksum_missmatch)
        checksumElements.gearsP2ChecksumWarning.style.display = 'block';
    else
        checksumElements.gearsP2ChecksumWarning.style.display = 'none';

    if (gearsElements.torqueProfilePlaceholder) gearsElements.torqueProfilePlaceholder.style.display = 'none';

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
    updatePasCurvesChartUnified(false);
    updateStartRampChartUnified(false);
}

export function updatePasCurvesChartUnified(isM820) {
    const chartId = isM820 ? 'pasCurvesChartM820' : 'pasCurvesChart';
    const container = isM820 ? pasCurvesContainerM820 : pasCurvesContainer;
    const placeholder = isM820 ? pasCurvesPlaceholderM820 : pasCurvesPlaceholder;

    const chartDiv = document.getElementById(chartId);
    if (!chartDiv) return;

    const baseDataValid =
        state.lastControllerP1?.assist_levels &&
        typeof state.lastControllerP1.system_voltage === 'number' &&
        typeof state.lastControllerP1.current_limit === 'number' &&
        state.displayRealtime?.assist_levels;

    const extraDataValid = isM820 ? true : state.lastControllerP0?.assist_ratio_levels;

    if (!baseDataValid || !extraDataValid) {
        if (container) container.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
        return;
    }

    if (container) container.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';

    const totalDisplayLevels = state.displayRealtime.assist_levels;
    const assistCurrentLimitsP1 = state.lastControllerP1.assist_levels;
    const assistRatiosP0 = isM820 ? null : state.lastControllerP0.assist_ratio_levels;
    const systemVoltageP1 = state.lastControllerP1.system_voltage;
    const controllerCurrentLimitP1 = state.lastControllerP1.current_limit;

    const currentEfficiency = isM820 ? 1.0 : (typeof EFFICIENCY_FACTOR !== 'undefined' ? EFFICIENCY_FACTOR : 1.0);

    const traces = [];
    let overallMaxMotorPower = 0;

    const internalLevelMapping = uiToInternalAssistMap[totalDisplayLevels] || uiToInternalAssistMap[5];

    const PAS_LEVEL_COLORS = ["#9CA3AF", "#60A5FA", "#34D399", "#FBBF24", "#F87171"];

    for (let displayedLevel = 1; displayedLevel <= totalDisplayLevels; displayedLevel++) {
        const internalIndex = internalLevelMapping[displayedLevel];
        if (internalIndex === undefined || internalIndex >= assistCurrentLimitsP1.length) continue;

        if (!isM820 && internalIndex >= assistRatiosP0.length) continue;

        const currentLimitPercent = assistCurrentLimitsP1[internalIndex]?.current_limit;
        if (typeof currentLimitPercent !== 'number') continue;

        const maxPowerForLevel =
            currentEfficiency *
            systemVoltageP1 *
            controllerCurrentLimitP1 *
            (currentLimitPercent / 100);

        overallMaxMotorPower = Math.max(overallMaxMotorPower, maxPowerForLevel);

        let assistRatio;
        if (isM820) {
            assistRatio = 0.6 + (displayedLevel / totalDisplayLevels) * 1.4;
        } else {
            const ratioPercent = assistRatiosP0[internalIndex]?.assist_ratio_level;
            if (typeof ratioPercent !== 'number') continue;
            assistRatio = ratioPercent / 100;
        }

        const xValues = [];
        const yValues = [];

        const step = MAX_HUMAN_POWER_X_AXIS > 500 ? 20 : 10;

        for (let humanPower = 0; humanPower <= MAX_HUMAN_POWER_X_AXIS; humanPower += step) {
            let motorOutput = humanPower * assistRatio;
            motorOutput = Math.min(maxPowerForLevel, motorOutput);
            xValues.push(humanPower);
            yValues.push(motorOutput);
        }

        traces.push({
            x: xValues,
            y: yValues,
            name: `Level ${displayedLevel}`,
            mode: 'lines',
            type: 'scatter',
            line: {
                color: PAS_LEVEL_COLORS[displayedLevel - 1] || '#999',
                width: 3,
                shape: 'spline',
                smoothing: 0.6,
            },
            fill: 'tozeroy',
            fillcolor: (PAS_LEVEL_COLORS[displayedLevel - 1] || '#999') + '22',
            hovertemplate:
                'Human: %{x} W<br>' +
                'Motor: %{y:.0f} W' +
                '<extra>%{fullData.name}</extra>',
        });
    }

    const yAxisMax = overallMaxMotorPower > 0 ? overallMaxMotorPower * 1.1 : 600;

    const layout = {
        template: "plotly_dark",
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(20, 25, 35, 0.8)',
        height: 520,
        autosize: true,
        margin: { t: 40, b: 70, l: 70, r: 30 },
        font: { family: "Inter, system-ui, sans-serif", size: 13, color: "#3f3f3fff" },
        title: { text: isM820 ? "Assist Curves (M820)" : "Assist Curves", x: 0.05 },
        showlegend: true,
        legend: { orientation: 'h', y: -0.3, x: 0.5, xanchor: 'center' },
        xaxis: { title: 'Human power (W)', range: [0, MAX_HUMAN_POWER_X_AXIS], gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.2)', fixedrange: true },
        yaxis: { title: 'Motor output (W)', range: [0, yAxisMax], gridcolor: 'rgba(255,255,255,0.08)', zerolinecolor: 'rgba(255,255,255,0.2)', fixedrange: true },
        hovermode: 'x unified',
    };

    Plotly.react(chartDiv, traces, layout, { responsive: true, displayModeBar: false });
}

export function updateStartRampChartUnified(isM820) {
    const chartId = isM820 ? 'startRampChartM820' : 'startRampChart';
    const container = isM820 ? startRampContainerM820 : startRampContainer;
    const placeholder = isM820 ? startRampPlaceholderM820 : startRampPlaceholder;

    const chartDiv = document.getElementById(chartId);
    if (!chartDiv) return;

    const baseDataValid =
        state.lastControllerP1?.assist_levels &&
        typeof state.lastControllerP1.system_voltage === 'number' &&
        typeof state.lastControllerP1.current_limit === 'number' &&
        state.displayRealtime?.assist_levels;

    const extraDataValid = isM820
        ? typeof state.lastControllerP2?.acceleration_level === 'number'
        : state.lastControllerP0?.acceleration_levels;

    if (!baseDataValid || !extraDataValid) {
        if (container) container.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
        return;
    }

    if (container) container.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';

    const totalDisplayLevels = state.displayRealtime.assist_levels;
    const assistCurrentLimitsP1 = state.lastControllerP1.assist_levels;
    const systemVoltageP1 = state.lastControllerP1.system_voltage;
    const controllerCurrentLimitP1 = state.lastControllerP1.current_limit;

    const currentEfficiency = isM820 ? 1.0 : (EFFICIENCY_FACTOR || 1.0);

    const traces = [];
    let overallMaxMotorPower = 0;

    const internalLevelMapping = uiToInternalAssistMap[totalDisplayLevels] || uiToInternalAssistMap[5];

    const PAS_LEVEL_COLORS = ["#9CA3AF", "#60A5FA", "#34D399", "#FBBF24", "#F87171"];

    for (let displayedLevel = 1; displayedLevel <= totalDisplayLevels; displayedLevel++) {
        const internalIndex = internalLevelMapping[displayedLevel];
        if (internalIndex === undefined || internalIndex >= assistCurrentLimitsP1.length) continue;

        let accelValue;

        if (isM820) {
            const baseAccel = state.lastControllerP2?.acceleration_level;
            if (typeof baseAccel !== 'number') continue;
            accelValue = baseAccel * (0.6 + displayedLevel / totalDisplayLevels * 0.4);
        } else {
            const accelObj = state.lastControllerP0.acceleration_levels[internalIndex];
            if (!accelObj || typeof accelObj.acceleration_level !== 'number') continue;
            accelValue = accelObj.acceleration_level;
        }

        const currentLimitPercent = assistCurrentLimitsP1[internalIndex]?.current_limit;
        if (typeof currentLimitPercent !== 'number') continue;

        const maxPowerForLevel =
            currentEfficiency *
            systemVoltageP1 *
            controllerCurrentLimitP1 *
            (currentLimitPercent / 100);

        overallMaxMotorPower = Math.max(overallMaxMotorPower, maxPowerForLevel);

        const MIN_TIME = 50;
        const MAX_TIME = 2500;
        const ACCEL_STEPS = 8;

        const timeToReachFullPower =
            MIN_TIME + (MAX_TIME - MIN_TIME) * (1 - accelValue / ACCEL_STEPS);

        const xValues = [];
        const yValues = [];

        for (let timeMs = 0; timeMs <= MAX_TIME_X_AXIS_START_RAMP; timeMs += 100) {
            let motorOutput = (timeMs * maxPowerForLevel) / timeToReachFullPower;
            motorOutput = Math.min(maxPowerForLevel, motorOutput);
            xValues.push(timeMs);
            yValues.push(motorOutput);
        }

        traces.push({
            x: xValues,
            y: yValues,
            name: `Level ${displayedLevel}`,
            mode: 'lines',
            type: 'scatter',
            line: {
                color: PAS_LEVEL_COLORS[displayedLevel - 1] || '#999',
                width: 3,
                shape: 'spline',
                smoothing: 0.6,
            },
            fill: 'tozeroy',
            fillcolor: (PAS_LEVEL_COLORS[displayedLevel - 1] || '#999') + '22',
            hovertemplate:
                'Time: %{x} ms<br>' +
                'Motor: %{y:.0f} W' +
                '<extra>%{fullData.name}</extra>',
        });
    }

    const yAxisMax = overallMaxMotorPower > 0 ? overallMaxMotorPower * 1.1 : 600;

    const layout = {
        template: "plotly_dark",
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(20, 25, 35, 0.9)',
        height: 520,
        autosize: true,
        margin: { t: 40, b: 70, l: 70, r: 30 },
        font: { family: "Inter, system-ui, sans-serif", size: 13, color: "#3f3f3fff" },
        title: { text: "Start Ramp", x: 0.05 },
        legend: { orientation: 'h', y: -0.3, x: 0.5, xanchor: 'center' },
        xaxis: { title: 'Time (ms)', range: [0, MAX_TIME_X_AXIS_START_RAMP], gridcolor: 'rgba(255,255,255,0.08)', fixedrange: true },
        yaxis: { title: 'Motor output (W)', range: [0, yAxisMax], gridcolor: 'rgba(255,255,255,0.08)', fixedrange: true },
        hovermode: 'x unified',
    };

    Plotly.react(chartDiv, traces, layout, { responsive: true, displayModeBar: false });
}

export function handleAssistInputChange(event) {
    const input = event.target;
    if (!input) {
        console.error("handleAssistInputChange triggered with null input element!");
        return;
    }
    const internalType = input.dataset.internalType;
    const internalIndex = parseInt(input.dataset.internalIndex, 10);
    const param = input.dataset.param;
    let value = parseInt(input.value, 10);

    if (isNaN(internalIndex) || !param || isNaN(value)) {
        console.warn("Could not update assist level - invalid input data", input?.dataset, input.value);
        return;
    }

    let targetObject = null;
    let targetArrayName = '';
    let targetParamName = param;

    if (internalType === 'p0') {
        if (!state.lastControllerP0) {
            console.warn(`Could not update P0 - lastControllerP0 data not available.`);
            return;
        }
        targetObject = state.lastControllerP0;
        if (param === 'acceleration_level') {
            targetArrayName = 'acceleration_levels';
        } else if (param === 'assist_ratio_level') {
            targetArrayName = 'assist_ratio_levels';
        } else {
            console.warn(`Unknown parameter '${param}' for P0 internal type.`);
            return;
        }
    } else if (internalType === 'p1') {
        if (!state.lastControllerP1) {
            console.warn(`Could not update P1 - lastControllerP1 data not available.`);
            return;
        }
        targetObject = state.lastControllerP1;
        if (param === 'current_limit' || param === 'speed_limit') {
            targetArrayName = 'assist_levels';
        } else {
            console.warn(`Unknown parameter '${param}' for P1 internal type.`);
            return;
        }
    } else {
        console.warn(`Could not update assist level - unknown internalType: ${internalType}.`);
        return;
    }

    if (targetObject && targetObject[targetArrayName] && targetObject[targetArrayName][internalIndex]) {
        if (typeof targetObject[targetArrayName][internalIndex] !== 'object') {
            targetObject[targetArrayName][internalIndex] = {};
        }
        targetObject[targetArrayName][internalIndex][targetParamName] = value;
        console.log(`Updated ${internalType.toUpperCase()} Internal Assist Index ${internalIndex}, Param ${targetParamName} to ${value}`);
        if (gearsElements.autoCorrectionCheckbox && gearsElements.autoCorrectionCheckbox.checked) {
            for (let i = (internalIndex + 1); i < 9; i++) {
                if (targetObject[targetArrayName][i] && targetObject[targetArrayName][i][targetParamName] < value) {
                    targetObject[targetArrayName][i][targetParamName] = value;
                    const nInput = document.querySelector(`input[data-internal-type="${internalType}"][data-internal-index="${i}"][data-param="${targetParamName}"]`);
                    if (nInput) nInput.value = value;
                    console.log(`Updated ${internalType.toUpperCase()} Internal Assist Index ${i}, Param ${targetParamName} to ${value} because previoues level was bigger`);
                }
            }
            for (let i = (internalIndex - 1); i >= 0; i--) {
                if (targetObject[targetArrayName][i] && targetObject[targetArrayName][i][targetParamName] > value) {
                    targetObject[targetArrayName][i][targetParamName] = value;
                    const nInput = document.querySelector(`input[data-internal-type="${internalType}"][data-internal-index="${i}"][data-param="${targetParamName}"]`);
                    if (nInput) nInput.value = value;
                    console.log(`Updated ${internalType.toUpperCase()} Internal Assist Index ${i}, Param ${targetParamName} to ${value} because next level was bigger`);
                }
            }
        }
    } else {
        console.warn(`Could not update assist level - data structure missing for ${internalType.toUpperCase()} internalIndex ${internalIndex} or array ${targetArrayName}.`, targetObject);
    }
}

export function handleTorqueInputChange(event) {
    const input = event.target;
    if (!input) {
        console.error("handleTorqueInputChange triggered with null input element!");
        return;
    }
    const profileIndex = parseInt(input.dataset.profileIndex, 10);
    const param = input.dataset.param;
    const value = parseInt(input.value, 10);

    if (param === 'start_pulse' && profileIndex === 0) {
        console.log("Ignoring change attempt on calculated Start Pulse[0]");
        return;
    }

    if (state.lastControllerP2 && state.lastControllerP2.torque_profiles && !isNaN(profileIndex) && param && !isNaN(value)) {
        if (!state.lastControllerP2.torque_profiles[profileIndex]) {
            state.lastControllerP2.torque_profiles[profileIndex] = {};
            console.warn(`Created missing torque_profiles entry for index ${profileIndex}`);
        }
        state.lastControllerP2.torque_profiles[profileIndex][param] = value;
        console.log(`Updated P2 Torque Profile ${profileIndex} ${param} to ${value}`);
    } else {
        console.warn("Could not update torque profile - data missing or invalid input", input?.dataset, input?.value);
    }
}

gearsElements.syncButton.onclick = async () => {
    addLog('REQ', 'Syncing Gears data ...');
    state.lastControllerP0 = null;
    socket.send('READ:2:96:16'); // Request Controller P0
    await waitFor(() => state.lastControllerP0 !== null);
    state.lastControllerP1 = null;
    socket.send('READ:2:96:17'); // Request Controller P1
    await waitFor(() => state.lastControllerP1 !== null);
    state.lastControllerP2 = null;
    socket.send('READ:2:96:18'); // Request Controller P2
    await waitFor(() => state.lastControllerP2 !== null);
    socket.send('READ_STARTUP_ANGLE');
};

gearsElements.saveButton.onclick = async () => {
    const angleStr = gearsElements.controllerStartupAngleInputEl?.value;
    const angleValue = (angleStr !== undefined && angleStr !== "") ? parseInt(angleStr, 10) : null;
    let angleIsValid = (angleValue !== null && !isNaN(angleValue) && angleValue >= 0 && angleValue <= 360);
    if (angleStr !== "" && !angleIsValid) {
        addLog('ERROR', `Invalid Startup Angle value entered: ${angleStr}. Must be 0-360.`);
        alert(`Invalid Startup Angle value entered: ${angleStr}. Must be between 0 and 360.`);
        return;
    }

    if (!state.lastControllerP1 || !state.lastControllerP2 || !state.lastControllerP0) {
        let missing = [];
        if (!state.lastControllerP0) missing.push("P0 (Acceleration)");
        if (!state.lastControllerP1) missing.push("P1 (Assist Limits)");
        if (!state.lastControllerP2) missing.push("P2 (Torque)");
        addLog('ERROR', `Cannot save Assist Settings - read required Controller data first: ${missing.join(', ')}`);
        return;
    }

    if (!confirm("Are you sure you want to write Assist Level AND Torque Profile changes to the Controller?")) return;
    addLog('SAVE_REQ', 'Saving Gears & Assist Changes...');
    let changesMade = false;

    if (state.lastControllerP0) {
        socket.send(`WRITE_LONG_P0:${JSON.stringify(state.lastControllerP0)}`);
        addLog('SAVE_REQ', 'Controller Parameter 0 (Acceleration Levels)');
        changesMade = true;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (state.lastControllerP1) {
        socket.send(`WRITE_LONG_P1:${JSON.stringify(state.lastControllerP1)}`);
        addLog('SAVE_REQ', 'Controller Parameter 1 (Assist Levels)');
        changesMade = true;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (state.lastControllerP2) {
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
        addLog('INFO', 'No P0, P1 or P2 data available to save.');
    }
};
