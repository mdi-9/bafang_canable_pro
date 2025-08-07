/**
 * CANBUS Controller Update Simulation (Node.js Console Program)
 *
 * This script simulates a firmware update procedure for a CAN bus controller,
 * now supporting reading firmware data from a specified file.
 *
 * Usage: node canbusUpdate.js <path_to_firmware_file>
 *
 * Steps simulated:
 * 1. Continuously announce host readiness.
 * 2. Wait for controller response and stop announcements.
 * 3. Send the first package (firmware file length).
 * 4. Wait for acknowledgment of the first package.
 * 5. Send firmware data in 8-byte chunks, waiting for acknowledgment after each.
 * 6. Send the last data package and signal transfer completion.
 *
 * All communication is simulated using console logs and `setTimeout` for delays.
 */

const fs = require('fs'); // Node.js File System module for reading files
const path = require('path'); // Node.js Path module for resolving file paths
const canbus = require('./canbus'); // Assuming canbus.js handles CAN bus communication
const { DeviceNetworkId, CanOperation } = require('./bafang-constants');
const { generateCanFrameId, bafangIdArrayTo32Bit } = require('./bafang-parser');
const { CanReadCommandsList } = require('./bafang-can-read-commands');
const { CanWriteCommandsList } = require('./bafang-can-write-commands');
// --- Configuration Constants ---
const CHUNK_SIZE = 8; // Bytes per chunk
const HEADER_SIZE = 16; // The first 16 hex bytes to be excluded from the data transfer

// --- Global Variables ---
let updateInterval = null; // To hold the interval ID for announcements
let firmwareBuffer = null; // Buffer to hold the firmware file content
let FIRMWARE_FILE_SIZE = 0; // Will be set after reading the file
let NUM_CHUNKS = 0;         // Will be calculated after reading the file
let updateProcessStarted = false; // Flag to track if the update process has started

// --- Utility Functions ---

/**
 * Formats a number into a 4-character hexadecimal string, padded with leading zeros.
 * @param {number} num - The number to format.
 * @returns {string} The formatted hexadecimal string.
 */
function formatChunkNumber(num) {
    return num.toString(16).padStart(4, '0').toUpperCase();
}

/**
 * Extracts and formats a simulated firmware data chunk from the loaded buffer.
 * @param {number} chunkNum - The index of the chunk.
 * @returns {string} A space-separated string of hex bytes representing the chunk data.
 */
function getFirmwareChunk(chunkNum) {
    // Calculate the starting byte index for this chunk, relative to the data portion
    // (i.e., after the initial HEADER_SIZE bytes)
    const dataStartIndex = HEADER_SIZE + (chunkNum * CHUNK_SIZE);
    const dataEndIndex = Math.min(dataStartIndex + CHUNK_SIZE, FIRMWARE_FILE_SIZE);

    // Extract the slice from the firmwareBuffer
    const chunkSlice = firmwareBuffer.slice(dataStartIndex, dataEndIndex);

    // Convert each byte in the slice to a 2-character hex string and join with spaces
    const chunkData = Array.from(chunkSlice).map(byte =>
        byte.toString(16).padStart(2, '0').toUpperCase()
    ).join(' ');

    return chunkData;
}

/**
 * Logs a message to the console with a type prefix for clarity.
 * @param {string} message - The message to log.
 * @param {string} type - The type of message ('INFO', 'SENT', 'RECEIVED', 'ERROR').
 */
function logMessage(message, type = 'INFO') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

/**
 * Creates a promise that resolves after a specified delay.
 * Useful for simulating asynchronous operations and network delays.
 * @param {number} ms - The delay in milliseconds.
 * @returns {Promise<void>} A promise that resolves after the delay.
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Firmware Update Procedure Steps ---

/**
 * Step 1 & 2: Starts continuously announcing that the host (PC) is ready to transfer a firmware update.
 * Waits for the Controller response and stops announcements once received.
 * @returns {Promise<void>} A promise that resolves when the controller responds.
 */
