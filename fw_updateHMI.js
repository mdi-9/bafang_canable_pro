const fs = require('fs'); // Node.js File System module for reading files
const path = require('path'); // Node.js Path module for resolving file paths
const canbus = require('./canbus'); // Assuming canbus.js handles CAN bus communication
const { setupLogger, formatRawCanFrameData } = require('./utils');
// --- Configuration Constants ---
const CHUNK_SIZE = 8; // Bytes per chunk
const HEADER_SIZE = 16; // The first 16 hex bytes to be excluded from the data transfer
const delayMs = 1; // Delay between frames (adjust if needed)
// --- Global Variables ---
let firmwareBuffer = null; // Buffer to hold the firmware file content
let FIRMWARE_FILE_SIZE = 0; // Will be set after reading the file
let NUM_CHUNKS = 0;         // Will be calculated after reading the file
let controllerReady =       false; // Flag to track if controler is ready for update
let commnad6008ack =     false; // Flag to track if 5116008 ACK was received
let updateProcessStarted =  false; // Flag to track if the update process has started
let firstChunkACK =         false;
let lastChunkId = null; // Will be set after the last chunk number is calculated
let lastChunkConfirmed = false; // Flag to track if the last chunk has been confirmed
const timeout = 10000; // 5 seconds timeout;
let startTime = Date.now();
let logToFile = null; // Function to log messages to a file
let leadingIdNum = "8"; // The leading number for the ID, e.g., 8 for 82F83200
let controllerReadyIdSent = '5194000'; // 5114000 | 5112000
let controllerReadyIdAck =  '32A4000'; // 32A4000 | 32A2000
let firstPackageId =        '5184001'; // 5104001 | 5142001
let firstPackageIdAck =     '32A4001'; // 32A4001 | 32A2001
let lastChunkSendIndex = -1;
let chunksACKObject = {}; // Object to track ACKs for each chunk

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
    ).join('');

    return chunkData;
}

async function reSendSecificChunk(hexId){
    let i = parseInt('0x'+hexId)
    lastChunkSendIndex = i;
    const chunkData = getFirmwareChunk(i); // XXXXXXXXXXXXXXXX
    logMessage(`ID:51D${hexId}#${chunkData} `, 'RESENT');
    await sendRawFrameWithRetry(`51D${hexId}`,chunkData);
}

function logMessage(message, type = 'INFO') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${type}] ${message}`);
    logToFile(`[${timestamp}]\t[${type}]\t${message}`);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendRawFrameWithRetry(id,data,retries = 3){
    let sent = false;
    let tryCount = 0;
    //logMessage(`Sending ID:${leadingIdNum+id}`, 'SENT');
    do{
        sent = await canbus.sendRawFrame(leadingIdNum+id,data);
        if (!sent) {
            logMessage(`sendFrame returned false for ID${leadingIdNum+id}`, 'ERROR');
            await delay(delayMs);
        }
        tryCount++;
    }while(!sent && tryCount < retries);
}


// --- Firmware Update Procedure Steps ---
/**
 * Step 1: Starts continuously announcing that the host (PC) is ready to transfer a firmware update.
 * Waits for the Controller response and stops announcements once received.
 * @returns {Promise<void>} A promise that resolves when the controller responds.
 */
async function announceHostReady() {
    logMessage('Step 1: Announcing host readiness...', 'INFO');
    do{
        await sendRawFrameWithRetry("5FF3005","00",0);
        await delay(delayMs);
    }while(!controllerReady);
}
/**
 * Step 2: Starts continuously asking for ack to controller ready.
 * Waits for the Controller response and stops announcements once received.
 * @returns {Promise<void>} A promise that resolves when the controller responds.
 */
async function checkForControllerReady(){
    logMessage('Step 2:Waiting for controler ready state...', 'INFO');
    const first3bytes = [firmwareBuffer[0].toString(16).padStart(2, '0'),firmwareBuffer[1].toString(16).padStart(2, '0'),'03',firmwareBuffer[3].toString(16).padStart(2, '0')]
    do{
        await sendRawFrameWithRetry(controllerReadyIdSent,first3bytes.join(''));
        await delay(30);  // ---------------------------------------  was 60 but too much space between this one and 5FF3005 (for now)
        if (Date.now() - startTime > timeout) {
            logMessage('Timeout reached, exiting loop....', 'ERROR');
            break;
        }
    }while(!controllerReady);
}

// Optional step 2.1 unknown id 5196008
async function send5196008Id(){
    await sendRawFrameWithRetry("5196008","");
    startTime = Date.now();
    logMessage('Step 2.1: Waiting for acknowledgment of the 5196008 package...', 'INFO');
    do{
        await delay(delayMs);
        if (Date.now() - startTime > timeout) {
            logMessage('Timeout reached, exiting loop....', 'ERROR');
            process.exit(1);
        }
    }while(!commnad6008ack);
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

    logMessage(`ID:${firstPackageId}#${hexLength}`, 'SENT');

    await sendRawFrameWithRetry(firstPackageId,hexLength);

    //Reset timeout and wait for response
    startTime = Date.now();
    logMessage('Step 4: Waiting for acknowledgment of the first package...', 'INFO');
    do{
        await delay(delayMs);
          if (Date.now() - startTime > timeout) {
            logMessage('Timeout reached, exiting loop....', 'ERROR');
            break;
            
        }
    }while(!updateProcessStarted);
}

