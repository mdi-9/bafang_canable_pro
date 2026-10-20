// tab-gears.js — ES Module
/* global Plotly */
import {
    state, socket,
    gearsElements, checksumElements,
    safeSetText, safeSetInput,
    addLog, waitFor,
    START_PULSE_MIN, START_PULSE_MAX,
    uiToInternalAssistMap,
    MAX_HUMAN_POWER_X_AXIS, MAX_TIME_X_AXIS_START_RAMP, EFFICIENCY_FACTOR,
    pasCurvesContainer, pasCurvesPlaceholder,
    startRampContainer, startRampPlaceholder,
} from './shared.js';

// How long a sync waits for the P0 answer before taking the controller for one
// without it. A late answer still switches the tab over (see controller_params_0).
const P0_DETECT_MS = 3000;

// Newer controllers (M510, M560, ...) answer a P0 read and keep an assist ratio and an
// acceleration per assist level there. Older ones such as the M820 do not answer it and
// have one global acceleration in P2 instead. Returns 'perLevel', 'global', or null
// while it is not known yet.
export function assistMode() {
    if (state.lastControllerP0) return 'perLevel';
    if (state.controllerHasP0 === false) return 'global';
    return null;
}

const MODE_INFO = {
    perLevel: 'Controller with assist ratio and acceleration per assist level (answers P0).',
    global: 'Controller without per-level acceleration (no answer to P0, e.g. M820): one global acceleration.',
};

function showPlaceholder(el, show) {
    if (el) el.style.display = show ? 'block' : 'none';
}

export function updateGearsUI() {
    const mode = assistMode();
    const perLevel = mode === 'perLevel';

    // --- Controller type ---
    if (gearsElements.modeInfo)
        gearsElements.modeInfo.textContent = MODE_INFO[mode] || 'Controller type not detected yet. Press Sync Data.';
    if (gearsElements.assistLevelsSubtitle)
        gearsElements.assistLevelsSubtitle.textContent = `Assist Levels (Parameter Block ${perLevel ? '0 and 1' : '1'})`;
    document.querySelectorAll('#tab-gears .assist-per-level-only').forEach((th) => { th.style.display = perLevel ? '' : 'none'; });
    if (gearsElements.globalAccelerationRow)
        gearsElements.globalAccelerationRow.style.display = mode === 'global' ? '' : 'none';

    // --- Startup Angle ---
    safeSetText(gearsElements.controllerStartupAngleValueEl, state.lastStartupAngle);
    safeSetInput(gearsElements.controllerStartupAngleInputEl, { lastStartupAngle: state.lastStartupAngle }, 'lastStartupAngle');
    showPlaceholder(gearsElements.startupAnglePlaceholderEl, state.lastStartupAngle === null || state.lastStartupAngle === undefined);

    // --- Global Acceleration (P2) ---
    if (mode === 'global') {
        safeSetText(gearsElements.globalAccelerationValueEl, state.lastControllerP2?.acceleration_level);
        safeSetInput(gearsElements.globalAccelerationInputEl, state.lastControllerP2, 'acceleration_level');
    }

    renderAssistLevels(mode);
    renderTorqueProfiles();
    updatePasCurvesChartUnified();
    updateStartRampChartUnified();
}

function renderAssistLevels(mode) {
    const assistBody = gearsElements.assistLevelTableBody;
    if (!assistBody) {
        console.error("Gears UI Update failed: assistLevelTableBody element not found!");
        showPlaceholder(gearsElements.assistLevelPlaceholder, true);
        return;
    }
    assistBody.innerHTML = '';

    const totalDisplayLevels = state.displayRealtime?.assist_levels;
    const currentLevelMapping = (totalDisplayLevels && uiToInternalAssistMap[totalDisplayLevels]) || null;
    if (!currentLevelMapping) {
        console.warn(`Gears UI Update: No valid mapping for totalDisplayLevels: ${totalDisplayLevels}. Or displayRealtime not available. currentLevelMapping is null.`);
        showPlaceholder(gearsElements.assistLevelPlaceholder, true);
        return;
    }

    const p0 = state.lastControllerP0;
    const p1 = state.lastControllerP1;
    const perLevel = mode === 'perLevel';
    const p0Valid = p0 && p0.acceleration_levels && p0.assist_ratio_levels && typeof p0.assist_ratio_upper_limit === 'number';

    if (!mode || !p1 || !p1.assist_levels || (perLevel && !p0Valid)) {
        console.warn("Gears UI Update: Missing P1 (or P0) data, or the controller type is not known yet.");
        showPlaceholder(gearsElements.assistLevelPlaceholder, true);
        return;
    }
    showPlaceholder(gearsElements.assistLevelPlaceholder, false);

    const addInputCell = (row, { type, index, param, value, min, max, placeholder, unit = '' }) => {
        const cell = row.insertCell();
        const input = document.createElement('input');
        input.type = 'number';
        input.min = min; input.max = max; input.step = 1;
        input.value = (typeof value === 'number') ? value : '';
        input.placeholder = placeholder;
        input.dataset.internalType = type;
        input.dataset.internalIndex = index.toString();
        input.dataset.param = param;
        input.addEventListener('change', handleAssistInputChange);
        cell.appendChild(input);
        if (unit) cell.append(` ${unit}`);
    };

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

        const level = p1.assist_levels[internalIndex];
        addInputCell(row, { type: 'p1', index: internalIndex, param: 'current_limit', value: level?.current_limit, min: 0, max: 100, placeholder: '0-100', unit: '%' });
        addInputCell(row, { type: 'p1', index: internalIndex, param: 'speed_limit', value: level?.speed_limit, min: 0, max: 100, placeholder: '0-100', unit: '%' });

        if (perLevel) {
            const ratioMax = p0.assist_ratio_upper_limit;
            addInputCell(row, { type: 'p0', index: internalIndex, param: 'assist_ratio_level', value: p0.assist_ratio_levels[internalIndex]?.assist_ratio_level, min: 1, max: ratioMax, placeholder: `1-${ratioMax}` });
            addInputCell(row, { type: 'p0', index: internalIndex, param: 'acceleration_level', value: p0.acceleration_levels[internalIndex]?.acceleration_level, min: 1, max: 8, placeholder: '1-8' });
        }
    }
}

