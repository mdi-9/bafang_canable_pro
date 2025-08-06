// bafang-can-broadcast-commands.js
"use strict";

// Import necessary constants (like DeviceNetworkId) if they are used
// Assuming DeviceNetworkId is defined in bafang-constants.js
const { DeviceNetworkId, CanOperation } = require('./bafang-constants');

const CanBroadcastCommandsList = Object.freeze({
    FwUpdateInit: {
        canCommandCode: 0x30, // 48
        canCommandSubCode: 0x05,
        applicableDevices: [DeviceNetworkId.BROADCAST],
        canOperationCode: CanOperation.MULTIFRAME_WARNING,
    },
});

module.exports = { CanBroadcastCommandsList };