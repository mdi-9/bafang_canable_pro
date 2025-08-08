// can-listener.js
"use strict";

const canbus = require('./canbus'); // Import your CAN bus service instance
const fs = require('fs').promises;
const path = require('path');
const logsDir = path.join(__dirname, 'logs');
var logToFile = null
// --- Configuration: IDs to Filter Out ---
// Add CAN IDs (as uppercase hex strings, padded to 8 chars) to this Set
// Frames with these IDs will be completely ignored (not logged, not accumulated).
const filteredIds = new Set([
    '82F83200','82F83201', '82F83202' ,'82F83203','82F83204','82F83205','82F83206','82F83207','82F83208','82F83209','82F8320A','82F8320B', 
	'82F8320A', '82F8320B',
	//'83106300','83106301','83106302','83106303', '83106304',
    //'821A6303','821A6300','82FF1200','83106302'
	]);

// --- State for Frame Accumulation ---
const frameAccumulator = {}; // Stores { lastDataHex: string, count: number, lastTimestamp: number, dlc: number } keyed by idHex

// --- Helper to format raw frame data ---
function formatRawCanFrameData(frame) {
    if (!frame || typeof frame.can_id !== 'number' || typeof frame.can_dlc !== 'number' || !(frame.data instanceof DataView)) {
        return { idHex: "INVALID", dataHex: "INVALID", dlc: 0, timestamp: Date.now() * 1000 };
    }

    const idHex = frame.can_id.toString(16).toUpperCase().padStart(8, '0');
    const dlc = frame.can_dlc;
    const dataBytes = [];

    // Safely read data bytes up to DLC length
    for (let i = 0; i < dlc && i < frame.data.byteLength; i++) {
        dataBytes.push(frame.data.getUint8(i).toString(16).toUpperCase().padStart(2, '0'));
    }
    const dataHex = dataBytes.join(' ');
    // Use frame timestamp if available, otherwise use current time
    const timestamp = frame.timestamp_us || Date.now() * 1000;

    return { idHex, dataHex, dlc, timestamp };
}

// Run this at the start of your script to set up the directory and filename
async function setupLogger() {
  // Ensure the logs directory exists
  try {
    await fs.mkdir(logsDir, { recursive: true });
  } catch (err) {
    console.error('Failed to create log directory:', err);
    process.exit(1);
  }

  // Generate a unique filename for this script run
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
  const logFilePath = path.join(logsDir, `log-${dateStr}-${timeStr}.log`);

  // Return the logging function
  return async function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${message}\n`;
    try {
      await fs.appendFile(logFilePath, logEntry);
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
  };
}

// --- Main Application Logic ---
async function main() {
    console.log("CAN Listener starting...");
    console.log("Filtering IDs:", Array.from(filteredIds)); // Log which IDs are being filtered
    logToFile = await setupLogger();
    // Listen for status updates
    canbus.on('can_status', (isConnected, statusMessage) => {
        console.log(`CAN STATUS: ${statusMessage} (Connected: ${isConnected})`);
        // Clear accumulator on disconnect to avoid stale counts on reconnect
        if (!isConnected) {
             Object.keys(frameAccumulator).forEach(key => delete frameAccumulator[key]);
             console.log("Cleared frame accumulator due to disconnect.");
        }
    });

    // Listen for errors
    canbus.on('can_error', (errorMessage) => {
        console.error(`CAN ERROR: ${errorMessage}`);
    });

    // Listen for RAW frames and implement accumulation + filtering
    canbus.on('raw_frame_received', (rawFrame) => {
        const { idHex, dataHex, dlc, timestamp } = formatRawCanFrameData(rawFrame);

        if (idHex === "INVALID") {
            console.warn("Received invalid frame object, skipping.");
            return;
        }

        // <<< --- FILTERING LOGIC --- >>>
        if (filteredIds.has(idHex)) {
            // Optionally log that a frame was filtered (useful for debugging filters)
            // console.log(`Filtered frame with ID: ${idHex}`);
            return; // Exit the handler, do not log or accumulate this frame
        }
        // <<< --- END FILTERING LOGIC --- >>>


        const currentEntry = frameAccumulator[idHex];

        if (currentEntry) {
            // Frame ID exists in accumulator
            if (dataHex === currentEntry.lastDataHex) {
                // Data is the same as the last one for this ID, increment count
                currentEntry.count++;
                currentEntry.lastTimestamp = timestamp; // Update timestamp of last seen identical frame
            } else {
                // Data has changed for this ID
                // Log the summary of the previous sequence if it repeated
                if (currentEntry.count > 1) {
                    const logMessage = `(${currentEntry.lastTimestamp}) ID: ${idHex} DLC: ${currentEntry.dlc} Data: ${currentEntry.lastDataHex} (Repeated ${currentEntry.count} times)`;
                    console.log(logMessage);
                    logToFile(logMessage)
                }
                // Log the new, different frame
                const logMessage = `(${timestamp}) ID: ${idHex} DLC: ${dlc} Data: ${dataHex}`
                console.log(logMessage);
                logToFile(logMessage)
                // Update the accumulator with the new data and reset count
                currentEntry.lastDataHex = dataHex;
                currentEntry.count = 1;
                currentEntry.dlc = dlc; // Update DLC in case it changed
                currentEntry.lastTimestamp = timestamp;
            }
        } else {
            // First time seeing this non-filtered frame ID (since last change or startup)
            // Log the new frame
            const logMessage = `(${timestamp}) ID: ${idHex} DLC: ${dlc} Data: ${dataHex}`
            console.log(logMessage);
            logToFile(logMessage)
            // Create the entry in the accumulator
            frameAccumulator[idHex] = {
                lastDataHex: dataHex,
                count: 1,
                dlc: dlc, // Store DLC
                lastTimestamp: timestamp
            };
        }
    });

    // Listen for parsed Bafang data (optional, can be commented out)
    /*
    canbus.on('bafang_data_received', (parsedEvent) => {
        console.log(`BAFANG RX (${parsedEvent.type}):`, JSON.stringify(parsedEvent.data, null, 2));
    });
    */

    // Attempt to initialize the CAN connection
    const connected = await canbus.init();

    if (connected) {
        console.log("CAN Bus Initialized. Listening for frames...");
        // Keep the script running while connected
    } else {
        console.error("Failed to initialize CAN Bus. Exiting.");
        process.exit(1); // Exit if connection failed
    }
}

// --- Graceful Shutdown ---
async function cleanup() {
    console.log("\nShutting down CAN listener...");

    // Log final counts for any accumulated frames before closing
    console.log("--- Final Accumulated Frame Counts (Excluding Filtered IDs) ---");
    for (const idHex in frameAccumulator) {
        // No need to check filteredIds here, as they wouldn't be in the accumulator
        const entry = frameAccumulator[idHex];
        if (entry.count > 1) {
            const logMessage = `(${entry.lastTimestamp}) ID: ${idHex} DLC: ${entry.dlc} Data: ${entry.lastDataHex} (Repeated ${entry.count} times)`;
            console.log(logMessage);
            logToFile(logMessage)
        }
    }
    console.log("-------------------------------------------------------------");


    if (canbus.isConnected()) {
        await canbus.close();
    }
    console.log("Cleanup complete.");
    process.exit(0);
}

process.on('SIGINT', cleanup); // Handle Ctrl+C
process.on('SIGTERM', cleanup); // Handle kill commands

// --- Run the listener ---
main().catch(err => {
    console.error("Unhandled error in main listener function:", err);
    process.exit(1);
});