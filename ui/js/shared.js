// shared.js — ES Module
/* global Plotly */

// --- WebSocket ---
export const socket = new WebSocket('ws://' + window.location.host);

// --- Mutowalne dane (state object) ---
export const state = {
    // Display
    displayData1: null,
    displayData2: null,
    displayRealtime: null,
    displayErrors: null,
    displayShutdownTime: null,
    displayOtherInfo: { hwVersion: null, swVersion: null, modelNumber: null, bootloaderVersion: null, serialNumber: null, productionDate: null, manufacturer: null, customerNumber: null },
    // Sensor
    sensorRealtime: null,
    sensorOtherInfo: { hwVersion: null, swVersion: null, modelNumber: null, serialNumber: null, productionDate: null },
    // Battery
    batteryCapacity: null,
    batteryState: null,
    batteryCells: {},
    batteryDesign: null,
    batteryChargingInfo: null,
    batteryCellsStats: null,
    batteryOtherInfo: { hwVersion: null, swVersion: null, modelNumber: null, serialNumber: null, productionDate: null },
    // Controller
    controllerRealtime0: null,
    controllerRealtime1: null,
    controllerState: null,
    controllerErrors: null,
    controllerParams0: null,
    controllerParams1: null,
    controllerParams2: null,
    controllerSpeedParams: null,
    controllerOtherInfo: { hwVersion: null, swVersion: null, modelNumber: null, serialNumber: null, productionDate: null, manufacturer: null },
    lastControllerP0: null,
    lastControllerP1: null,
    lastControllerP2: null,
    lastControllerP1Read: null,
    lastControllerP2Read: null,
    lastStartupAngle: null,
    rawParamData: {},
    allEventsStore: {},
    // Connection
    isCanConnected: false,
    isCanDeviceFound: false,
    currentCanDeviceName: null,
    // Debug tab local state
    currentRawParamType: null,
};

// --- Stałe ---
export const START_PULSE_MIN = 1;
export const START_PULSE_MAX = 48; // Based on original input constraints

// --- Chart instances (initialize to null) ---
export let pasChart = null;
export let startRampChart = null;
export let pasChartM820 = null;
export let startRampChartM820 = null;

// --- Constants for Charting ---
export const MAX_HUMAN_POWER_X_AXIS = 300;
export const MAX_MOTOR_POWER_Y_AXIS_DEFAULT_SCALE = 550;
export const MAX_TIME_X_AXIS_START_RAMP = 3000;
export const EFFICIENCY_FACTOR = 0.78;

export const PAS_LEVEL_COLORS = ['#808080', '#FF0000', '#FFA500', '#FFFF00', '#008000', '#0000FF', '#4B0082', '#EE82EE', '#A52A2A'];

// --- Checksum Elements ---
export const checksumElements = {
    ctrlP1ChecksumWarning: document.getElementById('ctrlP1ChecksumWarning'),
    ctrlP1ChecksumFixButton: document.getElementById('ctrlP1ChecksumFixButton'),
    gearsP2ChecksumWarning: document.getElementById('gearsP2ChecksumWarning'),
    gearsP2ChecksumFixButton: document.getElementById('gearsP2ChecksumFixButton'),
};

// --- Display Tab Specific Elements ---
export const displayElements = {
    totalMileageValue: document.getElementById('displayTotalMileageValue'),
    totalMileageInput: document.getElementById('displayTotalMileageInput'),
    singleMileageValue: document.getElementById('displaySingleMileageValue'),
    singleMileageInput: document.getElementById('displaySingleMileageInput'),
    maxSpeedValue: document.getElementById('displayMaxSpeedValue'),
    averageSpeedValue: document.getElementById('displayAverageSpeedValue'),
    serviceMileageValue: document.getElementById('displayServiceMileageValue'),
    clearServiceButton: document.getElementById('displayClearServiceButton'),
    setTimeButton: document.getElementById('displaySetTimeButton'),
    assistLevelsValue: document.getElementById('displayAssistLevelsValue'),
    modeValue: document.getElementById('displayModeValue'),
    boostValue: document.getElementById('displayBoostValue'),
    currentAssistValue: document.getElementById('displayCurrentAssistValue'),
    lightValue: document.getElementById('displayLightValue'),
    upButtonValue: document.getElementById('displayUpButtonValue'),
    downButtonValue: document.getElementById('displayDownButtonValue'),
    errorTableBody: document.getElementById('displayErrorTableBody'),
    displayShutdownTimeValue: document.getElementById('displayShutdownTimeValue'),
    syncButton: document.getElementById('displaySyncButton'),
    saveButton: document.getElementById('displaySaveButton'),
    displayClearErrorsButton: document.getElementById('displayClearErrorsButton'),
};

export const sensorElements = {
    syncButton: document.getElementById('sensorSyncButton'),
    realtimePlaceholder: document.getElementById('sensorRealtimePlaceholder'),
    sensorTorqueValue: document.getElementById('sensorTorqueValue'),
    sensorCadenceValue: document.getElementById('sensorCadenceValue'),
};

export const batteryElements = {
    syncButton: document.getElementById('batterySyncButton'),
    cellVoltageTableBody: document.getElementById('batteryCellVoltageTableBody'),
    fullCapacityValue: document.getElementById('batteryFullCapacityValue'),
    capacityLeftValue: document.getElementById('batteryCapacityLeftValue'),
    rsocValue: document.getElementById('batteryRsocValue'),
    asocValue: document.getElementById('batteryAsocValue'),
    sohValue: document.getElementById('batterySohValue'),
    voltageValue: document.getElementById('batteryVoltageValue'),
    currentValue: document.getElementById('batteryCurrentValue'),
    tempValue: document.getElementById('batteryTempValue'),
    cellsPlaceholder: document.getElementById('batteryCellsPlaceholder'),
    capacityPlaceholder: document.getElementById('batteryCapacityPlaceholder'),
    statePlaceholder: document.getElementById('batteryStatePlaceholder'),
    chargingInfoPlaceholder: document.getElementById('batteryChargingInfoPlaceholder'),
    designPlaceholder: document.getElementById('batteryDesignPlaceholder'),
    totalCellsInSerieValue: document.getElementById('batteryTotalCellsInSerieValue'),
    totalSeriesParallelValue: document.getElementById('batteryTotalSeriesParallelValue'),
    capacityValue: document.getElementById('batteryCapacityValue'),
    chargeCyclesValue: document.getElementById('batteryChargeCyclesValue'),
    maxUnchargedTimeValue: document.getElementById('batteryMaxUnchargedTimeValue'),
    lastUnchargedTimeValue: document.getElementById('batteryLastUnchargedTimeValue'),
    cellMinVoltageValue: document.getElementById('batteryCellMinVoltageValue'),
    cellMaxVoltageValue: document.getElementById('batteryCellMaxVoltageValue'),
    cellDiffVoltageValue: document.getElementById('batteryCellDiffVoltageValue'),
};

