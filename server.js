/// server.js
"use strict";

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const usb = require('usb');

// Import Bafang-specific modules
const canbus = require('./canbus'); // The main CanBusService instance
const { DeviceNetworkId, CanOperation } = require('./bafang-constants'); // Added CanOperation
const { CanReadCommandsList } = require('./bafang-can-read-commands');
const { CanWriteCommandsList } = require('./bafang-can-write-commands');

const { generateCanFrameId, bafangIdArrayTo32Bit } = require('./bafang-parser');
const FwUpdater = require('./fw-updater');
const Sniffer = require('./sniffer');

// --- Globals ---
let clients = [];
let canDevicePresenceInterval = null;
const CANABLE_VID = 0x1D50; // Common VID for CANable/OpenMoko
const CANABLE_PID = 0x606F; // Common PID for CANable/Gespeaker (gs_usb firmware)
let detectedCanDeviceName = null; // Store name of the detected device
let isCheckingPresence = false; // Mutex flag for presence check

// --- HTTP Server setup (Serves the index.html UI) ---
const server = http.createServer((req, res) => {
    // Determine file path, default to index.html
    const filePath = path.join(__dirname, 'ui', req.url === '/' ? 'index.html' : req.url);
	let requestedUrl = req.url;
    if (requestedUrl === '/') {
        requestedUrl = '/index.html'; // Explicitly serve index.html for root
    }

    // Basic security: prevent directory traversal
    const baseDir = path.resolve(__dirname);
    if (!filePath.startsWith(baseDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
	
	if (requestedUrl.includes('.well-known/appspecific/com.chrome.devtools.json')) {
        console.log(`Ignoring DevTools request: ${requestedUrl}`);
        res.writeHead(404);
        res.end('Not Found');
        return; // Stop processing this request early
    }

    // Read and serve the file
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error(`Error reading file ${filePath}: ${err.code}`);
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            // Determine content type (basic)
            let contentType = 'text/html';
            if (filePath.endsWith('.js')) {
                contentType = 'text/javascript';
            } else if (filePath.endsWith('.css')) {
                contentType = 'text/css';
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        }
    });
});

async function getStringDescriptorAsync(device, index) {
    return new Promise((resolve, reject) => {
        if (!index) {
            resolve(""); // No descriptor to get
            return;
        }
        device.getStringDescriptor(index, (error, data) => {
            if (error) {
                // Don't reject, just resolve with empty or error string
                // console.warn(`Error getting string descriptor ${index}:`, error.message);
                resolve("");
            } else {
                resolve(data);
            }
        });
    });
}

async function checkCanDevicePresenceAndUpdateGlobal() {
    if (isCheckingPresence) {
        // console.log("Presence check already in progress, skipping.");
        return detectedCanDeviceName; // Return last known state
    }
    isCheckingPresence = true;

    let deviceToClose = null; // Keep track of the device if we open it

    try {
        const devices = usb.getDeviceList();
        const canableDevice = devices.find(device =>
            device.deviceDescriptor.idVendor === CANABLE_VID &&
            device.deviceDescriptor.idProduct === CANABLE_PID
        );

        if (canableDevice) {
            let nameToSet = `CANable Device (VID:${CANABLE_VID.toString(16)}, PID:${CANABLE_PID.toString(16)})`; // Fallback
            deviceToClose = canableDevice; // Mark that we might open this
            let wasOpened = false;

            try {
                canableDevice.open();
                wasOpened = true;

                // Ensure these are awaited
                const manufacturer = await getStringDescriptorAsync(canableDevice, canableDevice.deviceDescriptor.iManufacturer);
                const product = await getStringDescriptorAsync(canableDevice, canableDevice.deviceDescriptor.iProduct);

                if (product) {
                    nameToSet = manufacturer ? `${product} (by ${manufacturer})` : product;
                }
                // Note: device is closed in the finally block if it was opened
            } catch (e) {
                console.warn(`Could not fully query device ${CANABLE_VID.toString(16)}:${CANABLE_PID.toString(16)}: ${e.message}. Using generic name.`);
                if (e.message.includes("LIBUSB_ERROR_ACCESS")) {
                    nameToSet += " - Access Denied (check udev rules/permissions)";
                    console.error("LIBUSB_ERROR_ACCESS: Ensure you have correct udev rules or run with sudo (not recommended for long term).");
                } else if (e.message.includes("LIBUSB_ERROR_NOT_FOUND") || e.message.includes("LIBUSB_ERROR_NO_DEVICE") || e.message.includes("LIBUSB_ERROR_BUSY")) {
                    // Device disappeared, or is busy (perhaps canbus.js has it)
                    detectedCanDeviceName = null;
                    deviceToClose = null; // Don't try to close it if it's gone or busy
                    if (wasOpened) { // If we did manage to open it before it vanished/got busy
                        try {
                            canableDevice.close(); // Attempt to close it
                        } catch (closeErr) {
                            // console.warn("Error closing device that vanished/got busy:", closeErr.message);
                        }
                    }
                    isCheckingPresence = false;
                    return null;
                }
                // If open failed, wasOpened remains false, deviceToClose might still be canableDevice
                // but the finally block will only close if wasOpened is true.
            }
            detectedCanDeviceName = nameToSet;
            isCheckingPresence = false;
            return detectedCanDeviceName;
        } else {
            detectedCanDeviceName = null;
            isCheckingPresence = false;
            return null;
        }
    } catch (err) {
        console.error("Error checking USB devices:", err);
        detectedCanDeviceName = null;
        isCheckingPresence = false;
        return null;
    } finally {
        if (deviceToClose && deviceToClose.interfaces && deviceToClose.deviceDescriptor.bNumConfigurations > 0) { // Check if it's a valid, opened device object
            try {
                // console.log("Closing device in finally block of presence check");
                deviceToClose.close();
            } catch (closeError) {
                // This is the "Can't close device with a pending request" error source
                // Or "The device has no langid" if not opened successfully
                // Or "Device is not open" if it was never opened or closed already
                // console.warn(`Error closing device in finally: ${closeError.message}`);
            }
        }
        isCheckingPresence = false;
    }
}


