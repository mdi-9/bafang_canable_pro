// tab-controller.js — ES Module
import {
    state, socket, checksumElements, controllerElements,
    safeSetText, safeSetInput, safeSetFormattedInput,
    safeSetSelectBoolean, safeSetSelectDirect,
    getNullableNumber, getNullableBoolean,
    addLog, waitFor, delay,
    sendCustomFrame, encodeToHex,
} from './shared.js';

export function updateControllerStateUI() {
    safeSetText(controllerElements.stateNumberValue, state.controllerState?.state_number);
}

export function updateControllerUI() {
    // Realtime 0
    safeSetText(controllerElements.rt0RemainCapValue, state.controllerRealtime0?.remaining_capacity);
    safeSetText(controllerElements.rt0RemainDistValue, state.controllerRealtime0?.remaining_distance, (val) => getNullableNumber(val, 2));
    safeSetText(controllerElements.rt0SingleTripValue, state.controllerRealtime0?.single_trip, (val) => getNullableNumber(val, 2));
    safeSetText(controllerElements.rt0CadenceValue, state.controllerRealtime0?.cadence);
    safeSetText(controllerElements.rt0TorqueValue, state.controllerRealtime0?.torque);
    // Realtime 1
    safeSetText(controllerElements.rt1VoltageValue, state.controllerRealtime1?.voltage, (val) => getNullableNumber(val, 2));
    safeSetText(controllerElements.rt1TempValue, state.controllerRealtime1?.temperature);
    safeSetText(controllerElements.rt1MotorTempValue, state.controllerRealtime1?.motor_temperature);
    safeSetText(controllerElements.rt1CurrentValue, state.controllerRealtime1?.current, (val) => getNullableNumber(val, 2));
    safeSetText(controllerElements.rt1SpeedValue, state.controllerRealtime1?.speed, (val) => getNullableNumber(val, 2));
    if (controllerElements.rtPlaceholder) controllerElements.rtPlaceholder.style.display = (state.controllerRealtime0 || state.controllerRealtime1) ? 'none' : 'block';

    // Electric P1
    if (state.controllerParams1) {
        if (state.controllerParams1.checksum_missmatch)
            checksumElements.ctrlP1ChecksumWarning.style.display = 'block';
        else
            checksumElements.ctrlP1ChecksumWarning.style.display = 'none';
        const rawVoltage = state.controllerParams1.system_voltage;
        safeSetText(controllerElements.p1SysVoltageRawValue, rawVoltage, (val) => `(Raw: ${getNullableNumber(val, 0)}V)`);

        if (controllerElements.p1SysVoltageSelect && !controllerElements.p1SysVoltageSelect.value) {
            let matched = false;
            const options = controllerElements.p1SysVoltageSelect.options;
            for (let i = 0; i < options.length; i++) {
                if (parseInt(options[i].value) === rawVoltage) {
                    controllerElements.p1SysVoltageSelect.value = options[i].value;
                    matched = true;
                    break;
                }
            }
        }
    }
    safeSetText(controllerElements.p1CurrentLimitValue, state.controllerParams1?.current_limit);
    safeSetInput(controllerElements.p1CurrentLimitInput, state.controllerParams1, 'current_limit');
    safeSetText(controllerElements.p1MaxCurrentLowChargeValue, state.controllerParams1?.max_current_on_low_charge);
    safeSetInput(controllerElements.p1MaxCurrentLowChargeInput, state.controllerParams1, 'max_current_on_low_charge');
    safeSetText(controllerElements.p1OverVoltageValue, state.controllerParams1?.overvoltage);
    safeSetInput(controllerElements.p1OverVoltageInput, state.controllerParams1, 'overvoltage');
    safeSetText(controllerElements.p1UnderVoltageLoadValue, state.controllerParams1?.undervoltage_under_load);
    safeSetInput(controllerElements.p1UnderVoltageLoadInput, state.controllerParams1, 'undervoltage_under_load');
    safeSetText(controllerElements.p1UnderVoltageIdleValue, state.controllerParams1?.undervoltage);
    safeSetInput(controllerElements.p1UnderVoltageIdleInput, state.controllerParams1, 'undervoltage');
    if (controllerElements.electricPlaceholder) controllerElements.electricPlaceholder.style.display = state.controllerParams1 ? 'none' : 'block';

    // Speed P1
    safeSetText(controllerElements.p1SpeedLimitEnabledValue, state.controllerParams1?.speed_limit_enabled);
    safeSetInput(controllerElements.p1SpeedLimitEnabledInput, state.controllerParams1, 'speed_limit_enabled');

    // Battery P1
    safeSetText(controllerElements.p1BattCapacityValue, state.controllerParams1?.battery_capacity);
    safeSetInput(controllerElements.p1BattCapacityInput, state.controllerParams1, 'battery_capacity');
    safeSetText(controllerElements.p1LimpModeSocValue, state.controllerParams1?.limp_mode_soc_limit);
    safeSetInput(controllerElements.p1LimpModeSocInput, state.controllerParams1, 'limp_mode_soc_limit');
    safeSetText(controllerElements.p1FullRangeValue, state.controllerParams1?.full_capacity_range);
    safeSetInput(controllerElements.p1FullRangeInput, state.controllerParams1, 'full_capacity_range');
    if (controllerElements.batteryPlaceholder) controllerElements.batteryPlaceholder.style.display = state.controllerParams1 ? 'none' : 'block';

    // Mechanical P1
    safeSetText(controllerElements.p1GearRatioValue, state.controllerParams1?.deceleration_ratio, (val) => getNullableNumber(val, 2));
    safeSetInput(controllerElements.p1GearRatioInput, state.controllerParams1, 'deceleration_ratio');
    safeSetText(controllerElements.p1CoasterBrakeValue, state.controllerParams1?.coaster_brake, getNullableBoolean);
    safeSetSelectBoolean(controllerElements.p1CoasterBrakeInput, state.controllerParams1, 'coaster_brake');
    safeSetText(controllerElements.p1MaxRpmValue, state.controllerParams1?.motor_max_rotor_rpm);
    safeSetInput(controllerElements.p1MaxRpmInput, state.controllerParams1, 'motor_max_rotor_rpm');
    safeSetText(controllerElements.p1CadenceSignalsValue, state.controllerParams1?.pedal_sensor_signals_per_rotation);
    safeSetInput(controllerElements.p1CadenceSignalsInput, state.controllerParams1, 'pedal_sensor_signals_per_rotation');
    safeSetText(controllerElements.p1MotorTypeValue, state.controllerParams1?.motor_type);
    safeSetInput(controllerElements.p1MotorTypeInput, state.controllerParams1, 'motor_type');
    safeSetText(controllerElements.p1PolePairNumberValue, state.controllerParams1?.motor_pole_pair_number);
    safeSetInput(controllerElements.p1PolePairNumberInput, state.controllerParams1, 'motor_pole_pair_number');
    safeSetText(controllerElements.p1TempSensorValue, state.controllerParams1?.temperature_sensor_type);
    safeSetInput(controllerElements.p1TempSensorInput, state.controllerParams1, 'temperature_sensor_type');
    safeSetText(controllerElements.p1SpeedMagnetsValue, state.controllerParams1?.speedmeter_magnets_number);
    safeSetInput(controllerElements.p1SpeedMagnetsInput, state.controllerParams1, 'speedmeter_magnets_number');
    safeSetText(controllerElements.p1LampsOnValue, state.controllerParams1?.lamps_always_on, getNullableBoolean);
    safeSetSelectBoolean(controllerElements.p1LampsOnInput, state.controllerParams1, 'lamps_always_on');
    if (controllerElements.mechPlaceholder) controllerElements.mechPlaceholder.style.display = state.controllerParams1 ? 'none' : 'block';

    // Driving P1
    safeSetText(controllerElements.p1StartCurrentValue, state.controllerParams1?.start_current);
    safeSetInput(controllerElements.p1StartCurrentInput, state.controllerParams1, 'start_current');
    safeSetText(controllerElements.p1CurrentLoadTimeValue, state.controllerParams1?.current_loading_time, (val) => getNullableNumber(val, 1));
    safeSetFormattedInput(controllerElements.p1CurrentLoadTimeInput, state.controllerParams1, 'current_loading_time', (val) => val?.toFixed(1));
    safeSetText(controllerElements.p1CurrentShedTimeValue, state.controllerParams1?.current_shedding_time, (val) => getNullableNumber(val, 1));
    safeSetFormattedInput(controllerElements.p1CurrentShedTimeInput, state.controllerParams1, 'current_shedding_time', (val) => val?.toFixed(1));
    safeSetText(controllerElements.p1PedalTypeValue, state.controllerParams1?.pedal_sensor_type);
    safeSetSelectDirect(controllerElements.p1PedalTypeInput, state.controllerParams1, 'pedal_sensor_type');
    if (controllerElements.drivingPlaceholder) controllerElements.drivingPlaceholder.style.display = state.controllerParams1 ? 'none' : 'block';

    // Throttle P1
    safeSetText(controllerElements.p1ThrottleStartValue, state.controllerParams1?.throttle_start_voltage, (val) => getNullableNumber(val, 1));
    safeSetFormattedInput(controllerElements.p1ThrottleStartInput, state.controllerParams1, 'throttle_start_voltage', (val) => val?.toFixed(1));
    safeSetText(controllerElements.p1ThrottleEndValue, state.controllerParams1?.throttle_max_voltage, (val) => getNullableNumber(val, 1));
    safeSetFormattedInput(controllerElements.p1ThrottleEndInput, state.controllerParams1, 'throttle_max_voltage', (val) => val?.toFixed(1));
    if (controllerElements.throttlePlaceholder) controllerElements.throttlePlaceholder.style.display = state.controllerParams1 ? 'none' : 'block';

    // Speed Params (P3 + P1 Walk Assist)
    safeSetText(controllerElements.p3SpeedLimitValue, state.controllerSpeedParams?.speed_limit, (val) => getNullableNumber(val, 2));
    safeSetFormattedInput(controllerElements.p3SpeedLimitInput, state.controllerSpeedParams, 'speed_limit', (val) => val?.toFixed(2));
    safeSetText(controllerElements.p3WheelDiameterValue, state.controllerSpeedParams?.wheel_diameter?.text);
    safeSetSelectDirect(controllerElements.p3WheelDiameterInput, state.controllerSpeedParams?.wheel_diameter, 'text');

    safeSetText(controllerElements.p3CircumferenceValue, state.controllerSpeedParams?.circumference);
    safeSetInput(controllerElements.p3CircumferenceInput, state.controllerSpeedParams, 'circumference');

    safeSetText(controllerElements.p1WalkAssistSpeedValue, state.controllerParams1?.walk_assist_speed, (val) => getNullableNumber(val, 2));
    safeSetFormattedInput(controllerElements.p1WalkAssistSpeedInput, state.controllerParams1, 'walk_assist_speed', (val) => val?.toFixed(1));

    if (controllerElements.speedPlaceholder) controllerElements.speedPlaceholder.style.display = (state.controllerParams1 && state.controllerSpeedParams) ? 'none' : 'block';
}