export const gearsElements = {
    syncButton: document.getElementById('gearsSyncButton'),
    saveButton: document.getElementById('gearsSaveButton'),
    controllerStartupAngleValueEl: document.getElementById('controllerStartupAngleValue'),
    controllerStartupAngleInputEl: document.getElementById('controllerStartupAngleInput'),
    startupAnglePlaceholderEl: document.getElementById('startupAnglePlaceholder'),
    assistLevelTableBody: document.getElementById('assistLevelTableBody'),
    torqueProfileTableBody: document.getElementById('torqueProfileTableBody'),
    assistLevelPlaceholder: document.getElementById('assistLevelPlaceholder'),
    torqueProfilePlaceholder: document.getElementById('torqueProfilePlaceholder'),
    autoCorrectionCheckbox: document.getElementById('autoCorrectionCheckbox'),
};

export const gearsElementsM820 = {
    syncButton: document.getElementById('gearsSyncButtonM820'),
    saveButton: document.getElementById('gearsSaveButtonM820'),
    controllerStartupAngleValueEl: document.getElementById('controllerStartupAngleValueM820'),
    controllerStartupAngleInputEl: document.getElementById('controllerStartupAngleInputM820'),
    globalAccelerationValueEl: document.getElementById('globalAccelerationValueM820'),
    globalAccelerationInputEl: document.getElementById('globalAccelerationInputM820'),
    startupAnglePlaceholderEl: document.getElementById('startupAnglePlaceholderM820'),
    assistLevelTableBody: document.getElementById('assistLevelTableBodyM820'),
    torqueProfileTableBody: document.getElementById('torqueProfileTableBodyM820'),
    assistLevelPlaceholder: document.getElementById('assistLevelPlaceholderM820'),
    torqueProfilePlaceholder: document.getElementById('torqueProfilePlaceholderM820'),
};

export const debugElements = {
    canIdInput: document.getElementById('canIdInput'),
    canDataInput: document.getElementById('canDataInput'),
    sendCustomFrameButton: document.getElementById('sendCustomFrame'),
    decodeCustomFrameButton: document.getElementById('decodeCustomFrame'),
    canIdInputInterval: document.getElementById('canIdInputInterval'),
    canDataInputInterval: document.getElementById('canDataInputInterval'),
    secondsInterval: document.getElementById('secondsInterval'),
    startCustomFrameInterval: document.getElementById('startCustomFrameInterval'),
    stopCustomFrameInterval: document.getElementById('stopCustomFrameInterval'),
    logArea: document.getElementById('log'),
    clearLogButton: document.getElementById('clearLogButton'),
    rawParamSelect: document.getElementById('rawParamSelect'),
    rawParamSyncButton: document.getElementById('rawParamSyncButton'),
    rawParamSaveButton: document.getElementById('rawParamSaveButton'),
    hexEditorTableBody: document.getElementById('hexEditorTableBody'),
    hexEditorPlaceholder: document.getElementById('hexEditorPlaceholder'),
    rawDestSelect: document.getElementById('rawDestSelect'),
    rawParamCodeInput: document.getElementById('rawParamCodeInput'),
    rawParamSubCodeInput: document.getElementById('rawParamSubCodeInput'),
    rawParamCustomSyncButton: document.getElementById('rawParamCustomSyncButton'),
    rawParamCustomSaveButton: document.getElementById('rawParamCustomSaveButton'),
    rawParamCustomSyncIntervalStartButton: document.getElementById('rawParamCustomSyncIntervalStartButton'),
    rawParamCustomSyncIntervalStopButton: document.getElementById('rawParamCustomSyncIntervalStopButton'),
};