function broadcastCanDeviceStatus() {
    let messageToSend = ''; // Determine the message based on state
    if (canbus.isConnected()) {
        messageToSend = `CAN_DEVICE_STATUS:CONNECTED:${detectedCanDeviceName || "Connected Device"}`;
    } else {
        if (detectedCanDeviceName) {
            messageToSend = `CAN_DEVICE_STATUS:FOUND:${detectedCanDeviceName}`;
        } else {
            messageToSend = 'CAN_DEVICE_STATUS:NOT_FOUND';
        }
    }
    console.log(`Broadcasting: ${messageToSend}`); 
    broadcastToClients(messageToSend);
}

// --- WebSocket Server ---
const wss = new WebSocket.Server({ server });

	async function handleConnectionCommands(ws, messageString) {
		if (messageString === 'GET_CAN_INTERFACE_STATUS') {
			await checkCanDevicePresenceAndUpdateGlobal();
			broadcastCanDeviceStatus();
			return true;
		}
		if (messageString === 'CONNECT_CAN') {
			if (canbus.isConnected()) {
				ws.send('INFO: Already connected.');
				broadcastCanDeviceStatus();
				return true;
			}
			await checkCanDevicePresenceAndUpdateGlobal();
			if (detectedCanDeviceName) {
				broadcastToClients(`CAN_DEVICE_STATUS:CONNECTING:${detectedCanDeviceName}`);
				await canbus.init(detectedCanDeviceName);
			} else {
				broadcastToClients('CAN_DEVICE_STATUS:NOT_FOUND');
				ws.send('CAN_ERROR: No CAN device found to connect.');
			}
			return true;
		}
		if (messageString === 'DISCONNECT_CAN') {
			if (!canbus.isConnected()) {
				ws.send('INFO: Already disconnected.');
				broadcastCanDeviceStatus();
				return true;
			}
			broadcastToClients(`CAN_DEVICE_STATUS:DISCONNECTING:${detectedCanDeviceName || "Device"}`);
			await canbus.close();
			return true;
		}
		return false; // Not a connection command
	}

	async function handleReadCommands(ws, messageString, sendResult) {
		if (!messageString.startsWith('READ:')) return false;

		const parts = messageString.substring('READ:'.length).split(':');
		if (parts.length !== 3) {
			ws.send('ERROR: Invalid READ format. Use READ:TARGET:CMD:SUB');
			return true;
		}
		const targetId = parseInt(parts[0], 10);
		const cmdCode = parseInt(parts[1], 10);
		const subCode = parseInt(parts[2], 10);
		let cmdInfo = null;
		let cmdKey = `${cmdCode}/${subCode}`;
		let parseError = false;
		const validTargets = Object.values(DeviceNetworkId);

		if (isNaN(targetId) || !validTargets.includes(targetId)) { ws.send(`ERROR: Invalid Target ID ${parts[0]}.`); parseError = true; }

		if (!parseError) {
			for (const key in CanReadCommandsList) {
				const cmd = CanReadCommandsList[key];
				if (cmd.canCommandCode === cmdCode && cmd.canCommandSubCode === subCode) { cmdInfo = cmd; cmdKey = key; break; }
			}
			if (!cmdInfo) { ws.send(`ERROR: Command ${cmdCode}/${subCode} not found in read list.`); parseError = true; }
		}
		if (cmdInfo && !parseError && (!cmdInfo.applicableDevices || !cmdInfo.applicableDevices.includes(targetId))) {
			ws.send(`ERROR: Command ${cmdKey} is not applicable to target device ${targetId}.`); parseError = true;
		}
		if (!parseError) {
			const source = DeviceNetworkId.BESST;
			const bafangIdArr = generateCanFrameId(source, targetId, CanOperation.READ_CMD, cmdCode, subCode);
			const canId32bit = bafangIdArrayTo32Bit(bafangIdArr);
			console.log(`>>> Initiating Read ${cmdKey} | Target: ${targetId} | 32bit ID: ${canId32bit.toString(16).toUpperCase().padStart(8, '0')}`);
			ws.send(`INFO: Initiating Read ${cmdKey} from ${targetId}...`);
			const result = await canbus.readParameter(targetId, cmdInfo);
			sendResult(`Read ${cmdKey}`, result);
		}
		return true; // Command was handled (or failed validation within this handler)
	}

	async function handleReadRawCommand(ws, messageString, sendResult) {
		if (!messageString.startsWith('READ_RAW:')) return false;

		const parts = messageString.substring('READ_RAW:'.length).split(':');
		if (parts.length !== 3) {
			ws.send('ERROR: Invalid READ format. Use READ_RAW:TARGET:CMD:SUB');
			return true;
		}
		const targetId = parseInt(parts[0], 10);
		const cmdCode = parseInt(parts[1], 10);
		const subCode = parseInt(parts[2], 10);
		let cmdInfo = { 
			canCommandCode: cmdCode,
			canCommandSubCode: subCode,
			applicableDevices: [targetId],
		};
		let cmdKey = `${cmdCode}/${subCode}`;
		let parseError = false;
		const validTargets = Object.values(DeviceNetworkId);

		if (isNaN(targetId) || !validTargets.includes(targetId)) { ws.send(`ERROR: Invalid Target ID ${parts[0]}.`); parseError = true; }

		if (!parseError) {
			const source = DeviceNetworkId.BESST;
			const bafangIdArr = generateCanFrameId(source, targetId, CanOperation.READ_CMD, cmdCode, subCode);
			const canId32bit = bafangIdArrayTo32Bit(bafangIdArr);
			console.log(`>>> Initiating Read ${cmdKey} | Target: ${targetId} | 32bit ID: ${canId32bit.toString(16).toUpperCase().padStart(8, '0')}`);
			ws.send(`INFO: Initiating Read ${cmdKey} from ${targetId}...`);
			const result = await canbus.readParameter(targetId, cmdInfo);
			sendResult(`Read ${cmdKey}`, result);
		}
		return true; // Command was handled (or failed validation within this handler)
	}

	async function handleWriteShortCommands(ws, messageString, sendResult) {
		if (!messageString.startsWith('WRITE_SHORT:')) return false;

		const parts = messageString.substring('WRITE_SHORT:'.length).split(':', 4);
		if (parts.length < 3) {
			ws.send('ERROR: Invalid WRITE_SHORT format. Use WRITE_SHORT:TARGET:CMD:SUB[:DATAHEX]');
			return true;
		}
		const targetId = parseInt(parts[0], 10);
		const cmdCode = parseInt(parts[1], 10);
		const subCode = parseInt(parts[2], 10);
		const dataHex = (parts.length === 4) ? (parts[3] || "") : "";
		const dataBytes = [];
		let parseError = false;
		let cmdInfo = null;
		let cmdKey = `${cmdCode}/${subCode}`;
		const validTargets = Object.values(DeviceNetworkId);

		if (dataHex) {
			if (dataHex.length % 2 !== 0) { ws.send('ERROR: Data Hex must have even length.'); parseError = true; }
			if (!parseError) {
				for (let i = 0; i < dataHex.length; i += 2) {
					const byte = parseInt(dataHex.substring(i, i + 2), 16);
					if (isNaN(byte)) { ws.send('ERROR: Data Hex contains invalid characters.'); parseError = true; break; }
					dataBytes.push(byte);
				}
			}
			if (!parseError && dataBytes.length > 8) { ws.send('ERROR: Data payload too long (max 8 bytes).'); parseError = true; }
		}
		if (!parseError && (isNaN(targetId) || !validTargets.includes(targetId))) { ws.send(`ERROR: Invalid Target ID ${parts[0]}.`); parseError = true; }
		if (!parseError) {
			for (const key in CanWriteCommandsList) {
				const cmd = CanWriteCommandsList[key];
				if (cmd.canCommandCode === cmdCode && cmd.canCommandSubCode === subCode) { cmdInfo = cmd; cmdKey = key; break; }
			}
			if (!cmdInfo) { ws.send(`ERROR: Command ${cmdCode}/${subCode} not found in write list.`); parseError = true; }
		}
		if (cmdInfo && !parseError && (!cmdInfo.applicableDevices || !cmdInfo.applicableDevices.includes(targetId))) {
			ws.send(`ERROR: Command ${cmdKey} is not applicable to target device ${targetId}.`); parseError = true;
		}
		if (!parseError) {
			console.log(`>>> Initiating Short Write ${cmdKey} | Target: ${targetId} | Data: ${dataHex}`);
			ws.send(`INFO: Initiating Short Write ${cmdKey} to ${targetId}...`);
			const result = await canbus.writeShortParameterWithAck(targetId, cmdInfo, dataBytes);
			sendResult(`Short Write ${cmdKey}`, result);
		}
		return true;
	}

	async function handleWriteShortRawCommand(ws, messageString, sendResult) {
		if (!messageString.startsWith('WRITE_SHORT_RAW:')) return false;

		const parts = messageString.substring('WRITE_SHORT_RAW:'.length).split(':', 4);
		if (parts.length < 3) {
			ws.send('ERROR: Invalid WRITE_SHORT_RAW format. Use WRITE_SHORT_RAW:TARGET:CMD:SUB[:DATAHEX]');
			return true;
		}
		const targetId = parseInt(parts[0], 10);
		const cmdCode = parseInt(parts[1], 10);
		const subCode = parseInt(parts[2], 10);
		const dataHex = (parts.length === 4) ? (parts[3] || "") : "";
		const dataBytes = [];
		let parseError = false;
		let cmdInfo = {
			canCommandCode: cmdCode,
			canCommandSubCode: subCode, // 
			applicableDevices: [targetId],
		};
		let cmdKey = `${cmdCode}/${subCode}`;
		const validTargets = Object.values(DeviceNetworkId);

		if (dataHex) {
			if (dataHex.length % 2 !== 0) { ws.send('ERROR: Data Hex must have even length.'); parseError = true; }
			if (!parseError) {
				for (let i = 0; i < dataHex.length; i += 2) {
					const byte = parseInt(dataHex.substring(i, i + 2), 16);
					if (isNaN(byte)) { ws.send('ERROR: Data Hex contains invalid characters.'); parseError = true; break; }
					dataBytes.push(byte);
				}
			}
			if (!parseError && dataBytes.length > 8) { ws.send('ERROR: Data payload too long (max 8 bytes).'); parseError = true; }
		}
		if (!parseError && (isNaN(targetId) || !validTargets.includes(targetId))) { ws.send(`ERROR: Invalid Target ID ${parts[0]}.`); parseError = true; }
		if (cmdInfo && !parseError && (!cmdInfo.applicableDevices || !cmdInfo.applicableDevices.includes(targetId))) {
			ws.send(`ERROR: Command ${cmdKey} is not applicable to target device ${targetId}.`); parseError = true;
		}
		if (!parseError) {
			console.log(`>>> Initiating Short Write ${cmdKey} | Target: ${targetId} | Data: ${dataHex}`);
			ws.send(`INFO: Initiating Short Write ${cmdKey} to ${targetId}...`);
			const result = await canbus.writeShortParameterWithAck(targetId, cmdInfo, dataBytes);
			sendResult(`Short Write ${cmdKey}`, result);
		}
		return true;
	}

	async function handleWriteLongParsedParams(ws, messageString) {
		if (!(messageString.startsWith('WRITE_LONG_P') && !messageString.includes('_RAW:'))) return false;

		const paramMatch = messageString.match(/^WRITE_LONG_(P[0-2]):(\{.*\})$/);
		if (!paramMatch || !paramMatch[1] || !paramMatch[2]) {
			ws.send('ERROR: Invalid WRITE_LONG_P format. Expected P0, P1, or P2 followed by :{json_object}.');
			return true;
		}
		const paramBlockKey = paramMatch[1];
		const jsonData = paramMatch[2];
		let saveFunction;
		let paramName = `Parameter ${paramBlockKey.substring(1)}`;

		switch (paramBlockKey) {
			case 'P0': saveFunction = canbus.saveControllerParams0; break;
			case 'P1': saveFunction = canbus.saveControllerParams1; break;
			case 'P2': saveFunction = canbus.saveControllerParams2; break;
			default: ws.send(`ERROR: Invalid parameter key for WRITE_LONG_P: ${paramBlockKey}`); return true;
		}
		try {
			const params = JSON.parse(jsonData);
			if (typeof params === 'object' && params !== null) {
				ws.send(`INFO: Initiating Long Write ${paramName} to Controller (No ACK Tracked by UI)...`);
				await saveFunction(params);
				ws.send(`INFO: Controller ${paramName} write sequence sent.`);
			} else { ws.send(`ERROR: Invalid JSON for ${paramName}. Expected an object.`); }
		} catch (e) { ws.send(`ERROR: Failed to parse JSON for ${paramName}: ${e.message}`); }
		return true;
	}

	async function handleWriteLongRawParams(ws, messageString, sendRawWriteStatus) {
		if (!(messageString.startsWith('WRITE_LONG_P') && messageString.includes('_RAW:'))) return false;

		const [commandPart, jsonData] = messageString.split('_RAW:');
		const paramTypeMatch = commandPart.match(/WRITE_LONG_(P[0-2])$/);
		if (!paramTypeMatch || !paramTypeMatch[1] || !jsonData) {
			ws.send('ERROR: Invalid RAW parameter write format. Could not extract P-number or JSON data.');
			return true;
		}
		const paramBlockKey = paramTypeMatch[1];
		let targetCommandInfo = null;
		let descriptiveName = '';

		switch (paramBlockKey) {
			case 'P0': targetCommandInfo = CanWriteCommandsList.Parameter0; descriptiveName = 'Controller Parameter 0'; break;
			case 'P1': targetCommandInfo = CanWriteCommandsList.Parameter1; descriptiveName = 'Controller Parameter 1'; break;
			case 'P2': targetCommandInfo = CanWriteCommandsList.Parameter2; descriptiveName = 'Controller Parameter 2'; break;
			default: ws.send(`ERROR: Unknown raw parameter block key: ${paramBlockKey}`); return true;
		}
		if (!targetCommandInfo) { ws.send(`ERROR: Write command info not found for ${descriptiveName}.`); return true; }
		try {
			const bytesArray = JSON.parse(jsonData);
			if (Array.isArray(bytesArray) && bytesArray.length === 64 && bytesArray.every(b => typeof b === 'number' && b >= 0 && b <= 255)) {
				ws.send(`INFO: Writing raw ${descriptiveName} to Controller...`);
				const success = await canbus.writeRawBytesParameter(DeviceNetworkId.DRIVE_UNIT, targetCommandInfo, bytesArray);
				sendRawWriteStatus(descriptiveName, success);
			} else { ws.send(`ERROR: Invalid byte array for raw ${descriptiveName}.`); }
		} catch (e) { ws.send(`ERROR: Failed to parse JSON byte array for raw ${descriptiveName}: ${e.message}`); }
		return true;
	}

	async function handleWriteLongRawCustomParams(ws, messageString, sendRawWriteStatus) {
		if (!messageString.startsWith('WRITE_LONG_RAW:')) return false;
		const parts = messageString.substring('WRITE_LONG_RAW:'.length).split(':', 4);
		if (parts.length < 4) {
			ws.send('ERROR: Invalid WRITE_LONG_RAW: format. Use WRITE_LONG_RAW:TARGET:CMD:SUB:DATAHEX');
			return true;
		}
		const targetId = parseInt(parts[0], 10);
		const cmdCode = parseInt(parts[1], 10);
		const subCode = parseInt(parts[2], 10);
		const jsonData = parts[3];
		let targetCommandInfo = {
			canCommandCode: cmdCode,
			canCommandSubCode: subCode,
			applicableDevices: [targetId]
		};
		try {
			const bytesArray = JSON.parse(jsonData);
			if (Array.isArray(bytesArray) && bytesArray.every(b => typeof b === 'number' && b >= 0 && b <= 255)) {
				ws.send(`INFO: Writing raw long custom...`);
				const success = await canbus.writeRawBytesParameter(targetId, targetCommandInfo, bytesArray);
				sendRawWriteStatus('raw long custom', success);
			} else { ws.send(`ERROR: Invalid byte array for raw long custom.`); }
		} catch (e) { ws.send(`ERROR: Failed to parse JSON byte array for raw long custom: ${e.message}`); }
		return true;
	}

	async function handleWriteLongSpeedParams(ws, messageString) {
		if (!messageString.startsWith('WRITE_LONG_SPEED:')) return false;

		const jsonData = messageString.substring('WRITE_LONG_SPEED:'.length);
		try {
			const speedParams = JSON.parse(jsonData);
			if (speedParams && typeof speedParams.speed_limit === 'number' &&
				speedParams.wheel_diameter && Array.isArray(speedParams.wheel_diameter.code) && speedParams.wheel_diameter.code.length === 2 &&
				typeof speedParams.circumference === 'number') { // Assuming circumference is now always sent
				ws.send(`INFO: Initiating Write Speed Parameters to Controller (No ACK Tracked by UI)...`);
				await canbus.saveControllerSpeedParams(speedParams);
				ws.send(`INFO: Controller Speed Parameters write sequence sent.`);
			} else {
				ws.send('ERROR: Invalid JSON data structure for WRITE_LONG_SPEED.');
				console.error("Invalid speedParams structure for WRITE_LONG_SPEED:", speedParams);
			}
		} catch (e) {
			ws.send(`ERROR: Failed to parse JSON for WRITE_LONG_SPEED: ${e.message}`);
			console.error("JSON Parse Error for WRITE_LONG_SPEED:", e);
		}
		return true;
	}

	async function handleWriteLongStringParams(ws, messageString) {
		if (!messageString.startsWith('WRITE_LONG_STRING:')) return false;

		const parts = messageString.substring('WRITE_LONG_STRING:'.length).split(':', 4);
		if (parts.length < 3) {
			ws.send('ERROR: Invalid WRITE_LONG_STRING format.');
			return true;
		}
		const targetId = parseInt(parts[0], 10);
		const cmdCode = parseInt(parts[1], 10);
		const subCode = parseInt(parts[2], 10);
		const value = (parts.length === 4) ? (parts[3] || "") : "";
		let parseError = false;
		let cmdInfo = null;
		let cmdKey = `${cmdCode}/${subCode}`;
		const validTargets = Object.values(DeviceNetworkId);

		if (isNaN(targetId) || !validTargets.includes(targetId)) { ws.send(`ERROR: Invalid Target ID ${parts[0]}.`); parseError = true; }
		if (!parseError) {
			for (const key in CanWriteCommandsList) {
				const cmd = CanWriteCommandsList[key];
				if (cmd.canCommandCode === cmdCode && cmd.canCommandSubCode === subCode) { cmdInfo = cmd; cmdKey = key; break; }
			}
			if (!cmdInfo) { ws.send(`ERROR: Command ${cmdCode}/${subCode} not found in write list.`); parseError = true; }
		}
		if (cmdInfo && !parseError && (!cmdInfo.applicableDevices || !cmdInfo.applicableDevices.includes(targetId))) {
			ws.send(`ERROR: Command ${cmdKey} is not applicable to target device ${targetId}.`); parseError = true;
		}
		if (!parseError && value === "") { ws.send(`ERROR: Value string is required for WRITE_LONG_STRING.`); parseError = true; }
		if (!parseError) {
			ws.send(`INFO: Initiating Long Write String ${cmdKey} to ${targetId} (No ACK Tracked by UI)...`);
			await canbus.saveStringParameter(targetId, cmdInfo, value);
			ws.send(`INFO: String Parameter ${cmdKey} write sequence sent.`);
		}
		return true;
	}

	async function handleDisplaySpecificWrites(ws, messageString,sendResult) {
		if (messageString.startsWith('WRITE_DISP_TOTAL_MILEAGE:')) {
			const value = parseFloat(messageString.substring('WRITE_DISP_TOTAL_MILEAGE:'.length));
			if (!isNaN(value)) {
				ws.send(`INFO: Initiating Write Total Mileage to Display (No ACK Tracked by UI)...`);
				await canbus.saveDisplayTotalMileage(value); ws.send(`INFO: Total Mileage write sequence sent.`);
			} else { ws.send('ERROR: Invalid mileage value.'); }
			return true;
		}
		if (messageString.startsWith('WRITE_DISP_SINGLE_MILEAGE:')) {
			const value = parseFloat(messageString.substring('WRITE_DISP_SINGLE_MILEAGE:'.length));
			if (!isNaN(value)) {
				ws.send(`INFO: Initiating Write Single Mileage to Display (No ACK Tracked by UI)...`);
				await canbus.saveDisplaySingleMileage(value); ws.send(`INFO: Single Mileage write sequence sent.`);
			} else { ws.send('ERROR: Invalid mileage value.'); }
			return true;
		}
		if (messageString.startsWith('SET_AND_CLEAN_SERVICE_MILEAGE:')) {
            // Expected format: SET_AND_CLEAN_SERVICE_MILEAGE:threshold_in_km
            const thresholdStr = messageString.substring('SET_AND_CLEAN_SERVICE_MILEAGE:'.length);
            const thresholdKm = parseInt(thresholdStr, 10);

            if (isNaN(thresholdKm) || thresholdKm < 0) {
                ws.send('ERROR: Invalid threshold value for service mileage. Must be a non-negative number.');
                return;
            }

            ws.send(`INFO: Setting service threshold to ${thresholdKm}km and then clearing current service counter...`);

            try {

                const setResult = await canbus.setDisplayServiceThreshold(thresholdKm);
                if (!setResult || !setResult.success) {
                    sendResult(`SetServiceThreshold (${thresholdKm}km)`, setResult || { success: false, error: "Failed to set threshold." });
                    return; // Stop if setting threshold fails
                }
                ws.send(`ACK: Service threshold set to ${thresholdKm}km.`);
                
				await new Promise(resolve => setTimeout(resolve, 200)); 

                // Step 2: Clear the current service counter
                const cleanResult = await canbus.cleanDisplayServiceMileage();
                sendResult('CleanServiceMileage', cleanResult);

            } catch (e) {
                console.error('Error during set/clear service mileage:', e);
                ws.send(`ERROR: Operation failed: ${e.message}`);
            }
			return true;
		}

		return false;
	}

	async function handleStartupAngleCommands(ws, messageString, sendResult) {
		if (messageString === 'READ_STARTUP_ANGLE') {
			const targetId = DeviceNetworkId.DRIVE_UNIT;
			const cmdInfo = CanReadCommandsList.ControllerStartupAngle;
			if (!cmdInfo) { ws.send(`ERROR: Startup Angle read command not defined.`); }
			else {
				ws.send(`INFO: Initiating Read Startup Angle from Controller...`);
				const result = await canbus.readParameter(targetId, cmdInfo, [0x00]);
				sendResult(`Read Startup Angle`, result);
			}
			return true;
		}
		if (messageString.startsWith('WRITE_STARTUP_ANGLE:')) {
			const valueStr = messageString.substring('WRITE_STARTUP_ANGLE:'.length);
			const angle = parseInt(valueStr, 10);
			if (!isNaN(angle)) {
				ws.send(`INFO: Initiating Write Startup Angle (${angle}) to Controller (No ACK Tracked by UI)...`);
				await canbus.saveControllerStartupAngle(angle); ws.send(`INFO: Startup Angle write command sent.`);
			} else { ws.send(`ERROR: Invalid angle value for WRITE_STARTUP_ANGLE: ${valueStr}`); }
			return true;
		}
		return false;
	}

	async function handleRawCanFrame(ws, messageString) {
		if (!messageString.includes('#')) return false; // Not a raw frame command if no '#'

		const parts = messageString.split('#');
		const idHex = parts[0]; const dataHex = parts[1] || "";
		if (!/^[0-9a-fA-F]+$/.test(idHex) || (dataHex && !/^[0-9a-fA-F]*$/.test(dataHex)) || dataHex.length % 2 !== 0 || dataHex.length > 16) {
			ws.send(`ERROR: Invalid raw frame format or data: ${messageString}`);
		} else {
			const success = await canbus.sendRawFrame(idHex, dataHex);
			ws.send(success ? `INFO: Sent Raw: ${messageString}` : `ERROR: Failed to send raw frame ${messageString}`);
		}
		return true;
	}

	async function handleStartFwUpload(ws, messageString) {
		if (messageString.startsWith('FW_UPDATE_START:')) {
			const messageParts = messageString.split(':');
			const modePart = messageParts[1];
			const delayPart = messageParts[2];
			const base64Content = messageParts[3];
			const buffer = Buffer.from(base64Content, 'base64');
			const fwUpdater = new FwUpdater(canbus,ws);
			fwUpdater.delayUs = parseInt(delayPart) || 300;
			fwUpdater.startUpdateProcedure(buffer,modePart);
			return true
		}
		return false;
	}

	let sniffer;
	async function handleStartSniffer(ws,messageString) {
		if (messageString.startsWith('SNIFFER_START')) {
			const messageParts = messageString.split(':');
			const logerEnabled = messageParts[1] === 'true'
			const filteredIds = messageParts[2].split(';');
			sniffer = new Sniffer(canbus,ws);
			if(logerEnabled)
				await sniffer.setupLogger()
			if(filteredIds.length)
				sniffer.filteredIds = new Set(filteredIds)
			return true
		}
		return false;
	}
	async function handleStopSniffer(messageString) {
		if (messageString.startsWith('SNIFFER_STOP') && sniffer) {
			sniffer.cleanup()
			sniffer = null;
			return true
		}
		return false;
	}
	async function handleFilteredIdSniffer(messageString) {
		if (messageString.startsWith('SNIFFER_FILTEREDIDS_SET') && sniffer) {
			const messageParts = messageString.split(':');
			const filteredIds = messageParts[1].split(';');
			if(filteredIds.length)
				sniffer.filteredIds = new Set(filteredIds)
			return true
		}
		return false;
	}
	async function handleLogEnabledSniffer(messageString) {
		if (messageString.startsWith('SNIFFER_LOG_ENABLE') && sniffer) {
			const messageParts = messageString.split(':');
			const logerEnabled = messageParts[1] === 'true'
			if(logerEnabled)
				await sniffer.setupLogger()
			else
				sniffer.logToFile = null
			return true
		}
		return false;
	}


	wss.on('connection', async (ws) => {
		clients.push(ws);
		console.log('New WebSocket client connected');
		if (!isCheckingPresence) { await checkCanDevicePresenceAndUpdateGlobal(); }
		else { await new Promise(resolve => setTimeout(resolve, 200)); }
		broadcastCanDeviceStatus();

		ws.on('message', async (message) => {
			const messageString = message.toString();
			console.log('Received from UI:', messageString);

			const sendRawWriteStatus = (paramType, success, errorMsg = null) => {
				if (success) {
					ws.send(`ACK: Raw ${paramType} write sequence initiated.`);
				} else {
					ws.send(`NACK: Raw ${paramType} write failed. ${errorMsg || ''}`);
				}
			};
		
			// Helper to send promise results back to UI
			const sendResult = (commandName, promiseResult) => {
				if (!promiseResult) { // Handle cases where the promise might not be returned (e.g., disconnected)
					ws.send(`ERROR: Failed to execute ${commandName}.`);
					return;
				}
				if (promiseResult.success) {
					ws.send(`ACK: ${commandName} successful.`);
				} else {
					ws.send(`NACK: ${commandName} failed. Reason: ${promiseResult.error}${promiseResult.timedOut ? ' (Timeout)' : ''}`);
				}
			};


			try {
				let handled = false;
				if (!handled) handled = await handleConnectionCommands(ws, messageString);
				if (!handled) handled = await handleReadCommands(ws, messageString, sendResult);
				if (!handled) handled = await handleReadRawCommand(ws, messageString, sendResult);
				if (!handled) handled = await handleWriteShortCommands(ws, messageString, sendResult);
				if (!handled) handled = await handleWriteShortRawCommand(ws, messageString, sendResult);
				if (!handled) handled = await handleWriteLongRawParams(ws, messageString, sendRawWriteStatus); // Check RAW before parsed P
				if (!handled) handled = await handleWriteLongRawCustomParams(ws, messageString, sendRawWriteStatus);
				if (!handled) handled = await handleWriteLongParsedParams(ws, messageString);
				if (!handled) handled = await handleWriteLongSpeedParams(ws, messageString);
				if (!handled) handled = await handleWriteLongStringParams(ws, messageString);
				if (!handled) handled = await handleDisplaySpecificWrites(ws, messageString, sendResult);
				if (!handled) handled = await handleStartupAngleCommands(ws, messageString, sendResult);
				if (!handled) handled = await handleRawCanFrame(ws, messageString);
				if (!handled) handled = await handleStartFwUpload(ws, messageString);
				if (!handled) handled = await handleStartSniffer(ws, messageString);
				if (!handled) handled = await handleStopSniffer(messageString);
				if (!handled) handled = await handleFilteredIdSniffer(messageString);
				if (!handled) handled = await handleLogEnabledSniffer(messageString);

				if (!handled) {
					console.warn("Unknown command received from UI (unhandled):", messageString);
					ws.send(`Error: Unknown command format or unhandled: "${messageString}"`);
				}
			} catch (err) {
				console.error('Error processing UI message:', err);
				ws.send(`Error: ${err.message}`);
				await checkCanDevicePresenceAndUpdateGlobal();
				broadcastCanDeviceStatus();
			}
		});


    ws.on('close', () => {
        clients = clients.filter(client => client !== ws);
        console.log('WebSocket client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients = clients.filter(client => client !== ws);
    });
});

	// --- CAN Bus Event Handling ---
	canbus.on('bafang_data_received', (parsedEvent) => {
	   try {
			// --- CONVERT BigInt to String before stringifying ---
			let eventToSend = { ...parsedEvent }; // Create a shallow copy to modify

			if (typeof eventToSend.timestamp_us === 'bigint') {
				eventToSend.timestamp_us = eventToSend.timestamp_us.toString(); // Convert BigInt to String
			}
			const jsonString = JSON.stringify(eventToSend);

			// --- Define types to skip for CONSOLE logging ---
			const typesToSkipInConsoleLog = [
				'display_realtime',
				'controller_realtime_0',
				'controller_state',
				'controller_realtime_1',
				'display_data_1',
				'display_data_2',
				'display_data_lightsensor',
				'controller_speed_params',
				'controller_current_assist_level',
				'controller_calories',
				'display_autoshutdown_time',
				'sensor_realtime',
				'battery_state',
				'battery_capacity',
				'sensor',
				'battery',
				'display',
				'controller'
				// Add any other types you want to omit from the console here
			];

			// --- Only log to console if the type is NOT in the skip list ---
			if (!typesToSkipInConsoleLog.includes(parsedEvent.type)) {
				console.log("Broadcasting Parsed Data:", jsonString); // Log other types
			}
			  broadcastToClients(`BAFANG_DATA: ${jsonString}`);
		} catch (stringifyError) {
			console.error("Error stringifying parsed CAN data:", stringifyError, parsedEvent);
		}
	});

	canbus.on('can_status', async (isConnected, statusMessage) => { // Make async
		console.log("CAN Operational Status Update from canbus.js:", statusMessage, "- IsConnectedFlag:", isConnected);
		if (isConnected && canbus.getConnectedDeviceName()) {
			detectedCanDeviceName = canbus.getConnectedDeviceName();
		} else if (!isConnected) {
			// If disconnected, re-check presence to see if device is still there or gone
			await checkCanDevicePresenceAndUpdateGlobal();
		}
		// If still not set after an init attempt or disconnect, check again.
		// This ensures detectedCanDeviceName is as fresh as possible.
		if (!detectedCanDeviceName && !isConnected) {
			await checkCanDevicePresenceAndUpdateGlobal();
		}
		broadcastCanDeviceStatus();
	});

	// --- Broadcast Helper ---
	function broadcastToClients(message) {
		clients.forEach(client => {
			if (client.readyState === WebSocket.OPEN) {
				try { client.send(message); }
				catch (sendError) { console.error("Error sending to WebSocket client:", sendError); }
			}
		});
	}

	async function periodicCheck() { // Renamed and made async
		if (!canbus.isConnected()) {
			const previousGlobalDeviceName = detectedCanDeviceName;
			await checkCanDevicePresenceAndUpdateGlobal(); // await this

			if (detectedCanDeviceName !== previousGlobalDeviceName) {
				console.log(`Periodic Check: Device presence changed: ${previousGlobalDeviceName || 'None'} -> ${detectedCanDeviceName || 'None'}`);
				broadcastCanDeviceStatus();
			}
		}
	}

	function startPeriodicCanDeviceCheck() {
		if (canDevicePresenceInterval) clearInterval(canDevicePresenceInterval);
		canDevicePresenceInterval = setInterval(periodicCheck, 3000); // Call the async wrapper
	}


	// --- Cleanup ---
	async function cleanup() {
		console.log('Shutting down...');
		if (canDevicePresenceInterval) clearInterval(canDevicePresenceInterval);
		wss.close(() => console.log('WebSocket server closed.'));
		clients.forEach(client => client.terminate());
		await canbus.close();
		server.close(() => {
			console.log('HTTP server closed.');
			process.exit(0);
		});
		setTimeout(() => {
			console.error('Graceful shutdown timed out. Forcing exit.');
			process.exit(1);
		}, 5000);
	}
	process.on('SIGINT', cleanup);
	process.on('SIGTERM', cleanup);

	// --- Start Server ---
	server.listen(8080, async () => { // Make async
		console.log('HTTP+WS server running on http://localhost:8080');
		await checkCanDevicePresenceAndUpdateGlobal(); // await initial check
		startPeriodicCanDeviceCheck();
		console.log(`Initial CAN device state: ${detectedCanDeviceName ? 'Found (' + detectedCanDeviceName + ')' : 'Not Found'}`);
		var start = (process.platform == 'darwin'? 'open': process.platform == 'win32'? 'start': 'xdg-open');
		if(detectedCanDeviceName)
			require('child_process').exec(start + ' ' + 'http://localhost:8080');
	});


	process.on('unhandledRejection', (reason, promise) => {
	  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
	});