async function sendFirstChunk() {
    const chunkId0 = formatChunkNumber(0); // #### incrementing chunk number
    const chunkData0 = getFirmwareChunk(0); // XXXXXXXXXXXXXXXX
    await sendRawFrameWithRetry(`51C${chunkId0}`,chunkData0);
    await delay(delayMs);
    const chunkId1 = formatChunkNumber(1); // #### incrementing chunk number
    const chunkData1 = getFirmwareChunk(1); // XXXXXXXXXXXXXXXX
    await sendRawFrameWithRetry(`51D${chunkId1}`,chunkData1); 
    startTime = Date.now();
    logMessage('Step 4.1: Waiting for acknowledgment of the first chunk...', 'INFO');
    do{
        await delay(delayMs);
        if (Date.now() - startTime > timeout) {
            logMessage('Timeout reached, exiting loop....', 'ERROR');
            process.exit(1);
        }
    }while(!firstChunkACK);
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
    for (let i = 2; i < NUM_CHUNKS - 1; i++) {
        const chunkId = formatChunkNumber(i); // #### incrementing chunk number
        const chunkData = getFirmwareChunk(i); // XXXXXXXXXXXXXXXX
        //logMessage(`ID:51D${chunkId}#${chunkData} `, 'SENT');
        process.stdout.write(`\rUploading firmware... ${((i/NUM_CHUNKS)*100).toFixed(1)}%`);
        lastChunkSendIndex = i;
        await sendRawFrameWithRetry(`51D${chunkId}`,chunkData);
        if ((i - 2) % 4096 === 0 && i!==2) {
            startTime = Date.now();
            do{
                await delay(delayMs);
                if (Date.now() - startTime > timeout) {
                    logMessage('Timeout reached, exiting loop....', 'ERROR');
                    process.exit(0);
                }
            }while(!chunksACKObject[i]);
        } else await delay(delayMs);
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
    lastChunkId = formatChunkNumber(NUM_CHUNKS - 1);
    // Get the actual content of the last package
    const lastPackageContent = getFirmwareChunk(NUM_CHUNKS - 1);

    logMessage(`ID:51E${lastChunkId}#${lastPackageContent}`, 'SENT');
    await sendRawFrameWithRetry(`51E${lastChunkId}`,lastPackageContent);
    //Reset timeout and wait for response
    startTime = Date.now();
    logMessage('Step 7: Waiting for acknowledgment of the last package...', 'INFO');
    do{
        await delay(1000);
        if (Date.now() - startTime > (60000)) {
            logMessage('Timeout reached, exiting loop....', 'ERROR');
            break;
        }
        if(!lastChunkConfirmed)
             sendRawFrameWithRetry(`51E${lastChunkId}`,lastPackageContent);
    }while(!lastChunkConfirmed);
    
}

async function announceFirmwareUpgradeEnd() {
    logMessage('Step 7: Announcing firmware upgrade end...', 'INFO');
    await delay(4000);
    await sendRawFrameWithRetry("5FF3005","01");
    await delay(2000);
}

/**
 * Main function to orchestrate the entire firmware update procedure.
 * Handles the sequence of steps and basic error logging.
 */
async function startUpdateProcedure() {
    logToFile = await setupLogger();
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
        const maxValue = (2 ** (3 * 8)) - 1; 
        if (dataLength < 0 || dataLength > maxValue) { 
            logMessage(`File is to big ...`, 'ERROR');
            process.exit(1); // Exit if connection failed
        } 
        NUM_CHUNKS = Math.ceil(dataLength / CHUNK_SIZE);

        logMessage(`Firmware file loaded. Size: ${FIRMWARE_FILE_SIZE} bytes. Data chunks to send: ${NUM_CHUNKS}`, 'INFO');

        const fileHeaderData = Array.from(firmwareBuffer.slice(0, 15)).map(byte =>byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');

        logMessage(`File header data: ${fileHeaderData}`, 'INFO');

        // let byte4 = firmwareBuffer[4].toString(16).padStart(2, '0').toUpperCase()
        // if(byte4 === "00"){
        //     logMessage('Detected old motor firmware format, setting up for old way...', 'INFO');
        //     setupForOldMotor();
        // }
        // Listen for status updates
        canbus.on('can_status', (isConnected, statusMessage) => {
            console.log(`CAN STATUS: ${statusMessage} (Connected: ${isConnected})`);
        });
    
        // Listen for errors
        // canbus.on('can_error', (errorMessage) => {
        //     console.error(`CAN ERROR: ${errorMessage}`);
        // });

        canbus.on('raw_frame_received', (rawFrame) => {
            const { idHex, dataHex, dlc, timestamp } = formatRawCanFrameData(rawFrame);
            if (idHex === "INVALID") {
                console.warn("Received invalid frame object, skipping.");
                return;
            }
            logMessage(`RECIVE ID: ${idHex} DLC: ${dlc} Data: ${dataHex} (Timestamp: ${timestamp})`, 'INFO');
            if(idHex.includes(controllerReadyIdAck)){
                logMessage('Controler is ready for update...', 'INFO');
                controllerReady = true;
            }
            if(idHex.includes(firstPackageIdAck)){
                logMessage('Controler is ready to recive bin file...', 'INFO');
                updateProcessStarted = true;
            }
            if(idHex.includes(`32A${formatChunkNumber(NUM_CHUNKS)}`) || idHex.includes(`32A${formatChunkNumber(NUM_CHUNKS-1)}`)){
                lastChunkConfirmed = true;
            }
            if(idHex.includes("32A6008")){
                logMessage('ACK for 5196008 received.', 'INFO');
                commnad6008ack = true;
            }
            if(lastChunkSendIndex >= 0 && idHex.includes(`32A${formatChunkNumber(lastChunkSendIndex)}`)){
                //logMessage(`ACK for chunk ${lastChunkSendIndex} received.`, 'INFO');
                chunksACKObject[lastChunkSendIndex] = true; // Mark this chunk as acknowledged
            }
            if(idHex.includes(`32A0002`)){
                firstChunkACK = true;
            }
            if(idHex.startsWith(`${leadingIdNum}32B`)){
                //reSendSecificChunk(idHex.substring(4))
            }
        });

        // Attempt to initialize the CAN connection
        const connected = await canbus.init();
    
        if (connected) {
            console.log("CAN Bus Initialized. Listening for frames...");
            // Keep the script running while connected
        } else {
            console.error("Failed to initialize CAN Bus. Exiting.");
            process.exit(1); // Exit if connection failed
        }
        // Wait for cunbus to be stable
        await delay(3000);

        //setupForOldMotor();
        announceHostReady();
        await checkForControllerReady();
        if(controllerReady){
            logMessage('Starting firmware update procedure...', 'INFO');
            await delay(20);
            if(controllerReadyIdSent == '5194000'){
                await send5196008Id(); 
                await delay(20);
            }
            await sendFirstPackage();
            await delay(20);
            if(updateProcessStarted){
                await sendFirstChunk();
                await delay(delayMs);
                await sendDataChunks();
                await delay(delayMs);
                await sendLastPackageAndEndTransfer();
                await delay(20);
                if(lastChunkConfirmed){
                    await announceFirmwareUpgradeEnd();
                }
            }
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
        if(lastChunkConfirmed){
            logMessage('Firmware update completed successfully!', 'INFO');
        }else{
            logMessage('Firmware update failed or was not completed.', 'ERROR');
        }
        await cleanup()
    }
}

// --- Graceful Shutdown ---
async function cleanup() {
    console.log("\nShutting down CAN listener...");
    console.log("-------------------------------------------------------------");

    if (canbus.isConnected()) {
        await canbus.close();
    }
    console.log("Cleanup complete.");
    process.exit(0);
}

process.on('SIGINT', cleanup); // Handle Ctrl+C
process.on('SIGTERM', cleanup); // Handle kill commands
startUpdateProcedure();