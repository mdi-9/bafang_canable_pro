// websocket.js — ES Module
import {
    state, socket,
    statusText, canDeviceNameElement,
    controllerElements, displayElements,
    fwUpdateElements, tabButtons, connectCanButton,
    addLog, autoPopup, updateStatus,
    updateCanInterfaceDisplay,
    getProductionDateFromSerial, calculateStartPulse,
    wheelDiameterTable,
} from './shared.js';
import { updateDisplayUI, createErrorsTable } from './tab-display.js';
import { updateControllerUI, updateControllerStateUI } from './tab-controller.js';
import { updateSensorUI } from './tab-sensor.js';
import { updateBatteryUI } from './tab-battery.js';
import { updateGearsUI, updatePasCurvesChartUnified, updateStartRampChartUnified } from './tab-gears.js';
import { updateGearsUIM820 } from './tab-gears-m820.js';
import { updateInfoUI } from './tab-info.js';
import { populateHexEditor, handleCustomRaw } from './tab-debug.js';
import { updateFwUpdateProgress, addFwUpdateLog } from './tab-firmware.js';
import { addSnifferLog } from './tab-sniffer.js';
import { updateRideChart } from './tab-ride-logger.js';

socket.onopen = () => {
    addLog('STATUS', 'WebSocket connection opened.');
    socket.send('GET_CAN_INTERFACE_STATUS');
};

socket.onclose = () => {
    updateCanInterfaceDisplay('DEVICE_NOT_FOUND');
    statusText.textContent = 'Disconnected (WebSocket Closed)';
    canDeviceNameElement.textContent = 'Connection to server lost.';
    addLog('STATUS', 'WebSocket connection closed.');
};

socket.onerror = (error) => {
    console.error("WebSocket Error:", error);
    updateCanInterfaceDisplay('DEVICE_NOT_FOUND');
    statusText.textContent = `Disconnected (WebSocket Error: ${error.message || 'Unknown'})`;
    canDeviceNameElement.textContent = 'Error connecting to server.';
    addLog('ERROR', `WebSocket error: ${error.message || 'Unknown error'}`);
};

