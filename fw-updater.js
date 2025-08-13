const { setupLogger, formatRawCanFrameData, delay } = require('./utils');
// --- Configuration Constants ---
const CHUNK_SIZE = 8; // Bytes per chunk
const HEADER_SIZE = 16; // The first 16 hex bytes to be excluded from the data transfer
const delayMs = 2; // Delay between frames (adjust if needed)

class FwUpdater {

    constructor(canbus, ws){
        this.canbus = canbus;
        this.ws = ws;
        this.init()
        this.setupCunbus()
    }
    init(){
        this.firmwareBuffer = null; // Buffer to hold the firmware file content
        this.FIRMWARE_FILE_SIZE = 0; // Will be set after reading the file
        this.NUM_CHUNKS = 0;         // Will be calculated after reading the file
        this.controllerReady =      false; // Flag to track if controler is ready for update
        this.commnad5116008ack =    false; // Flag to track if 5116008 ACK was received
        this.updateProcessStarted = false; // Flag to track if the update process has started
        this.lastChunkConfirmed =   false; // Flag to track if the last chunk has been confirmed
        this.restartConfirmed =     false;
        this.lastChunkId = null; // Will be set after the last chunk number is calculated
        this.timeout = 10000; // 10 seconds timeout;
        this.startTime = Date.now();
        this.progress = 0; // procentage
        this.end = false;
        this.setupForNewMotor()
    }
    setupForNewMotor(){
        this.leadingIdNum = "8"; // The leading number for the ID, e.g., 8 for 82F83200
        this.controllerReadyIdSent = '5114000'; // 5114000 | 5112000
        this.controllerReadyIdAck =  '22A4000'; // 22A4000 | 22A2000
        this.firstPackageId =        '5104001'; // 5104001 | 5142001
        this.firstPackageIdAck =     '22A4001'; // 22A4001 | 22A2001
    }
    setupForOldMotor(){
        this.leadingIdNum = "0";
        this.controllerReadyIdSent = '5112000';
        this.controllerReadyIdAck =  '22A2000';
        this.firstPackageId =        '5142001';
        this.firstPackageIdAck =     '22A2001';
    }
    overallProgress(){
        let progress = this.progress+this.controllerReady+this.updateProcessStarted+this.lastChunkConfirmed-3;
        if(progress < 0)
            return 0;
        else 
            return progress;
    }
    logMessage(message, type = 'INFO',sendOverWS = true) {
        try {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[${timestamp}] [${type}] ${message}`);
            this.logToFile(`[${timestamp}]\t[${type}]\t${message}`);
            if(sendOverWS){
                this.ws.send(`FW_UPDATE_LOG:[${type}] ${message}`);
            }
        }catch( e ) {
            console.log(e, 'ERROR');
        }
    }
    initFile(fileBuffer){
        this.firmwareBuffer = fileBuffer;
        this.FIRMWARE_FILE_SIZE = this.firmwareBuffer.length;
        const dataLength = Math.max(0, this.FIRMWARE_FILE_SIZE - HEADER_SIZE);
        const maxValue = (2 ** (3 * 8)) - 1; 
        if (dataLength < 0 || dataLength > maxValue) { 
            this.logMessage(`File is to big ...`, 'ERROR');
            return false
        } 
        this.NUM_CHUNKS = Math.ceil(dataLength / CHUNK_SIZE);
        this.logMessage(`Firmware file loaded. Size: ${this.FIRMWARE_FILE_SIZE} bytes. Data chunks to send: ${this.NUM_CHUNKS}`, 'INFO');
        const fileHeaderData = Array.from(this.firmwareBuffer.slice(0, 15)).map(byte =>byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        this.logMessage(`File header data: ${fileHeaderData}`, 'INFO');
        return true
    }
    setupCunbus(){
        this.canbus.on('raw_frame_received', (rawFrame) => {
            if(this.end)
                return;
            const { idHex, dataHex, dlc, timestamp } = formatRawCanFrameData(rawFrame);
            if(idHex.startsWith(this.leadingIdNum+"515"))
                return;
            if (idHex === "INVALID") {
                console.warn("Received invalid frame object, skipping.");
                return;
            }
            this.logMessage(`RECIVE ID: ${idHex} DLC: ${dlc} Data: ${dataHex} (Timestamp: ${timestamp})`, 'INFO',false);
            if(idHex.includes(this.controllerReadyIdAck)){
                this.logMessage('Controler is ready for update...', 'INFO');
                this.controllerReady = true;
            }
            if(idHex.includes(this.firstPackageIdAck)){
                this.logMessage('Controler is ready to recive bin file...', 'INFO');
                this.updateProcessStarted = true;
            }
            if(idHex.includes(`22A${this.formatChunkNumber(this.NUM_CHUNKS)}`)){
                this.lastChunkConfirmed = true;
            }
            if(idHex.includes("22A6008")){
                this.logMessage('ACK for 5116008 received.', 'INFO');
                this.commnad5116008ack = true;
            }
            if(idHex.includes("2FF1200")){
                this.logMessage('ACK for restart received.', 'INFO');
                this.restartConfirmed = true;
            }
        });
    }
    async sendRawFrameWithRetry(id,data,retries = 3){
        let sent = false;
        let tryCount = 0;
        //logMessage(`Sending ID:${leadingIdNum+id}`, 'SENT');
        do{
            sent = await this.canbus.sendRawFrame(this.leadingIdNum+id,data);
            if (!sent) {
                this.logMessage(`sendFrame returned false for ID${this.leadingIdNum+id}`, 'ERROR');
                await delay(delayMs);
            }
            tryCount++;
        }while(!sent && tryCount < retries);
    }
    async emitProgress() {
        do{
            try {
                await delay(1000);
                this.ws.send(`FW_UPDATE_PROGRESS:${this.overallProgress()}`);
            }
            catch( e ) {
                //this.logMessage(e, 'ERROR',false);
            }
        }while(!this.end);
    }
    async announceHostReady() {
        this.logMessage('Step 1: Announcing host readiness...', 'INFO');
        do{
            await this.sendRawFrameWithRetry("5FF3005","00",0);
            await delay(delayMs);
        }while(!this.controllerReady && !this.end);
    }
    async checkForControllerReady(){
        this.logMessage('Step 2:Waiting for controler ready state...', 'INFO');
        const first3bytes = [this.firmwareBuffer[0].toString(16).padStart(2, '0'),this.firmwareBuffer[1].toString(16).padStart(2, '0'),'02',this.firmwareBuffer[3].toString(16).padStart(2, '0')]
        do{
            await this.sendRawFrameWithRetry(this.controllerReadyIdSent,first3bytes.join(''));
            await delay(60);
            if (Date.now() - this.startTime > (this.timeout-5000) && this.controllerReadyIdSent == '5114000') {
                this.logMessage('Not responding for this method, trying the old way....', 'INFO');
                this.setupForOldMotor();
            }
            if (Date.now() - this.startTime > this.timeout) {
                this.logMessage('Timeout reached, exiting loop....', 'ERROR');
                break;
            }
        }while(!this.controllerReady);
    }
    async send5116008Id(){
        await this.sendRawFrameWithRetry("5116008","");
        this.startTime = Date.now();
        this.logMessage('Step 2.1: Waiting for acknowledgment of the 5116008 package...', 'INFO');
        do{
            await delay(delayMs);
            if (Date.now() - this.startTime > this.timeout) {
                this.logMessage('Timeout reached, exiting loop....', 'ERROR');
                return false
            }
        }while(!this.commnad5116008ack);
        return true
    }
    async sendFirstPackage() {
        this.logMessage('Step 3: Sending first package (file length)...', 'INFO');

        // The length of the file, minus the first 16 hex bytes, transformed into hex.
        const fileLengthMinus16 = this.FIRMWARE_FILE_SIZE - HEADER_SIZE;
        const hexLength = fileLengthMinus16.toString(16).padStart(6, '0').toUpperCase(); // ## ## ## format

        this.logMessage(`ID:${this.firstPackageId}#${hexLength}`, 'SENT');

        await this.sendRawFrameWithRetry(this.firstPackageId,hexLength);

        //Reset timeout and wait for response
        this.startTime = Date.now();
        this.logMessage('Step 4: Waiting for acknowledgment of the first package...', 'INFO');
        do{
            await delay(delayMs);
            if (Date.now() - this.startTime > this.timeout) {
                this.logMessage('Timeout reached, exiting loop....', 'ERROR');
                break;
                
            }
        }while(!this.updateProcessStarted);
    }
    formatChunkNumber(num) {
        return num.toString(16).padStart(4, '0').toUpperCase();
    }
    getFirmwareChunk(chunkNum) {
        const dataStartIndex = HEADER_SIZE + (chunkNum * CHUNK_SIZE);
        const dataEndIndex = Math.min(dataStartIndex + CHUNK_SIZE, this.FIRMWARE_FILE_SIZE);
        const chunkSlice = this.firmwareBuffer.slice(dataStartIndex, dataEndIndex);
        const chunkData = Array.from(chunkSlice).map(byte =>
            byte.toString(16).padStart(2, '0').toUpperCase()
        ).join('');
        return chunkData;
    }
    async sendDataChunks() {
        this.logMessage('Step 5: Sending data chunks...', 'INFO');
        // Loop through all chunks except the very last one
        for (let i = 0; i < this.NUM_CHUNKS - 1; i++) {
            const chunkId = this.formatChunkNumber(i); // #### incrementing chunk number
            const chunkData = this.getFirmwareChunk(i);
            //this.logMessage(`ID:515${chunkId}#${chunkData} `, 'SENT',false);
            await this.sendRawFrameWithRetry(`515${chunkId}`,chunkData);
            await delay(delayMs);
            this.progress = Math.round((i/this.NUM_CHUNKS)*100);
        }
        this.logMessage('All data chunks (except the last) sent.', 'INFO');
    }
    async sendLastPackageAndEndTransfer() {
        this.logMessage('Step 6: Sending last data package and ending transfer...', 'INFO');

        // The last chunk number is NUM_CHUNKS - 1
        this.lastChunkId = this.formatChunkNumber(this.NUM_CHUNKS - 1);
        // Get the actual content of the last package
        const lastPackageContent = this.getFirmwareChunk(this.NUM_CHUNKS - 1);
        await delay(delayMs);
        this.logMessage(`ID:516${this.lastChunkId}#${lastPackageContent}`, 'SENT');
        await this.sendRawFrameWithRetry(`516${this.lastChunkId}`,lastPackageContent);
        await delay(delayMs);
        //Reset timeout and wait for response
        this.startTime = Date.now();
        this.logMessage('Step 7: Waiting for acknowledgment of the last package...', 'INFO');
        do{
            await delay(delayMs);
            if (Date.now() - this.startTime > (60000)) {
                this.logMessage('Timeout reached, exiting loop....', 'ERROR');
                break;
            }
        }while(!this.lastChunkConfirmed);
        
    }
    async announceFirmwareUpgradeEnd() {
        this.logMessage('Step 8: Announcing firmware upgrade end...', 'INFO');
        await this.sendRawFrameWithRetry("5FF3005","01");
        await delay(delayMs);
        // this.startTime = Date.now();
        // this.logMessage('Step 8: Waiting for restart...', 'INFO');
        // do{
        //     await delay(delayMs);
        //     if (Date.now() - this.startTime > this.timeout) {
        //         this.logMessage('Timeout reached for restart, manual may be required....', 'WARN');
        //         break;
        //     }
        // }while(!this.restartConfirmed);
        // await this.sendRawFrameWithRetry("5F83501","00");
        await delay(100);
    }

    async startUpdateProcedure(fileBuffer) {
        try {
            this.logToFile = await setupLogger();
            this.init();
            let fileReady = this.initFile(fileBuffer);
            if(!fileReady)
                throw "File not ready";
            this.emitProgress()
            this.announceHostReady();
            await this.checkForControllerReady();
            if(!this.controllerReady)
                throw "Controler do not respond to update commands.";
            await delay(delayMs);
            if(this.controllerReadyIdSent == '5114000'){
                await this.send5116008Id();
                if(!this.commnad5116008ack)
                    throw "No ACK for 5116008";
            }
            await delay(delayMs);
            await this.sendFirstPackage();
            await delay(delayMs);
            if(!this.updateProcessStarted)
                throw "No ACK for first package";
            await this.sendDataChunks();
            await delay(delayMs);
            await this.sendLastPackageAndEndTransfer();
            await delay(delayMs);
            if(!this.lastChunkConfirmed)
                throw "No ACK for last package";
            await this.announceFirmwareUpgradeEnd();
            if(this.lastChunkConfirmed)
                this.logMessage('Firmware update completed successfully!', 'INFO');
            
            this.end = true
        } catch (error) {
            this.logMessage(error, 'ERROR');
            this.end = true
            this.logMessage('Firmware update failed or was not completed.', 'ERROR');
        } finally {
            this.ws.send(`FW_UPDATE_END`);
        }
    }

}

module.exports = FwUpdater;