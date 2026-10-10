// Standalone CAN sniffer: prints every frame and, like the old can-listener.js, writes
// them to a log file in logs/. Usage: node sniffer-cli.js [--no-log]
const canbus = require('./canbus'); // Assuming canbus.js handles CAN bus communication
const Sniffer = require('./sniffer');
const logToFile = !process.argv.includes('--no-log');
let sniffer;
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
        sniffer = new Sniffer(canbus);
        // The Sniffer class only writes a file once setupLogger() is called; the UI
        // does that from its checkbox, but this CLI never did, so it logged nothing.
        if (logToFile)
            await sniffer.setupLogger();
        else
            console.log("File logging disabled (--no-log).");
    } catch (error) {
        console.log(error)
        cleanup()
    }
}



// --- Graceful Shutdown ---
async function cleanup() {
    console.log("\nShutting down CAN listener...");
    console.log("-------------------------------------------------------------");
    // Wait for the log to be flushed: exiting straight away could lose the last
    // lines, including the repeat summaries cleanup() writes.
    if (sniffer)
        await sniffer.cleanup();
    if (canbus.isConnected()) {
        await canbus.close();
    }
    console.log("Cleanup complete.");
    process.exit(0);
}

process.on('SIGINT', cleanup); // Handle Ctrl+C
process.on('SIGTERM', cleanup); // Handle kill commands
main();