socket.onmessage = (event) => {
    const message = event.data;
    let needsDisplayUpdate = false;
    let needsSensorUpdate = false;
    let needsBatteryUpdate = false;
    let needsControllerUpdate = false;
    let needsControllerStateUpdate = false;
    let needsGearsUpdate = false;
    let needsGearsM820Update = false;
    let needsInfoUpdate = false;
    let needsHexEditorUpdate = false;
    let needsPasChartUpdate = false;
    let needsStartRampChartUpdate = false;
    let needsPasChartUpdateM820 = false;
    let needsStartRampChartUpdateM820 = false;

    if (message.startsWith('CAN_DEVICE_STATUS:')) {
        const parts = message.substring('CAN_DEVICE_STATUS:'.length).split(':');
        const statusType = parts[0];
        const deviceName = parts.length > 1 ? parts[1] : state.currentCanDeviceName;

        state.isCanConnected = (statusType === 'CONNECTED');
        state.isCanDeviceFound = (statusType === 'FOUND' || statusType === 'CONNECTED' || statusType === 'DISCONNECTED_DEVICE_STILL_PRESENT' || statusType === 'CONNECTING' || statusType === 'DISCONNECTING');
        if (deviceName && (state.isCanDeviceFound || state.isCanConnected)) {
            state.currentCanDeviceName = deviceName;
        } else if (statusType === 'NOT_FOUND') {
            state.currentCanDeviceName = null;
        }
        updateCanInterfaceDisplay(statusType, state.currentCanDeviceName);
    }
    else if (message.startsWith('CAN_STATUS:')) {
        const statusMsg = message.substring('CAN_STATUS:'.length).trim();
        addLog('STATUS', `CAN Bus Info: ${statusMsg}`);
        if (statusMsg.toLowerCase().includes('error connecting') || statusMsg.toLowerCase().includes('connection lost')) {
            if (!state.isCanConnected) {
                updateCanInterfaceDisplay('DEVICE_NOT_FOUND');
                statusText.textContent = `Disconnected (CAN Error: ${statusMsg})`;
            }
        }
    }

    if (message.startsWith('CAN_STATUS:')) { const statusMsg = message.substring('CAN_STATUS:'.length).trim(); const isConnected = statusMsg.toLowerCase().includes('connected') || statusMsg.toLowerCase().includes('started'); updateStatus(isConnected, `(${statusMsg})`); addLog('STATUS', statusMsg); }
    else if (message.startsWith('CAN_ERROR:')) { const errorMsg = message.substring('CAN_ERROR:'.length).trim(); addLog('ERROR', errorMsg); }
    else if (message.startsWith('BAFANG_DATA:')) {
        const jsonString = message.substring('BAFANG_DATA:'.length);
        try {
            const parsedEvent = JSON.parse(jsonString);
            state.allEventsStore[parsedEvent.type] = parsedEvent;

            const typesToSkipInUILog = [
                'sensor_realtime',
                'battery_state',
                'battery_capacity',
                'display_realtime',
                'controller_realtime_0',
                'controller_state',
                'controller_realtime_1',
                'display_data_1',
                'display_data_2',
                'display_data_lightsensor',
                'display_autoshutdown_time',
                'controller_current_assist_level',
                'controller_calories',
                'controller_speed_params',
                'sensor',
                'battery',
                'display',
                'controller',
            ];

            if (!typesToSkipInUILog.includes(parsedEvent.type)) {
                addLog(`RX (${parsedEvent.type || 'unknown'})`, parsedEvent.data || parsedEvent);
            }

            switch (parsedEvent.type) {
                // Normal ACKs
                case 'normal_ack': if (parsedEvent.data) { addLog("ACK", parsedEvent.data); autoPopup(parsedEvent.data, 'green'); } break;
                case 'error_ack': if (parsedEvent.data) { addLog("ACK", parsedEvent.data); autoPopup(parsedEvent.data, 'red'); } break;
                // Display Data
                case 'display_data_1': state.displayData1 = parsedEvent.data; needsDisplayUpdate = true; break;
                case 'display_data_2': state.displayData2 = parsedEvent.data; needsDisplayUpdate = true; break;
                case 'display_realtime': state.displayRealtime = parsedEvent.data; needsDisplayUpdate = true; break;
                case 'display_errors': state.displayErrors = parsedEvent.data?.error_codes ?? []; createErrorsTable(displayElements.errorTableBody, state.displayErrors); break;
                case 'controller_errors': state.controllerErrors = parsedEvent.data?.error_codes ?? []; createErrorsTable(controllerElements.errorTableBody, state.controllerErrors); break;
                case 'display_autoshutdown_time': state.displayShutdownTime = parsedEvent.data?.display_auto_shutdown_time; needsDisplayUpdate = true; break;
                // Controller Data
                case 'controller_realtime_0': state.controllerRealtime0 = parsedEvent.data; needsControllerUpdate = true; break;
                case 'controller_state': state.controllerState = parsedEvent.data; needsControllerStateUpdate = true; break;
                case 'controller_realtime_1': state.controllerRealtime1 = parsedEvent.data; needsControllerUpdate = true; break;
                case 'controller_params_0':
                    state.controllerParams0 = parsedEvent.data;
                    state.lastControllerP0 = JSON.parse(JSON.stringify(parsedEvent.data || {}));
                    if (parsedEvent.data && parsedEvent.data._rawBytes && Array.isArray(parsedEvent.data._rawBytes)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data._rawBytes];
                        needsHexEditorUpdate = true;
                    } else if (parsedEvent.data && parsedEvent.data.raw_data && Array.isArray(parsedEvent.data.raw_data)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data.raw_data];
                        needsHexEditorUpdate = true;
                    }
                    needsControllerUpdate = true;
                    needsGearsUpdate = true;
                    needsPasChartUpdate = true;
                    needsStartRampChartUpdate = true;
                    break;
                case 'controller_params_1':
                    state.controllerParams1 = parsedEvent.data;
                    state.lastControllerP1 = JSON.parse(JSON.stringify(parsedEvent.data || {}));
                    state.lastControllerP1Read = JSON.parse(JSON.stringify(parsedEvent.data || {}));
                    if (state.lastStartupAngle !== null && state.lastControllerP1?.pedal_sensor_signals_per_rotation !== undefined && state.lastControllerP2?.torque_profiles?.[0]) {
                        try {
                            const calculatedPulse = calculateStartPulse(state.lastStartupAngle, state.lastControllerP1.pedal_sensor_signals_per_rotation);
                            if (state.lastControllerP2.torque_profiles[0].start_pulse !== calculatedPulse) {
                                console.log(`Recalculating Start Pulse[0] due to P1 change: ${calculatedPulse}`);
                                state.lastControllerP2.torque_profiles[0].start_pulse = calculatedPulse;
                                needsGearsUpdate = true;
                                needsGearsM820Update = true;
                            }
                        } catch (e) {
                            console.error("Error recalculating start pulse after P1 update:", e);
                        }
                    }
                    if (parsedEvent.data && parsedEvent.data._rawBytes && Array.isArray(parsedEvent.data._rawBytes)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data._rawBytes];
                        needsHexEditorUpdate = true;
                    } else if (parsedEvent.data && parsedEvent.data.raw_data && Array.isArray(parsedEvent.data.raw_data)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data.raw_data];
                        needsHexEditorUpdate = true;
                    }
                    needsControllerUpdate = true;
                    needsGearsUpdate = true;
                    needsGearsM820Update = true;
                    needsPasChartUpdate = true;
                    needsStartRampChartUpdate = true;
                    needsPasChartUpdateM820 = true;
                    needsStartRampChartUpdateM820 = true;
                    break;
                case 'controller_params_2':
                    state.controllerParams2 = parsedEvent.data;
                    state.lastControllerP2 = JSON.parse(JSON.stringify(parsedEvent.data || {}));
                    state.lastControllerP2Read = JSON.parse(JSON.stringify(parsedEvent.data || {}));
                    if (parsedEvent.data && parsedEvent.data._rawBytes && Array.isArray(parsedEvent.data._rawBytes)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data._rawBytes];
                        needsHexEditorUpdate = true;
                    } else if (parsedEvent.data && parsedEvent.data.raw_data && Array.isArray(parsedEvent.data.raw_data)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data.raw_data];
                        needsHexEditorUpdate = true;
                    }
                    needsGearsUpdate = true;
                    needsGearsM820Update = true;
                    needsStartRampChartUpdateM820 = true;
                    break;
                case 'controller_params_6017':
                    if (parsedEvent.data && parsedEvent.data._rawBytes && Array.isArray(parsedEvent.data._rawBytes)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data._rawBytes];
                        addLog('INFO', `Received Controller Custom Block (0x6017) - ${parsedEvent.data._rawBytes.length} bytes.`);
                        if (state.currentRawParamType === 'controller_params_6017') {
                            needsHexEditorUpdate = true;
                        }
                    } else {
                        addLog('WARN', `Received ${parsedEvent.type} but no _rawBytes found.`);
                    }
                    break;
                case 'controller_params_6018':
                    if (parsedEvent.data && parsedEvent.data._rawBytes && Array.isArray(parsedEvent.data._rawBytes)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data._rawBytes];
                        addLog('INFO', `Received Controller Custom Block (0x6018) - ${parsedEvent.data._rawBytes.length} bytes.`);
                        if (state.currentRawParamType === 'controller_params_6018') {
                            needsHexEditorUpdate = true;
                        }
                    } else {
                        addLog('WARN', `Received ${parsedEvent.type} but no _rawBytes found.`);
                    }
                    break;
                case 'controller_speed_params': {
                    const speedData = parsedEvent.data;
                    if (speedData && Array.isArray(speedData.wheel_diameter_code)) {
                        const code0 = speedData.wheel_diameter_code[0];
                        const code1 = speedData.wheel_diameter_code[1];
                        const foundWheel = wheelDiameterTable.find(wheel => wheel.code[0] === code0 && wheel.code[1] === code1);
                        state.controllerSpeedParams = {
                            speed_limit: speedData.speed_limit,
                            circumference: speedData.circumference,
                            wheel_diameter: foundWheel ? foundWheel : { text: `Code ${code0.toString(16)}/${code1.toString(16)}`, code: [code0, code1] },
                        };
                    } else {
                        state.controllerSpeedParams = parsedEvent.data;
                    }
                    if (parsedEvent.data && parsedEvent.data._rawBytes && Array.isArray(parsedEvent.data._rawBytes)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data._rawBytes];
                        needsHexEditorUpdate = true;
                    } else if (parsedEvent.data && parsedEvent.data.raw_data && Array.isArray(parsedEvent.data.raw_data)) {
                        state.rawParamData[parsedEvent.type] = [...parsedEvent.data.raw_data];
                        needsHexEditorUpdate = true;
                    }
                    needsControllerUpdate = true;
                    break;
                }
                case 'controller_startup_angle':
                    state.lastStartupAngle = parsedEvent.data?.startup_angle;
                    if (state.lastStartupAngle !== null && state.lastControllerP1?.pedal_sensor_signals_per_rotation !== undefined && state.lastControllerP2?.torque_profiles?.[0]) {
                        try {
                            const calculatedPulse = calculateStartPulse(state.lastStartupAngle, state.lastControllerP1.pedal_sensor_signals_per_rotation);
                            if (state.lastControllerP2.torque_profiles[0].start_pulse !== calculatedPulse) {
                                console.log(`Recalculating Start Pulse[0] due to Angle change: ${calculatedPulse}`);
                                state.lastControllerP2.torque_profiles[0].start_pulse = calculatedPulse;
                                needsGearsUpdate = true;
                                needsGearsM820Update = true;
                            }
                        } catch (e) {
                            console.error("Error recalculating start pulse after angle update:", e);
                        }
                    }
                    needsGearsUpdate = true;
                    needsGearsM820Update = true;
                    break;
                // --- INFO CASES ---
                case 'controller_hw_version': state.controllerOtherInfo.hwVersion = parsedEvent.data?.hardware_version; needsInfoUpdate = true; break;
                case 'controller_sw_version': state.controllerOtherInfo.swVersion = parsedEvent.data?.software_version; needsInfoUpdate = true; break;
                case 'controller_sn': state.controllerOtherInfo.serialNumber = parsedEvent.data?.serial_number; state.controllerOtherInfo.productionDate = getProductionDateFromSerial(parsedEvent.data?.serial_number); needsInfoUpdate = true; break;
                case 'controller_mn': state.controllerOtherInfo.modelNumber = parsedEvent.data?.model_number; needsInfoUpdate = true; break;
                case 'controller_mfg': state.controllerOtherInfo.manufacturer = parsedEvent.data?.manufacturer; needsInfoUpdate = true; break;

                case 'display_hw_version': state.displayOtherInfo.hwVersion = parsedEvent.data?.hardware_version; needsInfoUpdate = true; break;
                case 'display_sw_version': state.displayOtherInfo.swVersion = parsedEvent.data?.software_version; needsInfoUpdate = true; break;
                case 'display_sn': state.displayOtherInfo.serialNumber = parsedEvent.data?.serial_number; state.displayOtherInfo.productionDate = getProductionDateFromSerial(parsedEvent.data?.serial_number); needsInfoUpdate = true; break;
                case 'display_mn': state.displayOtherInfo.modelNumber = parsedEvent.data?.model_number; needsInfoUpdate = true; break;
                case 'display_cn': state.displayOtherInfo.customerNumber = parsedEvent.data?.customer_number; needsInfoUpdate = true; break;
                case 'display_mfg': state.displayOtherInfo.manufacturer = parsedEvent.data?.manufacturer; needsInfoUpdate = true; break;
                case 'display_bootloader_version': state.displayOtherInfo.bootloaderVersion = parsedEvent.data?.bootloader_version; needsInfoUpdate = true; break;

                // Sensor Data
                case 'sensor_realtime': state.sensorRealtime = parsedEvent.data; needsSensorUpdate = true; break;
                case 'sensor_hw_version': state.sensorOtherInfo.hwVersion = parsedEvent.data?.hardware_version; needsInfoUpdate = true; break;
                case 'sensor_sw_version': state.sensorOtherInfo.swVersion = parsedEvent.data?.software_version; needsInfoUpdate = true; break;
                case 'sensor_mn': state.sensorOtherInfo.modelNumber = parsedEvent.data?.model_number; needsInfoUpdate = true; break;
                case 'sensor_sn': state.sensorOtherInfo.serialNumber = parsedEvent.data?.serial_number; state.sensorOtherInfo.productionDate = getProductionDateFromSerial(parsedEvent.data?.serial_number); needsInfoUpdate = true; break;
                // Battery Data
                case 'battery_capacity': state.batteryCapacity = parsedEvent.data; needsBatteryUpdate = true; break;
                case 'battery_state': state.batteryState = parsedEvent.data; needsBatteryUpdate = true; break;
                case 'battery_design': state.batteryDesign = parsedEvent.data; needsBatteryUpdate = true; break;
                case 'battery_charging_info': state.batteryChargingInfo = parsedEvent.data; needsBatteryUpdate = true; break;
                case 'battery_cells_raw': {
                    const cellData = parsedEvent.data?.raw_cell_data;
                    const subCode = parsedEvent.data?.subcode;
                    if (Array.isArray(cellData) && subCode >= 2 && subCode <= 5) {
                        const baseIndex = (subCode - 2) * 4;
                        for (let i = 0; i < cellData.length / 2; i++) {
                            const voltage = ((cellData[i * 2 + 1] << 8) + cellData[i * 2]) / 1000;
                            state.batteryCells[baseIndex + i] = voltage;
                        }
                        let batteryCellsArray = Object.values(state.batteryCells).filter(v => v && v > 0);
                        state.batteryCellsStats = {
                            maxVoltage: Math.max(...batteryCellsArray) * 1000,
                            minVoltage: Math.min(...batteryCellsArray) * 1000,
                            diffVoltage: null,
                        };
                        state.batteryCellsStats.diffVoltage = state.batteryCellsStats.maxVoltage - state.batteryCellsStats.minVoltage;
                        needsBatteryUpdate = true;
                    }
                    break;
                }
                case 'battery_hw_version': state.batteryOtherInfo.hwVersion = parsedEvent.data?.hardware_version; needsBatteryUpdate = true; break;
                case 'battery_sw_version': state.batteryOtherInfo.swVersion = parsedEvent.data?.software_version; needsBatteryUpdate = true; break;
                case 'battery_mn': state.batteryOtherInfo.modelNumber = parsedEvent.data?.model_number; needsBatteryUpdate = true; break;
                case 'battery_sn': state.batteryOtherInfo.serialNumber = parsedEvent.data?.serial_number; state.batteryOtherInfo.productionDate = getProductionDateFromSerial(parsedEvent.data?.serial_number); needsBatteryUpdate = true; break;
            }

            let needsHexEditorUpdateC = handleCustomRaw(parsedEvent);
            // Call UI update functions if needed
            if (needsDisplayUpdate) updateDisplayUI();
            if (needsSensorUpdate) updateSensorUI();
            if (needsBatteryUpdate) updateBatteryUI();
            if (needsControllerUpdate) updateControllerUI();
            if (needsControllerStateUpdate) updateControllerStateUI();
            if (needsGearsUpdate) updateGearsUI();
            if (needsGearsM820Update) updateGearsUIM820();
            if (needsInfoUpdate) updateInfoUI();
            if (needsHexEditorUpdate || needsHexEditorUpdateC) populateHexEditor();
            if (needsPasChartUpdate) updatePasCurvesChartUnified(false);
            if (needsStartRampChartUpdate) updateStartRampChartUnified(false);
            if (needsPasChartUpdateM820) updatePasCurvesChartUnified(true);
            if (needsStartRampChartUpdateM820) updateStartRampChartUnified(true);

        } catch (e) {
            console.error("Error processing BAFANG_DATA:", e);
            addLog('ERROR', `Failed processing received data: ${e.message}. Raw: ${jsonString}`);
        }
    }
    else if (message.startsWith('Sent Raw:')) { addLog('TX (Raw)', message.substring('Sent Raw:'.length).trim()); }
    else if (message.startsWith('INFO:')) { addLog('INFO', message.substring('INFO:'.length).trim()); }
    else if (message.startsWith('ACK:')) { addLog('ACK', message.substring('ACK:'.length).trim()); }
    else if (message.startsWith('NACK:')) { addLog('NACK', message.substring('NACK:'.length).trim()); }
    else if (message.startsWith('FW_UPDATE_LOG:')) { addFwUpdateLog(message.substring('FW_UPDATE_LOG:'.length).trim()); }
    else if (message.startsWith('FW_UPDATE_PROGRESS:')) { updateFwUpdateProgress(message.substring('FW_UPDATE_PROGRESS:'.length).trim()); }
    else if (message.startsWith('FW_UPDATE_END')) {
        fwUpdateElements.fileInput.disabled = false;
        fwUpdateElements.fileInput.value = "";
        tabButtons.forEach(button => button.disabled = false);
        connectCanButton.disabled = false;
    }
    else if (message.startsWith('SNIFFER_ENTRY:')) { addSnifferLog(message.substring('SNIFFER_ENTRY:'.length).trim()); }
    else if (message.startsWith('RIDE_LOGGER_ENTRY:')) { updateRideChart(message.substring('RIDE_LOGGER_ENTRY:'.length).trim()); }
    else { addLog('INFO', message); }
};