controllerElements.syncButton.onclick = async () => {
    addLog('REQ', 'Syncing all Controller data...');
    state.controllerErrors = null;
    socket.send('READ:2:96:7'); // Errors
    await waitFor(() => state.controllerErrors !== null);
    state.controllerParams1 = null;
    socket.send('READ:2:96:17'); // Parameter 1
    await waitFor(() => state.controllerParams1 !== null);
    socket.send('READ:2:50:3'); // Speed Params
};

controllerElements.saveButton.onclick = () => {
    if (!confirm("Are you sure you want to write changes to the Controller?")) return;
    addLog('SAVE_REQ', 'Saving Controller Changes...');
    let changesMade = false;
    let p1ToSend = null;
    let speedToSend = null;

    // --- Collect P1 Changes ---
    if (state.controllerParams1) {
        p1ToSend = { assist_levels: state.controllerParams1.assist_levels };
        let p1Changed = false;

        const selectedVoltageStr = controllerElements.p1SysVoltageSelect.value;
        if (selectedVoltageStr !== "") {
            const selectedVoltage = parseInt(selectedVoltageStr, 10);
            if (!isNaN(selectedVoltage) && selectedVoltage !== state.controllerParams1.system_voltage) {
                p1ToSend.system_voltage = selectedVoltage;
                p1Changed = true;
                addLog('DEBUG', `System Voltage will be changed to: ${selectedVoltage}V`);
            } else if (isNaN(selectedVoltage)) {
                addLog('ERROR', `Invalid value selected for System Voltage: ${selectedVoltageStr}`);
            }
        }

        const checkP1 = (key, inputElement, parserFunc = parseFloat, precision = -1) => {
            const inputValue = inputElement.value;
            if (inputValue !== "") {
                const parsedValue = parserFunc(inputValue);
                const originalValue = state.controllerParams1[key];
                let originalComparable = (precision >= 0 && typeof originalValue === 'number') ? parseFloat(originalValue.toFixed(precision)) : originalValue;
                let inputComparable = (precision >= 0 && typeof parsedValue === 'number') ? parseFloat(parsedValue.toFixed(precision)) : parsedValue;

                if (inputElement.tagName === 'SELECT' && typeof originalComparable === 'boolean') {
                    inputComparable = (inputValue === "true");
                }

                if (inputComparable !== originalComparable && !isNaN(parsedValue)) {
                    p1ToSend[key] = parsedValue;
                    p1Changed = true;
                } else if (isNaN(parsedValue)) {
                    addLog('ERROR', `Invalid number format for ${key}: ${inputValue}`);
                }
            }
        };
        checkP1('current_limit', controllerElements.p1CurrentLimitInput, parseInt);
        checkP1('speed_limit_enabled', controllerElements.p1SpeedLimitEnabledInput, parseInt);
        checkP1('max_current_on_low_charge', controllerElements.p1MaxCurrentLowChargeInput, parseInt);
        checkP1('overvoltage', controllerElements.p1OverVoltageInput, parseInt);
        checkP1('undervoltage_under_load', controllerElements.p1UnderVoltageLoadInput, parseInt);
        checkP1('undervoltage', controllerElements.p1UnderVoltageIdleInput, parseInt);
        checkP1('battery_capacity', controllerElements.p1BattCapacityInput, parseInt);
        checkP1('limp_mode_soc_limit', controllerElements.p1LimpModeSocInput, parseInt);
        checkP1('full_capacity_range', controllerElements.p1FullRangeInput, parseInt);
        checkP1('speedmeter_magnets_number', controllerElements.p1SpeedMagnetsInput, parseInt);
        checkP1('lamps_always_on', controllerElements.p1LampsOnInput, val => val === "true");
        checkP1('start_current', controllerElements.p1StartCurrentInput, parseInt);
        checkP1('current_loading_time', controllerElements.p1CurrentLoadTimeInput, parseFloat, 1);
        checkP1('current_shedding_time', controllerElements.p1CurrentShedTimeInput, parseFloat, 1);
        checkP1('pedal_sensor_type', controllerElements.p1PedalTypeInput, parseInt);
        checkP1('throttle_start_voltage', controllerElements.p1ThrottleStartInput, parseFloat, 1);
        checkP1('throttle_max_voltage', controllerElements.p1ThrottleEndInput, parseFloat, 1);
        checkP1('walk_assist_speed', controllerElements.p1WalkAssistSpeedInput, parseFloat, 1);
        checkP1('deceleration_ratio', controllerElements.p1GearRatioInput, parseFloat, 2);
        checkP1('coaster_brake', controllerElements.p1CoasterBrakeInput, val => val === "true");
        checkP1('motor_max_rotor_rpm', controllerElements.p1MaxRpmInput, parseInt);
        checkP1('pedal_sensor_signals_per_rotation', controllerElements.p1CadenceSignalsInput, parseInt);
        checkP1('motor_type', controllerElements.p1MotorTypeInput, parseInt);
        checkP1('motor_pole_pair_number', controllerElements.p1PolePairNumberInput, parseInt);
        checkP1('temperature_sensor_type', controllerElements.p1TempSensorInput, parseInt);

        if (p1Changed) {
            if (p1ToSend.system_voltage === undefined && state.controllerParams1.system_voltage !== undefined) {
                p1ToSend.system_voltage = state.controllerParams1.system_voltage;
            }
            socket.send(`WRITE_LONG_P1:${JSON.stringify(p1ToSend)}`);
            addLog('SAVE_REQ', 'Controller Parameter 1');
            changesMade = true;
        }
    } else {
        addLog('INFO', 'Cannot save P1 - read data first.');
    }

    // --- Collect Speed Param Changes ---
    if (state.controllerSpeedParams) {
        speedToSend = {};
        let speedChanged = false;

        const speedLimitInputVal = controllerElements.p3SpeedLimitInput.value;
        if (speedLimitInputVal !== "") {
            const parsedSpeedLimit = parseFloat(speedLimitInputVal);
            if (!isNaN(parsedSpeedLimit)) {
                speedToSend.speed_limit = parsedSpeedLimit;
                speedChanged = true;
            } else { addLog('ERROR', `Invalid number format for speed_limit: ${speedLimitInputVal}`); }
        }

        const selectedWheelText = controllerElements.p3WheelDiameterInput.value;
        if (selectedWheelText !== "") {
            const selectedOption = controllerElements.p3WheelDiameterInput.options[controllerElements.p3WheelDiameterInput.selectedIndex];
            if (selectedOption && selectedOption.dataset.code0 && selectedOption.dataset.code1) {
                speedToSend.wheel_diameter = {
                    text: selectedWheelText,
                    code: [parseInt(selectedOption.dataset.code0), parseInt(selectedOption.dataset.code1)],
                };
                speedChanged = true;
            } else { addLog('ERROR', 'Selected wheel diameter option is missing code data.'); }
        }

        const circumferenceInputVal = controllerElements.p3CircumferenceInput.value;
        if (circumferenceInputVal !== "") {
            const parsedCircumference = parseInt(circumferenceInputVal, 10);
            if (!isNaN(parsedCircumference)) {
                speedToSend.circumference = parsedCircumference;
                speedChanged = true;
            } else { addLog('ERROR', `Invalid number format for circumference: ${circumferenceInputVal}`); }
        }

        if (speedChanged) {
            if (!speedToSend.wheel_diameter && state.controllerSpeedParams.wheel_diameter) {
                speedToSend.wheel_diameter = state.controllerSpeedParams.wheel_diameter;
            }
            if (!speedToSend.circumference && typeof state.controllerSpeedParams.circumference === 'number') {
                speedToSend.circumference = state.controllerSpeedParams.circumference;
            }

            if (speedToSend.wheel_diameter && typeof speedToSend.circumference === 'number' && typeof speedToSend.speed_limit === 'number') {
                socket.send(`WRITE_LONG_SPEED:${JSON.stringify(speedToSend)}`);
                addLog('SAVE_REQ', 'Controller Speed Params (via WRITE_LONG_SPEED)');
                changesMade = true;
            } else {
                addLog('ERROR', 'Cannot save speed params: Missing speed limit, wheel diameter, or circumference.');
                if (!speedToSend.wheel_diameter) console.error("Debug: speedToSend.wheel_diameter is missing");
                if (typeof speedToSend.circumference !== 'number') console.error("Debug: speedToSend.circumference is missing or not a number");
                if (typeof speedToSend.speed_limit !== 'number') console.error("Debug: speedToSend.speed_limit is missing or not a number");
            }
        }
    } else {
        addLog('INFO', 'Cannot save Speed Params - read data first (controllerSpeedParams is null).');
    }

    if (!changesMade) {
        addLog('INFO', 'No controller changes detected to save.');
    }
};