export const controllerElements = {
    syncButton: document.getElementById('controllerSyncButton'),
    saveButton: document.getElementById('controllerSaveButton'),
    // State
    stateNumberValue: document.getElementById('ctrlStateNumberValue'),
    // Realtime 0
    rt0RemainCapValue: document.getElementById('ctrlRt0RemainCapValue'),
    rt0RemainDistValue: document.getElementById('ctrlRt0RemainDistValue'),
    rt0SingleTripValue: document.getElementById('ctrlRt0SingleTripValue'),
    rt0CadenceValue: document.getElementById('ctrlRt0CadenceValue'),
    rt0TorqueValue: document.getElementById('ctrlRt0TorqueValue'),
    // Realtime 1
    rt1VoltageValue: document.getElementById('ctrlRt1VoltageValue'),
    rt1TempValue: document.getElementById('ctrlRt1TempValue'),
    rt1MotorTempValue: document.getElementById('ctrlRt1MotorTempValue'),
    rt1CurrentValue: document.getElementById('ctrlRt1CurrentValue'),
    rt1SpeedValue: document.getElementById('ctrlRt1SpeedValue'),
    rtPlaceholder: document.getElementById('ctrlRtPlaceholder'),
    // Electric P1
    p1SysVoltageSelect: document.getElementById('ctrlP1SysVoltageSelect'),
    p1SysVoltageRawValue: document.getElementById('ctrlP1SysVoltageRawValue'),
    p1CurrentLimitValue: document.getElementById('ctrlP1CurrentLimitValue'),
    p1CurrentLimitInput: document.getElementById('ctrlP1CurrentLimitInput'),
    p1MaxCurrentLowChargeValue: document.getElementById('ctrlP1MaxCurrentLowChargeValue'),
    p1MaxCurrentLowChargeInput: document.getElementById('ctrlP1MaxCurrentLowChargeInput'),
    p1OverVoltageValue: document.getElementById('ctrlP1OverVoltageValue'),
    p1OverVoltageInput: document.getElementById('ctrlP1OverVoltageInput'),
    p1UnderVoltageLoadValue: document.getElementById('ctrlP1UnderVoltageLoadValue'),
    p1UnderVoltageLoadInput: document.getElementById('ctrlP1UnderVoltageLoadInput'),
    p1UnderVoltageIdleValue: document.getElementById('ctrlP1UnderVoltageIdleValue'),
    p1UnderVoltageIdleInput: document.getElementById('ctrlP1UnderVoltageIdleInput'),
    electricPlaceholder: document.getElementById('ctrlElectricPlaceholder'),
    // Battery P1
    p1BattCapacityValue: document.getElementById('ctrlP1BattCapacityValue'),
    p1BattCapacityInput: document.getElementById('ctrlP1BattCapacityInput'),
    p1LimpModeSocValue: document.getElementById('ctrlP1LimpModeSocValue'),
    p1LimpModeSocInput: document.getElementById('ctrlP1LimpModeSocInput'),
    p1FullRangeValue: document.getElementById('ctrlP1FullRangeValue'),
    p1FullRangeInput: document.getElementById('ctrlP1FullRangeInput'),
    batteryPlaceholder: document.getElementById('ctrlBatteryPlaceholder'),
    // Speed P1
    p1SpeedLimitEnabledValue: document.getElementById('ctrlP1SpeedLimitEnabledValue'),
    p1SpeedLimitEnabledInput: document.getElementById('ctrlP1SpeedLimitEnabledInput'),
    // Mechanical P1
    p1GearRatioValue: document.getElementById('ctrlP1GearRatioValue'),
    p1GearRatioInput: document.getElementById('ctrlP1GearRatioInput'),
    p1CoasterBrakeValue: document.getElementById('ctrlP1CoasterBrakeValue'),
    p1CoasterBrakeInput: document.getElementById('ctrlP1CoasterBrakeInput'),
    p1MaxRpmValue: document.getElementById('ctrlP1MaxRpmValue'),
    p1MaxRpmInput: document.getElementById('ctrlP1MaxRpmInput'),
    p1CadenceSignalsValue: document.getElementById('ctrlP1CadenceSignalsValue'),
    p1CadenceSignalsInput: document.getElementById('ctrlP1CadenceSignalsInput'),
    p1MotorTypeValue: document.getElementById('ctrlP1MotorTypeValue'),
    p1MotorTypeInput: document.getElementById('ctrlP1MotorTypeInput'),
    p1PolePairNumberValue: document.getElementById('ctrlP1PolePairNumberValue'),
    p1PolePairNumberInput: document.getElementById('ctrlP1PolePairNumberInput'),
    p1SpeedMagnetsValue: document.getElementById('ctrlP1SpeedMagnetsValue'),
    p1SpeedMagnetsInput: document.getElementById('ctrlP1SpeedMagnetsInput'),
    p1TempSensorValue: document.getElementById('ctrlP1TempSensorValue'),
    p1TempSensorInput: document.getElementById('ctrlP1TempSensorInput'),
    p1LampsOnValue: document.getElementById('ctrlP1LampsOnValue'),
    p1LampsOnInput: document.getElementById('ctrlP1LampsOnInput'),
    mechPlaceholder: document.getElementById('ctrlMechPlaceholder'),
    // Driving P1
    p1StartCurrentValue: document.getElementById('ctrlP1StartCurrentValue'),
    p1StartCurrentInput: document.getElementById('ctrlP1StartCurrentInput'),
    p1CurrentLoadTimeValue: document.getElementById('ctrlP1CurrentLoadTimeValue'),
    p1CurrentLoadTimeInput: document.getElementById('ctrlP1CurrentLoadTimeInput'),
    p1CurrentShedTimeValue: document.getElementById('ctrlP1CurrentShedTimeValue'),
    p1CurrentShedTimeInput: document.getElementById('ctrlP1CurrentShedTimeInput'),
    p1PedalTypeValue: document.getElementById('ctrlP1PedalTypeValue'),
    p1PedalTypeInput: document.getElementById('ctrlP1PedalTypeInput'),
    drivingPlaceholder: document.getElementById('ctrlDrivingPlaceholder'),
    // Throttle P1
    p1ThrottleStartValue: document.getElementById('ctrlP1ThrottleStartValue'),
    p1ThrottleStartInput: document.getElementById('ctrlP1ThrottleStartInput'),
    p1ThrottleEndValue: document.getElementById('ctrlP1ThrottleEndValue'),
    p1ThrottleEndInput: document.getElementById('ctrlP1ThrottleEndInput'),
    throttlePlaceholder: document.getElementById('ctrlThrottlePlaceholder'),
    // Speed Params (P3)
    p3SpeedLimitValue: document.getElementById('ctrlP3SpeedLimitValue'),
    p3SpeedLimitInput: document.getElementById('ctrlP3SpeedLimitInput'),
    p3WheelDiameterValue: document.getElementById('ctrlP3WheelDiameterValue'),
    p3WheelDiameterInput: document.getElementById('ctrlP3WheelDiameterInput'),
    p3CircumferenceValue: document.getElementById('ctrlP3CircumferenceValue'),
    p3CircumferenceInput: document.getElementById('ctrlP3CircumferenceInput'),
    p1WalkAssistSpeedValue: document.getElementById('ctrlP1WalkAssistSpeedValue'),
    p1WalkAssistSpeedInput: document.getElementById('ctrlP1WalkAssistSpeedInput'),
    speedPlaceholder: document.getElementById('ctrlSpeedPlaceholder'),
    // Calibration
    calibratePositionButton: document.getElementById('ctrlCalibratePositionButton'),
    calibrateTorqueButton: document.getElementById('ctrlCalibrateTorqueButton'),
    // Errors
    errorTableBody: document.getElementById('controllerErrorTableBody'),
    controllerClearErrorsButton: document.getElementById('controllerClearErrorsButton'),
};

// Selectors for Info Tab
export const infoElements = {
    syncButton: document.getElementById('infoSyncButton'),
    saveButton: document.getElementById('infoSaveButton'),
    // Controller Info
    ctrlHwVersionValue: document.getElementById('infoCtrlHwVersionValue'),
    ctrlSwVersionValue: document.getElementById('infoCtrlSwVersionValue'),
    ctrlModelNumberValue: document.getElementById('infoCtrlModelNumberValue'),
    ctrlSnValue: document.getElementById('infoCtrlSnValue'),
    ctrlProductionDateValue: document.getElementById('infoCtrlProductionDateValue'),
    ctrlMfgValue: document.getElementById('infoCtrlMfgValue'),
    ctrlMfgInput: document.getElementById('infoCtrlMfgInput'),
    ctrlPlaceholder: document.getElementById('infoCtrlPlaceholder'),
    // Display Info
    displayHwVersionValue: document.getElementById('infoDisplayHwVersionValue'),
    displaySwVersionValue: document.getElementById('infoDisplaySwVersionValue'),
    displayModelNumberValue: document.getElementById('infoDisplayModelNumberValue'),
    displayBootloaderVersionValue: document.getElementById('infoDisplayBootloaderVersionValue'),
    displaySnValue: document.getElementById('infoDisplaySnValue'),
    displayProductionDateValue: document.getElementById('infoDisplayProductionDateValue'),
    displayMfgValue: document.getElementById('infoDisplayMfgValue'),
    displayMfgInput: document.getElementById('infoDisplayMfgInput'),
    displayCnValue: document.getElementById('infoDisplayCnValue'),
    displayCnInput: document.getElementById('infoDisplayCnInput'),
    displayPlaceholder: document.getElementById('infoDisplayPlaceholder'),
    // Sensor Info
    sensorHwVersionValue: document.getElementById('infoSensorHwVersionValue'),
    sensorSwVersionValue: document.getElementById('infoSensorSwVersionValue'),
    sensorModelNumberValue: document.getElementById('infoSensorModelNumberValue'),
    sensorSnValue: document.getElementById('infoSensorSnValue'),
    sensorProductionDateValue: document.getElementById('infoSensorProductionDateValue'),
    sensorPlaceholder: document.getElementById('infoSensorPlaceholder'),
    // Battery Info
    batteryHwVersionValue: document.getElementById('infoBatteryHwVersionValue'),
    batterySwVersionValue: document.getElementById('infoBatterySwVersionValue'),
    batteryModelNumberValue: document.getElementById('infoBatteryModelNumberValue'),
    batterySnValue: document.getElementById('infoBatterySnValue'),
    batteryProductionDateValue: document.getElementById('infoBatteryProductionDateValue'),
    batteryPlaceholder: document.getElementById('infoBatteryPlaceholder'),
};