async function announceHostReady() {
    logMessage('Step 1: Announcing host readiness...', 'INFO');
    // Start sending polling messages repeatedly
    updateInterval = setInterval(() => {
        const canId32bit = bafangIdArrayTo32Bit(generateCanFrameId(DeviceNetworkId.BESST, DeviceNetworkId.BROADCAST, CanOperation.MULTIFRAME_WARNING, 0x30, 0x05));
        canbus.sendFrame(`${canId32bit.toString(16).padStart(8, '0')}#00`);
    }, 500); // Announce every 500 milliseconds

    await delay(4000);
    do{
        
        const first4bytes = Buffer.concat([firmwareBuffer.slice(0, 2), Buffer.from([0x02, 0x00])])
        const result = await canbus.readParameter(DeviceNetworkId.DRIVE_UNIT, CanReadCommandsList.FwUpdateReadyCheck,first4bytes);
        //const result = await canbus.writeShortParameterWithAck(DeviceNetworkId.DRIVE_UNIT, CanWriteCommandsList.FwUpdateReadyCheck, [0x88, 0x45, 0x02, 0x00]);
        if (result && result.success) {
            logMessage('Controller responded to firmware update readiness check.', 'INFO');
            updateProcessStarted = true; // Set flag to indicate the process has started
            clearInterval(updateInterval); // Stop announcing
            break; // Exit the loop if response is received
        } else {
            logMessage('No response from controller yet, retrying...', 'INFO');
            await delay(3000);
        }
    }while(!updateProcessStarted);
}

/**
 * Step 3 & 4: Sends the first package containing the length of the firmware file
 * (minus the first 16 hex bytes) and waits for acknowledgment.
 * @returns {Promise<void>} A promise that resolves when the first package is acknowledged.
 */
async function sendFirstPackage() {
    logMessage('Step 3: Sending first package (file length)...', 'INFO');

    // The length of the file, minus the first 16 hex bytes, transformed into hex.
    const fileLengthMinus16 = FIRMWARE_FILE_SIZE - HEADER_SIZE;
    const hexLength = fileLengthMinus16.toString(16).padStart(6, '0').toUpperCase(); // ## ## ## format

    logMessage(`05142001 - ${hexLength} (Transfer started from BESST, contains length in hex)`, 'SENT');

    // Simulate response for first package
    await delay(2000); // Simulate 2-second delay for acknowledgment
    logMessage('022A2001 - 00 (Transfer start ack from Controller)', 'RECEIVED');
    logMessage('Step 4: Controller acknowledged first package.', 'INFO');
}

/**
 * Step 5: Sends firmware data in 8-byte chunks. Each chunk is numbered incrementally.
 * Waits for an acknowledgment after each chunk.
 * Does NOT send the very last data package.
 * @returns {Promise<void>} A promise that resolves when all but the last data chunks are sent and acknowledged.
 */
async function sendDataChunks() {
    logMessage('Step 5: Sending data chunks...', 'INFO');
    // Loop through all chunks except the very last one
    for (let i = 0; i < NUM_CHUNKS - 1; i++) {
        const chunkId = formatChunkNumber(i); // #### incrementing chunk number
        const chunkData = getFirmwareChunk(i); // XX XX XX XX XX XX XX XX
        if(i < 5 || i > NUM_CHUNKS - 5){
            logMessage(`0515${chunkId} - ${chunkData} (Data transfer package)`, 'SENT');

            // Wait for acknowledgment for the current chunk
            //await delay(1); // Simulate quick acknowledgment for each chunk (100ms)
            logMessage(`022A${chunkId} - (Data transfer package ack from controller)`, 'RECEIVED');
        }
    }
    logMessage('All data chunks (except the last) sent.', 'INFO');
}

/**
 * Step 6: Sends the last data package to a different FrameID to signal transfer completion.
 * Waits for the final acknowledgment.
 * @returns {Promise<void>} A promise that resolves when the last package is sent and acknowledged.
 */
async function sendLastPackageAndEndTransfer() {
    logMessage('Step 6: Sending last data package and ending transfer...', 'INFO');

    // The last chunk number is NUM_CHUNKS - 1
    const lastChunkId = formatChunkNumber(NUM_CHUNKS - 1);
    // Get the actual content of the last package
    const lastPackageContent = getFirmwareChunk(NUM_CHUNKS - 1);

    logMessage(`0516${lastChunkId} - ${lastPackageContent} (Transfer completed from BESST)`, 'SENT');

    // Simulate response for the last package
    await delay(2000); // Simulate 2-second delay for final acknowledgment
    logMessage(`022A${lastChunkId} - (Data transfer packages ack from controller)`, 'RECEIVED');
    logMessage('Firmware update completed successfully!', 'INFO');
}

// --- Helper to format raw frame data ---
// function formatRawCanFrameData(frame) {
//     if (!frame || typeof frame.can_id !== 'number' || typeof frame.can_dlc !== 'number' || !(frame.data instanceof DataView)) {
//         return { idHex: "INVALID", dataHex: "INVALID", dlc: 0, timestamp: Date.now() * 1000 };
//     }

