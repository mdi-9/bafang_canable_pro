// bafang-can-read-commands.js
"use strict";

// Import necessary constants (like DeviceNetworkId) if they are used
// Assuming DeviceNetworkId is defined in bafang-constants.js
const { DeviceNetworkId } = require('./bafang-constants');

const CanReadCommandsList = Object.freeze({
    HardwareVersion: {
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x00,
        applicableDevices: [DeviceNetworkId.TORQUE_SENSOR, DeviceNetworkId.DRIVE_UNIT, DeviceNetworkId.DISPLAY, DeviceNetworkId.BATTERY],
    },
    SoftwareVersion: {
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x01,
        applicableDevices: [DeviceNetworkId.TORQUE_SENSOR, DeviceNetworkId.DRIVE_UNIT, DeviceNetworkId.DISPLAY, DeviceNetworkId.BATTERY],
    },
    ModelNumber: {
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x02,
        applicableDevices: [DeviceNetworkId.TORQUE_SENSOR, DeviceNetworkId.DRIVE_UNIT, DeviceNetworkId.DISPLAY, DeviceNetworkId.BATTERY],
    },
    SerialNumber: {
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x03,
        applicableDevices: [DeviceNetworkId.TORQUE_SENSOR, DeviceNetworkId.DRIVE_UNIT, DeviceNetworkId.DISPLAY, DeviceNetworkId.BATTERY],
    },
    CustomerNumber: {
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x04,
        applicableDevices: [DeviceNetworkId.TORQUE_SENSOR, DeviceNetworkId.DISPLAY],
    },
    Manufacturer: {
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x05,
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT, DeviceNetworkId.DISPLAY],
    },
    ErrorCode: { // Read Error Codes from Display
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x07,
        applicableDevices: [DeviceNetworkId.DISPLAY],
    },
    BootloaderVersion: { // Read Bootloader Version from Display
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x08,
        applicableDevices: [DeviceNetworkId.DISPLAY],
    },
	Parameter0: { // Read Controller Parameter Block 0 (Contains Acceleration)
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x10, // 16
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
    Parameter1: { // Read Controller Parameter Block 1
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x11, // 17
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
    Parameter2: { // Read Controller Parameter Block 2 (Torque Profiles)
        canCommandCode: 0x60, // 96
        canCommandSubCode: 0x12, // 18
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
    MotorSpeedParameters: { // Read Speed Limit, Wheel Diameter Code, Circumference
        canCommandCode: 0x32, // 50
        canCommandSubCode: 0x03,
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
    DisplayDataBlock1: { // Read Total/Single Mileage, Max Speed
        canCommandCode: 0x63, // 99
        canCommandSubCode: 0x01,
        applicableDevices: [DeviceNetworkId.DISPLAY],
    },
    DisplayDataBlock2: { // Read Average Speed, Service Mileage
        canCommandCode: 0x63, // 99
        canCommandSubCode: 0x02,
        applicableDevices: [DeviceNetworkId.DISPLAY],
    },
	DisplayAutoShutdownTime: { // Read Auto Shutdown Time (Minutes, 255=OFF)
        canCommandCode: 0x63, // 99
        canCommandSubCode: 0x03,
        applicableDevices: [DeviceNetworkId.DISPLAY],
    },
    CellsVoltage0: { // Read Battery Cell Voltages (Group 0)
        canCommandCode: 0x64, // 100
        canCommandSubCode: 0x02,
        applicableDevices: [DeviceNetworkId.BATTERY],
    },
    CellsVoltage1: { // Read Battery Cell Voltages (Group 1)
        canCommandCode: 0x64, // 100
        canCommandSubCode: 0x03,
        applicableDevices: [DeviceNetworkId.BATTERY],
    },
    CellsVoltage2: { // Read Battery Cell Voltages (Group 2)
        canCommandCode: 0x64, // 100
        canCommandSubCode: 0x04,
        applicableDevices: [DeviceNetworkId.BATTERY],
    },
    CellsVoltage3: { // Read Battery Cell Voltages (Group 3)
        canCommandCode: 0x64, // 100
        canCommandSubCode: 0x05,
        applicableDevices: [DeviceNetworkId.BATTERY],
    },
    BatteryDesign: { // Read Battery Design Info
        canCommandCode: 0x64, // 100
        canCommandSubCode: 0x00,
        applicableDevices: [DeviceNetworkId.BATTERY],
    },
    BatteryCapacity: { // Read Battery Capacity Info
        canCommandCode: 0x34, // 52
        canCommandSubCode: 0x00,
        applicableDevices: [DeviceNetworkId.BATTERY],
    },
    BatteryState: { // Read Battery Current State (Voltage, Current, Temp)
        canCommandCode: 0x34, // 52
        canCommandSubCode: 0x01,
        applicableDevices: [DeviceNetworkId.BATTERY],
    },
    BatteryChargingInfo: { // Read Battery Charging Info
        canCommandCode: 0x64, // 100
        canCommandSubCode: 0x01,
        applicableDevices: [DeviceNetworkId.BATTERY],
    },
    ControllerRealtime0: {
        canCommandCode: 0x32, // 50
        canCommandSubCode: 0x00,
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
    ControllerRealtime1: {
        canCommandCode: 0x32, // 50
        canCommandSubCode: 0x01,
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
	SensorRealtime: {
        canCommandCode: 0x31, // 49
        canCommandSubCode: 0x00,
        applicableDevices: [DeviceNetworkId.TORQUE_SENSOR],
    },
	DisplayRealtime: {
        canCommandCode: 0x63, // 
        canCommandSubCode: 0x00,
        applicableDevices: [DeviceNetworkId.DISPLAY],
    },
	ControllerStartupAngle: {
        canCommandCode: 0x62, 
        canCommandSubCode: 0xD9,
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
    Controller_Parameter_6017: { 
        canCommandCode: 0x60,    // 96 in decimal
        canCommandSubCode: 0x17, // 23 in decimal
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
    Controller_Parameter_6018: { 
        canCommandCode: 0x60,    // 96 in decimal
        canCommandSubCode: 0x18, // 24 in decimal
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
    FwUpdateReadyCheckOld: {
        canCommandCode: 0x20, // 32
        canCommandSubCode: 0x00,
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
    FwUpdateReadyCheck: {
        canCommandCode: 0x40, // 64
        canCommandSubCode: 0x00,
        applicableDevices: [DeviceNetworkId.DRIVE_UNIT],
    },
});

module.exports = { CanReadCommandsList };