export const fwUpdateElements = {
    fileInput: document.getElementById('fwUpdateFileInput'),
    startButton: document.getElementById('fwUpdateStartButton'),
    progressValue: document.getElementById('fwUpdateProgressValue'),
    logArea: document.getElementById('fwUpdatelog'),
    clearButton: document.getElementById('clearFwUpdateLogButton'),
    modeSelect: document.getElementById('fwUpdateModeSelect'),
    delayInput: document.getElementById('fwUpdateDelayUsInput'),
};

export const snifferElements = {
    startButton: document.getElementById('snifferStartButton'),
    stopButton: document.getElementById('snifferStopButton'),
    logArea: document.getElementById('snifferLog'),
    clearButton: document.getElementById('clearSnifferLogButton'),
    newFilteredIdInput: document.getElementById('newFilteredIdInput'),
    addFilteredIdButton: document.getElementById('addFilteredIdButton'),
    filteredIdsListOff: document.getElementById('filteredIdsListOff'),
    filteredIdsListOn: document.getElementById('filteredIdsListOn'),
    snifferLogToFileCheckbox: document.getElementById('snifferLogToFileCheckbox'),
    zones: document.querySelectorAll('.drop-zone'),
};

export const rideLoggerElements = {
    startButton: document.getElementById('rideLoggerStartButton'),
    stopButton: document.getElementById('rideLoggerStopButton'),
    clearButton: document.getElementById('rideLoggerClearButton'),
    logToFileCheckbox: document.getElementById('rideLoggerLogToFileCheckbox'),
    liveViewCheckbox: document.getElementById('rideLoggerLiveDashboardCheckbox'),
    refreshRateMsInput: document.getElementById('rideLoggerRefreshRateMsInput'),
    liveStats: document.getElementById('rideLoggerLiveStats'),
    fullscreenButton: document.getElementById('rideLoggerFullscreenButton'),
};

export const backupElements = {
    createBackupButton: document.getElementById('createBackupButton'),
    restoreBackupInput: document.getElementById('restoreBackupInput'),
    restoreBackupButton: document.getElementById('restoreBackupButton'),
};

// --- Global DOM references ---
export const statusIndicator = document.getElementById('statusIndicator');
export const statusText = document.getElementById('statusText');
export const log = document.getElementById('log');
export const allControls = document.querySelectorAll('button, input, textarea');
export const clearLogButton = document.getElementById('clearLogButton');
export const tabButtons = document.querySelectorAll('.tab-button');
export const tabContents = document.querySelectorAll('.tab-content');
export const connectCanButton = document.getElementById('connectCanButton');
export const canDeviceNameElement = document.getElementById('canDeviceName');

// --- Chart container element references ---
export const pasCurvesPlaceholder = document.getElementById('pasCurvesPlaceholder');
export const pasCurvesContainer = document.getElementById('pasCurvesContainer');
export const startRampPlaceholder = document.getElementById('startRampPlaceholder');
export const startRampContainer = document.getElementById('startRampContainer');
export const pasCurvesPlaceholderM820 = document.getElementById('pasCurvesPlaceholderM820');
export const pasCurvesContainerM820 = document.getElementById('pasCurvesContainerM820');
export const startRampPlaceholderM820 = document.getElementById('startRampPlaceholderM820');
export const startRampContainerM820 = document.getElementById('startRampContainerM820');

// --- Error descriptions ---
export const errorDescriptions = {
    '1':    "Throttle fault",
    '2':    "Brake sensor malfunction",
    '3':    "Brake Fault",
    '4':    "Throttle not in correct position",
    '7':    "Over voltage protection",
    '8':    "Hall sensor error",
    '9':    "Motor phase winding fault",
    '10':   "Motor overtemperature",
    '11':   "Motor temperature sensor fault",
    '12':   "Motor overcurrent",
    '13':   "Battery temperature sensor fault",
    '14':   "Controller overtemperature",
    '15':   "Controller temperature sensor fault",
    '21':   "Speed sensor error",
    '25':   "Torque signal fault",
    '26':   "Torque sensor speed signal fault",
    '27':   "Controller overcurrent",
    '30':   "Communication failed",
    '33':   "Brake detection circuit fault",
    '35':   "15V detection circuit error",
    '36':   "Keypad detection circuit error",
    '37':   "WDT circuit fault Controller",
    '41':   "Total voltage from the battery is too high.",
    '42':   "Total voltage from the battery is too low.",
    '43':   "Total power from the battery cells is too high.",
    '45':   "Temperature from the battery is too high.",
    '46':   "The temperature of the battery is too low.",
    '47':   "SOC of the battery is too high.",
    '48':   "SOC of the battery is too low.",
    '61':   "Switching detection defect.",
    '62':   "Electronic derailleur cannot release.",
    '71':   "Electronic lock is jammed.",
    '81':   "Bluetooth module has an error.",
};