function renderTorqueProfiles() {
    const torqueBody = gearsElements.torqueProfileTableBody;
    if (!torqueBody) {
        console.error("Gears UI Update failed: torqueProfileTableBody element not found!");
        showPlaceholder(gearsElements.torqueProfilePlaceholder, true);
        return;
    }
    torqueBody.innerHTML = '';

    const p2 = state.lastControllerP2;

    if (!p2 || !Array.isArray(p2.torque_profiles) || p2.torque_profiles.length < 6) {
        console.warn("Gears UI Update: P2 data or torque_profiles missing/invalid for torque table.");
        showPlaceholder(gearsElements.torqueProfilePlaceholder, true);
        return;
    }

    if (p2.checksum_missmatch)
        checksumElements.gearsP2ChecksumWarning.style.display = 'block';
    else
        checksumElements.gearsP2ChecksumWarning.style.display = 'none';

    showPlaceholder(gearsElements.torqueProfilePlaceholder, false);

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

        const startPulseValue = (profileData && typeof profileData.start_pulse === 'number') ? profileData.start_pulse : '';
        let startPulseReadOnly = false;
        let startPulseTitle = '';
        let startPulseNote = '';
        if (i === 0) {
            // Shows what Save will write: the value recalculated from Startup Angle and
            // Cadence Signals once both are known, otherwise the one read. It used to show a
            // fresh calculation instead, which hid a controller holding a different value.
            startPulseReadOnly = true;
            startPulseTitle = "Calculated from Startup Angle & Cadence Signals (P1); Save writes this value";
            const read = state.lastControllerP2Read?.torque_profiles?.[0]?.start_pulse;
            if (typeof read === 'number' && read !== startPulseValue) {
                startPulseNote = `(controller: ${read})`;
                startPulseTitle += `. The controller currently has ${read}.`;
            }
        }
        createInputCell('start_pulse', startPulseValue, START_PULSE_MIN, START_PULSE_MAX, 1, startPulseNote, startPulseReadOnly, startPulseTitle);

        createInputCell('current_decay_time', profileData?.current_decay_time, 5, 1275, 5, '');
        createInputCell('torque_decay_time', profileData?.torque_decay_time, 5, 1275, 5, '');
        createInputCell('stop_delay', profileData?.stop_delay, 2, 510, 2, '');
    }
}

// One colour per assist level. There used to be five, and levels 6-9 of a 9-level display
// all fell back to grey, whose stacked fills washed the whole chart grey (DPC18RI).
const PAS_LEVEL_COLORS = ['#9CA3AF', '#60A5FA', '#34D399', '#FBBF24', '#F87171', '#A78BFA', '#F472B6', '#22D3EE', '#FB923C'];
const levelColor = (level) => PAS_LEVEL_COLORS[(level - 1) % PAS_LEVEL_COLORS.length];

export function updatePasCurvesChartUnified() {
    const isM820 = assistMode() === 'global';
    const container = pasCurvesContainer;
    const placeholder = pasCurvesPlaceholder;

    const chartDiv = document.getElementById('pasCurvesChart');
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
                color: levelColor(displayedLevel),
                width: 3,
                shape: 'spline',
                smoothing: 0.6,
            },
            fill: 'tozeroy',
            fillcolor: levelColor(displayedLevel) + '22',
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