controllerElements.calibratePositionButton.onclick = () => {
    if (confirm("WARNING: Motor will spin!\n\nEnsure chain is removed and bike is secure.\n\nProceed with Position Sensor Calibration?")) {
        socket.send("WRITE_SHORT:2:98:0:0000000000");
        addLog('SAVE_REQ', 'Calibrate Position Sensor');
    }
};

controllerElements.calibrateTorqueButton.onclick = () => {
    socket.send("WRITE_SHORT:2:97:1");
    addLog('SAVE_REQ', 'Calibrate Torque Sensor');
};

controllerElements.controllerClearErrorsButton.onclick = async () => {
    socket.send("WRITE_SHORT:2:96:7:01");
    await delay(500);
    sendCustomFrame(encodeToHex(5, 2, 4, '6007'), '00');
    await delay(500);
    sendCustomFrame(encodeToHex(5, 2, 6, '0000'), '');
    await delay(500);
    socket.send('READ:2:96:7');
    addLog('SAVE_REQ', 'Clear Controller Errors');
};

checksumElements.ctrlP1ChecksumFixButton.onclick = async () => {
    if (state.lastControllerP1Read) {
        socket.send(`WRITE_LONG_P1:${JSON.stringify(state.lastControllerP1Read)}`);
        addLog('SAVE_REQ', 'Controller Parameter 1');
        setTimeout(() => {
            socket.send('READ:2:96:17');
        }, 1000);
    }
};

checksumElements.gearsP2ChecksumFixButton.onclick = async () => {
    if (state.lastControllerP2Read) {
        socket.send(`WRITE_LONG_P2:${JSON.stringify(state.lastControllerP2Read)}`);
        addLog('SAVE_REQ', 'Controller Parameter 2');
        setTimeout(() => {
            socket.send('READ:2:96:18');
        }, 1000);
    }
};