export const errorRecommendations = {
    '1':    "Inspect the wire from the throttle to the controller for cuts or kinks",
    '2':    "Look for pinched, cut, or damaged cables leading from the brake levers to the main wiring harness",
    '3':    "Brake sensor is active or stuck; check brake levers",
    '4':    "Check and adjust throttle position, inspect wiring, replace throttle if needed",
    '7':    "Check battery and charger compatibility, inspect battery, discharge if overcharged",
    '8':    "Check hall sensor connections, inspect for damage, replace if necessary",
    '9':    "Check motor connections, inspect for damage, test with a different controller",
    '10':   "Allow motor to cool down, reduce load, ensure proper ventilation",
    '11':   "Check sensor connection, inspect for damage, replace if necessary",
    '12':   "Reduce load, check wiring, inspect motor and controller",
    '13':   "Check sensor connection, inspect for damage, replace if necessary",
    '14':   "Allow controller to cool down, reduce load, ensure proper ventilation",
    '15':   "Check sensor connection, inspect for damage, replace if necessary",
    '21':   "Check sensor connection, inspect for damage, realign magnets",
    '25':   "Check sensor connection, inspect for damage, replace if necessary",
    '26':   "Check sensor connection, inspect for damage, replace if necessary",
    '27':   "Reduce load, check wiring, inspect motor and controller",
    '30':   "Check connections, update firmware, replace faulty components",
    '33':   "Check sensor connection, inspect wiring, replace sensor if needed",
    '35':   "Check power supply and connections, replace damaged components",
    '36':   "Check keypad connection, inspect wiring, replace keypad if needed",
    '37':   "Consult a professional for diagnosis and repair",
    '41':   "Check battery",
    '42':   "Check battery",
    '43':   "Check battery",
    '45':   "Check battery",
    '46':   "Check battery",
    '47':   "Check battery",
    '48':   "Check battery",
    '61':   "-",
    '62':   "-",
    '71':   "-",
    '81':   "-",
};

export const wheelDiameterTable = [
    { text: '6″', minimalCircumference: 400, maximalCircumference: 880, code: [0x60, 0x00] },
    { text: '7″', minimalCircumference: 520, maximalCircumference: 880, code: [0x70, 0x00] },
    { text: '8″', minimalCircumference: 520, maximalCircumference: 880, code: [0x80, 0x00] },
    { text: '10″', minimalCircumference: 520, maximalCircumference: 880, code: [0xa0, 0x00] },
    { text: '12″', minimalCircumference: 910, maximalCircumference: 1300, code: [0xc0, 0x00] },
    { text: '14″', minimalCircumference: 910, maximalCircumference: 1300, code: [0xe0, 0x00] },
    { text: '16″', minimalCircumference: 1208, maximalCircumference: 1600, code: [0x00, 0x01] },
    { text: '17″', minimalCircumference: 1208, maximalCircumference: 1600, code: [0x10, 0x01] },
    { text: '18″', minimalCircumference: 1208, maximalCircumference: 1600, code: [0x10, 0x01] },
    { text: '20″', minimalCircumference: 1290, maximalCircumference: 1880, code: [0x40, 0x01] },
    { text: '22″', minimalCircumference: 1290, maximalCircumference: 1880, code: [0x60, 0x01] },
    { text: '23″', minimalCircumference: 1290, maximalCircumference: 1880, code: [0x70, 0x01] },
    { text: '24″', minimalCircumference: 1290, maximalCircumference: 2200, code: [0x80, 0x01] },
    { text: '25″', minimalCircumference: 1880, maximalCircumference: 2200, code: [0x90, 0x01] },
    { text: '26″', minimalCircumference: 1880, maximalCircumference: 2510, code: [0xa0, 0x01] },
    { text: '27″', minimalCircumference: 1880, maximalCircumference: 2510, code: [0xb0, 0x01] },
    { text: '27.5″', minimalCircumference: 1880, maximalCircumference: 2510, code: [0xb5, 0x01] },
    { text: '28″', minimalCircumference: 1880, maximalCircumference: 2510, code: [0xc0, 0x01] },
    { text: '29″', minimalCircumference: 1880, maximalCircumference: 2510, code: [0xd0, 0x01] },
    { text: '32″', minimalCircumference: 2200, maximalCircumference: 2652, code: [0x00, 0x02] },
    { text: '400 mm', minimalCircumference: 1208, maximalCircumference: 1600, code: [0x00, 0x19] },
    { text: '450 mm', minimalCircumference: 1208, maximalCircumference: 1600, code: [0x10, 0x2c] },
    { text: '600 mm', minimalCircumference: 1600, maximalCircumference: 2200, code: [0x80, 0x25] },
    { text: '650 mm', minimalCircumference: 1600, maximalCircumference: 2200, code: [0xa0, 0x28] },
    { text: '700 mm', minimalCircumference: 1880, maximalCircumference: 2510, code: [0xc0, 0x2b] },
];

