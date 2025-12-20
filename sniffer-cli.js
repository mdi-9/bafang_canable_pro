const canbus = require('./canbus'); // Assuming canbus.js handles CAN bus communication
const Sniffer = require('./sniffer');
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
        
    } catch (error) {
        console.log(error)
        cleanup()
    }
}



// --- Graceful Shutdown ---
async function cleanup() {
    console.log("\nShutting down CAN listener...");
    console.log("-------------------------------------------------------------");
    sniffer.cleanup();
    if (canbus.isConnected()) {
        await canbus.close();
    }
    console.log("Cleanup complete.");
    process.exit(0);
}

process.on('SIGINT', cleanup); // Handle Ctrl+C
process.on('SIGTERM', cleanup); // Handle kill commands
main();