//     const idHex = frame.can_id.toString(16).toUpperCase().padStart(8, '0');
//     const dlc = frame.can_dlc;
//     const dataBytes = [];

//     // Safely read data bytes up to DLC length
//     for (let i = 0; i < dlc && i < frame.data.byteLength; i++) {
//         dataBytes.push(frame.data.getUint8(i).toString(16).toUpperCase().padStart(2, '0'));
//     }
//     const dataHex = dataBytes.join(' ');
//     // Use frame timestamp if available, otherwise use current time
//     const timestamp = frame.timestamp_us || Date.now() * 1000;

//     return { idHex, dataHex, dlc, timestamp };
// }

/**
 * Main function to orchestrate the entire firmware update procedure.
 * Handles the sequence of steps and basic error logging.
 */
async function startUpdateProcedure() {
    // Check for command-line argument
    const firmwareFilePath = process.argv[2]; // Node.js arguments are at index 2 onwards

    if (!firmwareFilePath) {
        logMessage('ERROR: Please provide the path to the firmware file as an argument.', 'ERROR');
        logMessage('Usage: node canbusUpdate.js <path_to_firmware_file>', 'INFO');
        process.exit(1); // Exit with an error code
    }

    const absolutePath = path.resolve(firmwareFilePath);
    logMessage(`Attempting to read firmware from: ${absolutePath}`, 'INFO');

    try {
        // Read the firmware file synchronously for simplicity in this simulation
        //In a real application, consider async fs.readFile for large files
        firmwareBuffer = fs.readFileSync(absolutePath);
        FIRMWARE_FILE_SIZE = firmwareBuffer.length;

        // Calculate NUM_CHUNKS based on the actual file size and header
        // The data portion starts after the HEADER_SIZE bytes.
        const dataLength = Math.max(0, FIRMWARE_FILE_SIZE - HEADER_SIZE);
        NUM_CHUNKS = Math.ceil(dataLength / CHUNK_SIZE);

        logMessage(`Firmware file loaded. Size: ${FIRMWARE_FILE_SIZE} bytes. Data chunks to send: ${NUM_CHUNKS}`, 'INFO');
        logMessage(`First 4 bytes: ${Buffer.concat([firmwareBuffer.slice(0, 2), Buffer.from([0x02, 0x00])]).toString('hex')}`, 'INFO');
        // Listen for status updates
        canbus.on('can_status', (isConnected, statusMessage) => {
            console.log(`CAN STATUS: ${statusMessage} (Connected: ${isConnected})`);
        });
    
        // Listen for errors
        canbus.on('can_error', (errorMessage) => {
            console.error(`CAN ERROR: ${errorMessage}`);
        });

        // canbus.on('raw_frame_received', (rawFrame) => {
        //     const { idHex, dataHex, dlc, timestamp } = formatRawCanFrameData(rawFrame);
    
        //     if (idHex === "INVALID") {
        //         console.warn("Received invalid frame object, skipping.");
        //         return;
        //     }
        //     console.log(`ID: ${idHex} DLC: ${dlc} Data: ${dataHex} (Timestamp: ${timestamp})`);
        // });

        // Attempt to initialize the CAN connection
        const connected = await canbus.init();
    
        if (connected) {
            console.log("CAN Bus Initialized. Listening for frames...");
            // Keep the script running while connected
        } else {
            console.error("Failed to initialize CAN Bus. Exiting.");
            process.exit(1); // Exit if connection failed
        }

        await announceHostReady();
        if(updateProcessStarted){
            logMessage('Starting firmware update procedure...', 'INFO');
            // await sendFirstPackage();
            // await sendDataChunks();
            // await sendLastPackageAndEndTransfer();
        }else{
            logMessage('Firmware update process not started.', 'ERROR');
        }
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            logMessage(`ERROR: File not found at ${absolutePath}. Please check the path.`, 'ERROR');
        }
        console.error('Detailed error:', error);
        process.exit(1); // Exit with an error code
    } finally {
        logMessage('CANBUS Firmware Update Simulation Finished.', 'INFO');
        // Ensure any remaining intervals are cleared if the process exits unexpectedly
        if (updateInterval) {
            clearInterval(updateInterval);
        }
    }
}

// --- Graceful Shutdown ---
async function cleanup() {
    console.log("\nShutting down CAN listener...");
    console.log("-------------------------------------------------------------");

    if (canbus.isConnected()) {
        await canbus.close();
    }
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    console.log("Cleanup complete.");
    process.exit(0);
}

process.on('SIGINT', cleanup); // Handle Ctrl+C
process.on('SIGTERM', cleanup); // Handle kill commands
startUpdateProcedure();