export const rawParamFieldMappings = {
    controller_params_0: {
        byteLength: 64,
        fields: [
            { index: 0, length: 1, name: 'par0_value_offset_0' },
            ...Array.from({ length: 9 }, (_, i) => ({ index: 1 + i, length: 1, name: `acceleration_levels[${i}].acceleration_level` })),
            ...Array.from({ length: 9 }, (_, i) => ({ index: 10 + (i * 2), length: 2, name: `assist_ratio_levels[${i}].assist_ratio` })),
            { index: 28, length: 2, name: 'assist_ratio_upper_limit' },
            { index: 30, length: 32, name: 'unknown_bytes' },
            { index: 63, length: 1, name: 'checksum' },
        ],
    },
    controller_params_1: {
        byteLength: 64,
        fields: [
            { index: 0, length: 1, name: 'system_voltage' },
            { index: 1, length: 1, name: 'current_limit' },
            { index: 2, length: 1, name: 'overvoltage' },
            { index: 3, length: 1, name: 'undervoltage' },
            { index: 4, length: 1, name: 'undervoltage_under_load' },
            { index: 5, length: 1, name: 'battery_recovery_voltage' },
            { index: 6, length: 1, name: 'par1_value_offset_6' },
            { index: 7, length: 2, name: 'battery_capacity (LE)' },
            { index: 9, length: 1, name: 'max_current_on_low_charge' },
            { index: 10, length: 1, name: 'limp_mode_soc_limit' },
            { index: 11, length: 1, name: 'limp_mode_soc_limit stage 2 ' },
            { index: 12, length: 1, name: 'full capacity mileage display' },
            { index: 13, length: 1, name: 'pedal_sensor_type' },
            { index: 14, length: 1, name: 'coaster_brake (0/1)' },
            { index: 15, length: 1, name: 'pedal_sensor_signals_per_rotation' },
            { index: 16, length: 1, name: 'speed_sensor_channel_number' },
            { index: 17, length: 1, name: 'check teeth for heel torque' },
            { index: 18, length: 1, name: 'motor_type' },
            { index: 19, length: 1, name: 'motor_pole_pair_number' },
            { index: 20, length: 1, name: 'speedmeter_magnets_number' },
            { index: 21, length: 1, name: 'temperature_sensor_type' },
            { index: 22, length: 2, name: 'deaceleration_ratio (x100, LE)' },
            { index: 24, length: 2, name: 'motor_max_rotor_rpm (LE)' },
            { index: 26, length: 2, name: 'D-axis  inductance uH (LE)' },
            { index: 28, length: 2, name: 'Q-axis  inductance uH(LE)' },
            { index: 30, length: 2, name: 'Phase resistance mΩ (LE)' },
            { index: 32, length: 2, name: 'Reverse potential coefficient 0.001V/RPM (LE)' },
            { index: 34, length: 1, name: 'throttle_start_voltage (x10)' },
            { index: 35, length: 1, name: 'throttle_max_voltage (x10)' },
            { index: 36, length: 1, name: 'speed_limit_enabled' },
            { index: 37, length: 1, name: 'start_current (%)' },
            ...Array.from({ length: 9 }, (_, i) => ({ index: 40 + i, length: 1, name: `assist_levels[${i}].current_limit` })),
            ...Array.from({ length: 9 }, (_, i) => ({ index: 49 + i, length: 1, name: `assist_levels[${i}].speed_limit` })),
            { index: 58, length: 1, name: 'displayless_mode (0/1)' },
            { index: 59, length: 1, name: 'lamps_always_on (0/1)' },
            { index: 60, length: 2, name: 'walk_assist_speed (x100 Km/H, LE)' },
            { index: 63, length: 1, name: 'checksum' },
        ],
    },
    controller_params_2: {
        byteLength: 64,
        fields: [
            { index: 0, length: 1, name: 'torque_profiles[0].start_torque_value' },
            { index: 6, length: 1, name: 'torque_profiles[0].max_torque_value' },
            ...Array.from({ length: 6 }, (_, i) => ({ index: 0 + i, length: 1, name: `TP[${i}].StartTorque` })),
            ...Array.from({ length: 6 }, (_, i) => ({ index: 6 + i, length: 1, name: `TP[${i}].MaxTorque` })),
            ...Array.from({ length: 6 }, (_, i) => ({ index: 12 + i, length: 1, name: `TP[${i}].ReturnTorque` })),
            ...Array.from({ length: 6 }, (_, i) => ({ index: 18 + i, length: 1, name: `TP[${i}].MaxCurrent` })),
            ...Array.from({ length: 6 }, (_, i) => ({ index: 24 + i, length: 1, name: `TP[${i}].MinCurrent` })),
            { index: 30, length: 6, name: 'unknown_bytes' },
            ...Array.from({ length: 6 }, (_, i) => ({ index: 36 + i, length: 1, name: `TP[${i}].StartPulse` })),
            ...Array.from({ length: 6 }, (_, i) => ({ index: 42 + i, length: 1, name: `TP[${i}].DecayTime (x5ms)` })),
            ...Array.from({ length: 6 }, (_, i) => ({ index: 48 + i, length: 1, name: `TP[${i}].StopDelay (x2ms)` })),
            { index: 54, length: 1, name: 'acceleration_level' },
            { index: 55, length: 1, name: 'motor overheating temperature?' },
            { index: 56, length: 1, name: 'temperature?' },
            { index: 63, length: 1, name: 'checksum' },
        ],
    },
    controller_speed_params: {
        byteLength: 6,
        fields: [
            { index: 0, length: 2, name: 'speed_limit (x100 Km/H, LE)' },
            { index: 2, length: 1, name: 'wheel_diameter_code[0]' },
            { index: 3, length: 1, name: 'wheel_diameter_code[1]' },
            { index: 4, length: 2, name: 'circumference (mm, LE)' },
        ],
    },
    controller_params_6017: {
        byteLength: 64,
        fields: [
            { index: 0, length: 48, name: 'unknown_bytes_0_47' },
            { index: 48, length: 1, name: 'Current loading initial value', unit: 'ms' },
            { index: 49, length: 1, name: 'Current loading and cadence K1', unit: 'ms' },
            { index: 50, length: 1, name: 'Current loading and cadence K2', unit: 'ms' },
            { index: 51, length: 1, name: 'Current loading and cadence k3', unit: 'ms' },
            { index: 52, length: 1, name: 'Current loading and cadence K4', unit: 'ms' },
            { index: 53, length: 1, name: 'Constant torque start value', unit: 'mV', notes: 'Cmd 6017, Byte 53' },
            { index: 54, length: 2, name: 'Torque start and cadence K5 (LE)', unit: 'mV' },
            { index: 56, length: 2, name: 'Minimum torque constant (LE)', unit: 'mV' },
            { index: 58, length: 2, name: 'Minimum torque and cadence K6 (LE)' },
            { index: 60, length: 2, name: 'Magnification of the couple (LE)' },
            { index: 62, length: 1, name: 'unknown_byte_62' },
            { index: 63, length: 1, name: 'checksum' },
        ],
    },
    controller_params_6018: {
        byteLength: 64,
        fields: [
            { index: 0, length: 2, name: 'Speed/Current Limit 1 Total Battery Capacity (LE)', unit: '0.1Ah' },
            { index: 2, length: 2, name: 'Speed/Current Limit 2 Total Battery Capacity (LE)', unit: '0.1Ah' },
            { index: 4, length: 2, name: 'Speed Limit 1 (LE)', unit: '0.1Km/h' },
            { index: 6, length: 2, name: 'Current Limit 1 (LE)', unit: '0.1A' },
            { index: 8, length: 2, name: 'Speed Limit 2 (LE)', unit: '0.1Km/h' },
            { index: 10, length: 2, name: 'Current Limit 2 (LE)', unit: '0.1A' },
            { index: 12, length: 51, name: 'padding_bytes_12_62' },
            { index: 63, length: 1, name: 'checksum' },
        ],
    },
};

// --- Assist Level Mapping ---
export const assistLevelMap = {
    3: { 0: 0, 12: 1, 2: 2, 3: 3, 6: 'walk' },
    5: { 0: 0, 11: 1, 13: 2, 21: 3, 23: 4, 3: 5, 6: 'walk' },
    9: { 0: 0, 1: 1, 11: 2, 12: 3, 13: 4, 2: 5, 21: 6, 22: 7, 23: 8, 3: 9, 6: 'walk' },
};

export const uiToInternalAssistMap = {
    3: { 1: 2, 2: 4, 3: 8 },
    5: { 1: 1, 2: 3, 3: 5, 4: 7, 5: 8 },
    9: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8 },
};

export const na = "N/A";

// --- Utility Functions ---

