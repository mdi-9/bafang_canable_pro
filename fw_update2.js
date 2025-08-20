const fs = require('fs'); // Node.js File System module for reading files
const path = require('path'); // Node.js Path module for resolving file paths
const canbus = require('./canbus'); // Assuming canbus.js handles CAN bus communication
const FwUpdater = require('./fw-updater');

async function main(){

    const firmwareFilePath = process.argv[2]; // Node.js arguments are at index 2 onwards
    if (!firmwareFilePath) {
        process.exit(1); // Exit with an error code
    }
    const absolutePath = path.resolve(firmwareFilePath);
    const buffer = fs.readFileSync(absolutePath);

    const connected = await canbus.init();

    if (connected) {
        console.log("CAN Bus Initialized. Listening for frames...");
        // Keep the script running while connected
    } else {
        console.error("Failed to initialize CAN Bus. Exiting.");
        process.exit(1); // Exit if connection failed
    }
    const fwUpdater = new FwUpdater(canbus);
    await fwUpdater.startUpdateProcedure(buffer);
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
main();