export function updateStartRampChartUnified() {
    const isM820 = assistMode() === 'global';
    const container = startRampContainer;
    const placeholder = startRampPlaceholder;

    const chartDiv = document.getElementById('startRampChart');
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
                color: levelColor(displayedLevel),
                width: 3,
                shape: 'spline',
                smoothing: 0.6,
            },
            fill: 'tozeroy',
            fillcolor: levelColor(displayedLevel) + '22',
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
    // P0 also tells which kind of controller this is: one without per-level
    // acceleration (e.g. M820) does not answer it.
    state.lastControllerP0 = null;
    socket.send('READ:2:96:16'); // Request Controller P0
    state.controllerHasP0 = await waitFor(() => state.lastControllerP0 !== null, P0_DETECT_MS);
    if (!state.controllerHasP0)
        addLog('INFO', 'No answer to P0: controller with one global acceleration (e.g. M820).');
    updateGearsUI();
    state.lastControllerP1 = null;
    socket.send('READ:2:96:17'); // Request Controller P1
    await waitFor(() => state.lastControllerP1 !== null);
    state.lastControllerP2 = null;
    socket.send('READ:2:96:18'); // Request Controller P2
    await waitFor(() => state.lastControllerP2 !== null);
    socket.send('READ_STARTUP_ANGLE');
};

gearsElements.saveButton.onclick = async () => {
    const mode = assistMode();
    if (!mode) {
        addLog('ERROR', 'Cannot save Assist Settings - press Sync Data first so the controller type is known.');
        alert('Press Sync Data first: the controller type is not known yet.');
        return;
    }
    const perLevel = mode === 'perLevel';

    const angleStr = gearsElements.controllerStartupAngleInputEl?.value;
    const angleValue = (angleStr !== undefined && angleStr !== "") ? parseInt(angleStr, 10) : null;
    let angleIsValid = (angleValue !== null && !isNaN(angleValue) && angleValue >= 0 && angleValue <= 360);
    if (angleStr !== "" && !angleIsValid) {
        addLog('ERROR', `Invalid Startup Angle value entered: ${angleStr}. Must be 0-360.`);
        alert(`Invalid Startup Angle value entered: ${angleStr}. Must be between 0 and 360.`);
        return;
    }

    let globalAccelerationValue = null;
    if (!perLevel) {
        const globalAccelerationStr = gearsElements.globalAccelerationInputEl?.value;
        if (globalAccelerationStr !== undefined && globalAccelerationStr !== "") {
            globalAccelerationValue = parseInt(globalAccelerationStr, 10);
            if (isNaN(globalAccelerationValue) || globalAccelerationValue < 1 || globalAccelerationValue > 8) {
                addLog('ERROR', `Invalid Global Acceleration value entered: ${globalAccelerationStr}. Must be 1-8.`);
                alert(`Invalid Global Acceleration value entered: ${globalAccelerationStr}. Must be between 1 and 8.`);
                return;
            }
        }
    }

    if (!state.lastControllerP1 || !state.lastControllerP2 || (perLevel && !state.lastControllerP0)) {
        let missing = [];
        if (perLevel && !state.lastControllerP0) missing.push("P0 (Acceleration)");
        if (!state.lastControllerP1) missing.push("P1 (Assist Limits)");
        if (!state.lastControllerP2) missing.push("P2 (Torque)");
        addLog('ERROR', `Cannot save Assist Settings - read required Controller data first: ${missing.join(', ')}`);
        return;
    }

    if (!confirm("Are you sure you want to write Assist Level AND Torque Profile changes to the Controller?")) return;
    addLog('SAVE_REQ', 'Saving Gears & Assist Changes...');

    if (perLevel) {
        socket.send(`WRITE_LONG_P0:${JSON.stringify(state.lastControllerP0)}`);
        addLog('SAVE_REQ', 'Controller Parameter 0 (Acceleration Levels)');
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    socket.send(`WRITE_LONG_P1:${JSON.stringify(state.lastControllerP1)}`);
    addLog('SAVE_REQ', 'Controller Parameter 1 (Assist Levels)');
    await new Promise(resolve => setTimeout(resolve, 500));

    if (globalAccelerationValue !== null)
        state.lastControllerP2.acceleration_level = globalAccelerationValue;
    socket.send(`WRITE_LONG_P2:${JSON.stringify(state.lastControllerP2)}`);
    addLog('SAVE_REQ', 'Controller Parameter 2 (Torque Profiles)');
    await new Promise(resolve => setTimeout(resolve, 500));

    if (angleIsValid && angleValue !== state.lastStartupAngle) {
        socket.send(`WRITE_STARTUP_ANGLE:${angleValue}`);
        addLog('SAVE_REQ', `Startup Angle: ${angleValue}`);
    }
};
