const { setupLogger, formatRawCanFrameData } = require('./utils');

class Sniffer {

    logToFile = null;
    filteredIds = new Set([
        '82F83200','82F83201', '82F83202' ,'82F83203','82F83204','82F83205','82F83206','82F83207','82F83208','82F83209','82F8320A','82F8320B', 
        '82F8320A', '82F8320B',
        //'83106300','83106301','83106302','83106303', '83106304',
        //'821A6303','821A6300','82FF1200','83106302'
	]);
    frameAccumulator = {};

    constructor(canbus, ws=null){
        this.canbus = canbus;
        this.ws = ws;
        this.canbus.on('raw_frame_received',this.rawFrameRecived);
        this.logMessage(`Listeaning for frames...`);
    }

    logMessage(message, type = 'INFO',sendOverWS = true) {
        try {
            const timestamp = new Date().toLocaleTimeString();
            if(sendOverWS)
                console.log(`[${timestamp}] [${type}] ${message}`);
            if(this.logToFile)
                this.logToFile(`[${timestamp}]\t[${type}]\t${message}`);
            if(sendOverWS && this.ws){
                this.ws.send(`SNIFFER_ENTRY:[${timestamp}]\t[${type}]\t${message}`);
            }
        }catch( e ) {
            console.log(e, 'ERROR');
        }
    }

    async setupLogger(){
        this.logToFile = await setupLogger()
    }

    rawFrameRecived = (rawFrame)=>{
        const { idHex, dataHex, dlc, timestamp } = formatRawCanFrameData(rawFrame);
        if (idHex === "INVALID") {
            console.warn("Received invalid frame object, skipping.");
            return;
        }
        //this.logMessage(`RECIVE ID: ${idHex} DLC: ${dlc} Data: ${dataHex} (Timestamp: ${timestamp})`, 'INFO',false);

        // <<< --- FILTERING LOGIC --- >>>
        if (this.filteredIds.has(idHex)) {
            // Optionally log that a frame was filtered (useful for debugging filters)
            // console.log(`Filtered frame with ID: ${idHex}`);
            return; // Exit the handler, do not log or accumulate this frame
        }
        // <<< --- END FILTERING LOGIC --- >>>


        const currentEntry = this.frameAccumulator[idHex];

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
                    const logMessage = `${currentEntry.lastTimestamp}\tID:${idHex}\tDLC:${currentEntry.dlc}\tData:${currentEntry.lastDataHex}\t(Repeated ${currentEntry.count} times)`;
                    this.logMessage(logMessage);
                }
                // Log the new, different frame
                const logMessage = `${timestamp}\tID:${idHex}\tDLC:${dlc}\tData:${dataHex}`
                this.logMessage(logMessage)
                // Update the accumulator with the new data and reset count
                currentEntry.lastDataHex = dataHex;
                currentEntry.count = 1;
                currentEntry.dlc = dlc; // Update DLC in case it changed
                currentEntry.lastTimestamp = timestamp;
            }
        } else {
            // First time seeing this non-filtered frame ID (since last change or startup)
            // Log the new frame
            const logMessage = `${timestamp}\tID:${idHex}\tDLC:${dlc}\tData:${dataHex}`
            this.logMessage(logMessage)
            // Create the entry in the accumulator
            this.frameAccumulator[idHex] = {
                lastDataHex: dataHex,
                count: 1,
                dlc: dlc, // Store DLC
                lastTimestamp: timestamp
            };
        }
    }

    cleanup(){
        this.canbus.removeListener('raw_frame_received', this.rawFrameRecived);
        for (const idHex in this.frameAccumulator) {
            // No need to check filteredIds here, as they wouldn't be in the accumulator
            const entry = this.frameAccumulator[idHex];
            if (entry.count > 1) {
                const logMessage = `${entry.lastTimestamp}\tID:${idHex}\tDLC:${entry.dlc}\tData:${entry.lastDataHex}\t(Repeated ${entry.count} times)`;
                this.logMessage(logMessage)
            }
        }
        this.logMessage(`Stoping sniffer...`);
    }
}

module.exports = Sniffer;