export async function waitFor(predicate, delayMs = 1000, interval = 50) {
    const startTime = Date.now();
    while (Date.now() - startTime < delayMs) {
        if (predicate()) return true;
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    return false;
}

export function autoPopup(text, color = '#333') {
    const el = document.createElement("div");
    el.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background-color: ${color};
        color: white;
        padding: 12px 25px;
        border-radius: 8px;
        font-family: sans-serif;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.3s ease;
    `;
    el.innerText = text;
    document.body.appendChild(el);
    setTimeout(() => el.style.opacity = "1", 10);
    setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 300);
    }, 5000);
}

export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getProductionDateFromSerial(serialNumber) {
    if (!serialNumber) return 'Unknown';
    serialNumber = serialNumber.replace(/\s/g, '');
    let dateCode = serialNumber.substring(serialNumber.length - 8, serialNumber.length - 4);
    let y = dateCode[0].charCodeAt(0) - 65 + 2000;
    let m = isNaN(dateCode[1]) ? dateCode[1].charCodeAt(0) - 65 + 10 : parseInt(dateCode[1]);
    return `${y}-${String(m).padStart(2, '0')}-${dateCode.substring(2, 4)}`;
}

export function calculateStartPulse(angle, signalsPerRotation) {
    if (angle === null || angle === undefined || signalsPerRotation === null || signalsPerRotation === undefined || signalsPerRotation <= 0 || angle < 0) {
        console.warn(`Cannot calculate Start Pulse: Invalid input (Angle: ${angle}, Signals: ${signalsPerRotation})`);
        return START_PULSE_MIN;
    }
    const pulsesPerDegree = signalsPerRotation / 360.0;
    let calculatedPulses = Math.round(angle * pulsesPerDegree);
    calculatedPulses = Math.max(START_PULSE_MIN, Math.min(START_PULSE_MAX, calculatedPulses));
    return calculatedPulses;
}

export function decodeCurrentAssistLevel(currentAssistLevelCode, totalAssistLevels) {
    if (currentAssistLevelCode === null || currentAssistLevelCode === undefined ||
        totalAssistLevels === null || totalAssistLevels === undefined) {
        return na;
    }
    let effectiveTotalLevels = totalAssistLevels;
    if (!assistLevelMap[effectiveTotalLevels]) {
        if (effectiveTotalLevels !== 3 && effectiveTotalLevels !== 9) {
            effectiveTotalLevels = 5;
        }
    }
    const levelMapping = assistLevelMap[effectiveTotalLevels];
    if (levelMapping && levelMapping[currentAssistLevelCode] !== undefined) {
        return levelMapping[currentAssistLevelCode];
    }
    console.warn(`Unknown assist level code ${currentAssistLevelCode} for total levels ${totalAssistLevels}`);
    return `Code ${currentAssistLevelCode}`;
}

export function enableAppControls(enable) {
    tabButtons.forEach(button => button.disabled = !enable);
    tabContents.forEach(tabContent => {
        tabContent.querySelectorAll('button, input, select, textarea').forEach(ctrl => {
            if (ctrl.id === 'fwUpdateStartButton') return;
            if (ctrl.id !== 'connectCanButton' && !(ctrl.closest('#tab-debug') && (ctrl.id === 'sendCustomFrame' || ctrl.id === 'canIdInput' || ctrl.id === 'canDataInput'))) {
                ctrl.disabled = !enable;
            }
        });
    });
    if (debugElements.sendCustomFrameButton) debugElements.sendCustomFrameButton.disabled = false;
    if (debugElements.canIdInput) debugElements.canIdInput.disabled = false;
    if (debugElements.canDataInput) debugElements.canDataInput.disabled = false;
}

export function updateCanInterfaceDisplay(statusType, deviceName = null) {
    if (!statusIndicator || !statusText || !connectCanButton || !canDeviceNameElement) {
        console.error("One or more essential UI status elements are missing!");
        addLog("ERROR", "UI Error: Status elements missing.");
        return;
    }

    state.isCanDeviceFound = false;
    state.isCanConnected = false;

    statusIndicator.classList.remove('connected', 'found');
    statusIndicator.style.backgroundColor = '';

    const trimmedStatusType = typeof statusType === 'string' ? statusType.trim() : statusType;
    console.log(`Trimmed Status Type for Switch: '${trimmedStatusType}'`);

    switch (trimmedStatusType) {
        case 'NOT_FOUND':
            state.currentCanDeviceName = null;
            statusText.textContent = 'Disconnected';
            statusIndicator.style.backgroundColor = '#dc3545';
            connectCanButton.textContent = 'Connect';
            connectCanButton.disabled = true;
            canDeviceNameElement.textContent = 'No compatible device detected.';
            enableAppControls(false);
            break;
        case 'FOUND':
            state.isCanDeviceFound = true;
            state.currentCanDeviceName = deviceName;
            statusText.textContent = `Disconnected`;
            statusIndicator.classList.add('found');
            connectCanButton.textContent = 'Connect';
            connectCanButton.disabled = false;
            canDeviceNameElement.textContent = `Device: ${deviceName}`;
            enableAppControls(false);
            break;
        case 'CONNECTED':
            state.isCanDeviceFound = true;
            state.isCanConnected = true;
            state.currentCanDeviceName = deviceName;
            statusText.textContent = `Connected`;
            statusIndicator.classList.add('connected');
            connectCanButton.textContent = 'Disconnect';
            connectCanButton.disabled = false;
            canDeviceNameElement.textContent = `Device: ${deviceName}`;
            enableAppControls(true);
            break;
        case 'DISCONNECTED':
            state.isCanDeviceFound = true;
            state.currentCanDeviceName = deviceName;
            statusText.textContent = `Disconnected`;
            statusIndicator.classList.add('found');
            connectCanButton.textContent = 'Connect';
            connectCanButton.disabled = false;
            canDeviceNameElement.textContent = `Device: ${deviceName}`;
            enableAppControls(false);
            break;
        case 'CONNECTING':
            state.currentCanDeviceName = deviceName;
            statusText.textContent = `Connecting...`;
            statusIndicator.style.backgroundColor = '#ffc107';
            connectCanButton.textContent = 'Connecting...';
            connectCanButton.disabled = true;
            canDeviceNameElement.textContent = deviceName ? `Device: ${deviceName}` : 'Attempting connection...';
            enableAppControls(false);
            break;
        case 'DISCONNECTING':
            statusText.textContent = `Disconnecting`;
            statusIndicator.style.backgroundColor = '#ffc107';
            connectCanButton.textContent = 'Disconnecting...';
            connectCanButton.disabled = true;
            enableAppControls(false);
            break;
        case 'ERROR':
            state.currentCanDeviceName = null;
            statusText.textContent = `Error: ${deviceName || 'Unknown CAN Error'}`;
            statusIndicator.style.backgroundColor = '#dc3545';
            connectCanButton.textContent = 'Connect';
            connectCanButton.disabled = true;
            canDeviceNameElement.textContent = 'Check connection or logs.';
            enableAppControls(false);
            break;
        default:
            state.currentCanDeviceName = null;
            statusText.textContent = 'Status Unknown';
            statusIndicator.style.backgroundColor = '#6c757d';
            connectCanButton.textContent = 'Connect';
            connectCanButton.disabled = true;
            canDeviceNameElement.textContent = '';
            enableAppControls(false);
    }
    enableAppControls(true); //for testing, remove later
}

export function enableControls(enable) { allControls.forEach(ctrl => ctrl.disabled = !enable); }

export function updateStatus(connected, message = '') {
    console.log(`updateStatus called: connected=${connected}, message="${message}"`);
    statusIndicator.classList.toggle('connected', connected);
    statusText.textContent = connected ? `Connected ${message}` : `Disconnected ${message}`;
    enableControls(connected);
}

export function addLog(prefix, data, details = null) {
    const entry = document.createElement('div'); entry.classList.add('log-entry');
    const timeSpan = document.createElement('span'); timeSpan.classList.add('log-time'); timeSpan.textContent = `[${new Date().toLocaleTimeString()}]`;
    const prefixSpan = document.createElement('span'); prefixSpan.classList.add('log-prefix'); prefixSpan.classList.add(prefix.toLowerCase().replace(/[^a-z0-9]/g, '_')); prefixSpan.textContent = `${prefix}:`;
    const dataSpan = document.createElement('span'); dataSpan.classList.add('log-data');

    if ((prefix.toLowerCase().includes('rx') || prefix.toLowerCase().includes('info')) && typeof data === 'object' && data !== null) { const pre = document.createElement('pre'); try { pre.textContent = JSON.stringify(data, null, 2); } catch (e) { pre.textContent = "[Unstringifiable Object]"; } dataSpan.appendChild(pre); }
    else if (typeof data === 'object' && data !== null) { try { dataSpan.textContent = JSON.stringify(data); } catch (e) { dataSpan.textContent = "[Unstringifiable Object]"; } }
    else { dataSpan.textContent = String(data); }

    entry.appendChild(timeSpan);
    entry.appendChild(prefixSpan);
    entry.appendChild(dataSpan);

    if (details) {
        const detailsSpan = document.createElement('span');
        detailsSpan.style.marginLeft = '10px';
        detailsSpan.style.color = '#adb5bd';
        detailsSpan.style.fontSize = '11px';
        detailsSpan.textContent = `(${details})`;
        entry.appendChild(detailsSpan);
    }

    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

export const safeSetText = (element, value, formatter = getNullableString) => {
    if (element) {
        element.textContent = formatter(value);
    } else console.warn("UI Update failed: Text element is null for value:", value);
};

export const safeSetInput = (inputElement, dataObject, dataKey) => {
    if (inputElement && dataObject && inputElement.value === "") {
        const dataValue = dataObject[dataKey];
        if (dataValue !== null && dataValue !== undefined) {
            inputElement.value = dataValue;
        } else {
            inputElement.value = "";
        }
    } else if (!inputElement) {
        console.warn("UI Update failed: Input element is null for key:", dataKey);
    }
};

export const safeSetFormattedInput = (inputElement, dataObject, dataKey, formatter) => {
    if (inputElement && dataObject && inputElement.value === "") {
        const dataValue = dataObject[dataKey];
        if (dataValue !== null && dataValue !== undefined) {
            try {
                inputElement.value = formatter(dataValue) ?? "";
            } catch (e) {
                console.error(`Error formatting input for ${dataKey}:`, e);
                inputElement.value = "";
            }
        } else {
            inputElement.value = "";
        }
    } else if (!inputElement) {
        console.warn("UI Update failed: Formatted input element is null for key:", dataKey);
    }
};

export const safeSetSelectBoolean = (selectElement, dataObject, dataKey, trueValue = "true", falseValue = "false") => {
    if (selectElement && dataObject && selectElement.value === "") {
        const dataValue = dataObject[dataKey];
        if (dataValue !== null && dataValue !== undefined) {
            selectElement.value = dataValue ? trueValue : falseValue;
        } else {
            selectElement.value = "";
        }
    } else if (!selectElement) {
        console.warn("UI Update failed: Boolean select element is null for key:", dataKey);
    }
};

export const safeSetSelectDirect = (selectElement, dataObject, dataKey) => {
    if (selectElement && dataObject && selectElement.value === "") {
        const dataValue = dataObject[dataKey];
        if (dataValue !== null && dataValue !== undefined) {
            selectElement.value = dataValue;
        } else {
            selectElement.value = "";
        }
    } else if (!selectElement) {
        console.warn("UI Update failed: Direct select element is null for key:", dataKey);
    }
};

export function switchTab(targetTabId) {
    tabButtons.forEach(button => {
        button.classList.toggle('active', button.getAttribute('data-tab') === targetTabId);
    });
    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `tab-${targetTabId}`);
    });
    if (targetTabId == "ride-logger")
        Plotly.Plots.resize('rideLoggerChart');
}

export function getNullableNumber(value, precision = -1) { return (value === null || value === undefined || isNaN(value)) ? na : (precision >= 0 ? value.toFixed(precision) : value); }
export function getNullableString(value) { return (value === null || value === undefined) ? na : value; }
export function getNullableBoolean(value, trueText = 'Yes', falseText = 'No') { return (value === null || value === undefined) ? na : (value ? trueText : falseText); }

export function sendCustomFrame(id, data) {
    const command = `${id}#${data}`;
    socket.send(command);
    console.log("Sending:", command);
}

export function encodeToHex(source, target, operation, commandStr) {
    const commandNum = parseInt(commandStr, 16);
    if (isNaN(commandNum)) {
        throw new Error("Wrong command format expected hex (ex. '6007')");
    }
    const c = (commandNum & 0xFFFF);
    const o = (operation & 0x07) << 16;
    const t = (target & 0x1F) << 19;
    const s = (source & 0x1F) << 24;
    const frameID = (s | t | o | c) >>> 0;
    return frameID.toString(16).padStart(8, '0').toUpperCase();
}

export function populateWheelSelect() {
    const select = controllerElements.p3WheelDiameterInput;
    if (!select) {
        console.error("Wheel diameter select element not found!");
        return;
    }
    select.innerHTML = '<option value="">-- Select --</option>';
    wheelDiameterTable.forEach(wheel => {
        const option = document.createElement('option');
        option.value = wheel.text;
        option.textContent = wheel.text;
        option.dataset.code0 = wheel.code[0];
        option.dataset.code1 = wheel.code[1];
        option.dataset.minCirc = wheel.minimalCircumference;
        option.dataset.maxCirc = wheel.maximalCircumference;
        select.appendChild(option);
    });
    select.addEventListener('change', () => {
        const selectedOption = select.options[select.selectedIndex];
        const circInput = controllerElements.p3CircumferenceInput;
        if (selectedOption && selectedOption.dataset.minCirc && selectedOption.dataset.maxCirc) {
            circInput.min = selectedOption.dataset.minCirc;
            circInput.max = selectedOption.dataset.maxCirc;
        } else {
            circInput.min = "400";
            circInput.max = "3000";
        }
    });
}
