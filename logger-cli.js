const canbus = require('./canbus'); // Assuming canbus.js handles CAN bus communication
const Logger = require('./logger');
let logger;
async function main(){

    const connected = await canbus.init();

    if (connected) {
        console.log("CAN Bus Initialized. Listening for frames...");
        // Keep the script running while connected
    } else {
        console.error("Failed to initialize CAN Bus. Exiting.");
        process.exit(1); // Exit if connection failed
    }
    try {
        logger = new Logger(canbus);
        await logger.setupLogger(true);
        await logger.setupHeader();
        logger.startLogging();
    } catch (error) {
        console.log(error)
        cleanup()
    }
}



// --- Graceful Shutdown ---
async function cleanup() {
    console.log("\nShutting down...");
    console.log("-------------------------------------------------------------");
    logger.cleanup();
    if (canbus.isConnected()) {
        await canbus.close();
    }
    console.log("Cleanup complete.");
    process.exit(0);
}

process.on('SIGINT', cleanup); // Handle Ctrl+C
process.on('SIGTERM', cleanup); // Handle kill commands
main();