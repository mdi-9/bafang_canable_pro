const { setupLogger, formatRawCanFrameData, delay } = require('./utils');
// --- Configuration Constants ---
const CHUNK_SIZE = 8; // Bytes per chunk
const HEADER_SIZE = 16; // The first 16 hex bytes to be excluded from the data transfer
const delayMs = 1; // Delay between frames (adjust if needed)

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
        this.firstChunkACK =        false;
        this.lastChunkId = null; // Will be set after the last chunk number is calculated
        this.timeout = 10000; // 10 seconds timeout;
        this.startTime = Date.now();
        this.progress = 0; // procentage
        this.end = false;
        this.lastChunkSendIndex = -1;
        this.chunksACKObject = {}; // Object to track ACKs for each chunk
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
        this.controllerReadyIdSent = '5112000';
        this.controllerReadyIdAck =  '22A2000';
        this.firstPackageId =        '5142001';
        this.firstPackageIdAck =     '22A2001';
    }
    overallProgress(){
        let progress = this.progress+this.controllerReady+this.updateProcessStarted+this.lastChunkConfirmed+this.end-4;
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
            throw `File is to big ...`;
        } 
        this.NUM_CHUNKS = Math.ceil(dataLength / CHUNK_SIZE);
        this.logMessage(`Firmware file loaded. Size: ${this.FIRMWARE_FILE_SIZE} bytes. Data chunks to send: ${this.NUM_CHUNKS}`, 'INFO');
        const fileHeaderData = Array.from(this.firmwareBuffer.slice(0, 15)).map(byte =>byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        this.logMessage(`File header data: ${fileHeaderData}`, 'INFO');
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
            if(idHex.includes(`22A${this.formatChunkNumber(this.NUM_CHUNKS)}`) || idHex.includes(`22A${this.formatChunkNumber(this.NUM_CHUNKS-1)}`)){
                this.lastChunkConfirmed = true;
            }
            if(idHex.includes("22A6008")){
                this.logMessage('ACK for 5116008 received.', 'INFO');
                this.commnad5116008ack = true;
            }
            if(this.lastChunkSendIndex >= 0 && idHex.includes(`22A${this.formatChunkNumber(this.lastChunkSendIndex)}`)){
                this.chunksACKObject[this.lastChunkSendIndex] = true; // Mark this chunk as acknowledged
            }
            if(idHex.includes(`22A0002`)){
                this.firstChunkACK = true;
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
        this.first3bytes = [this.firmwareBuffer[0].toString(16).padStart(2, '0'),this.firmwareBuffer[1].toString(16).padStart(2, '0'),'02',this.firmwareBuffer[3].toString(16).padStart(2, '0')]
        do{
            await this.sendRawFrameWithRetry(this.controllerReadyIdSent,this.first3bytes.join(''));
            await delay(60);
            if (Date.now() - this.startTime > (this.timeout-5000) && this.controllerReadyIdSent == '5114000') {
                this.logMessage('Not responding for this method, trying the old way....', 'INFO');
                this.setupForOldMotor();
            }
            if (Date.now() - this.startTime > this.timeout) {
                throw 'Step 2: Timeout reached, exiting loop....'
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
                throw 'Step 2.1: Timeout reached, exiting loop....'
            }
        }while(!this.commnad5116008ack);
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
                throw 'Step 4: Timeout reached, exiting loop....'
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
    async sendFirstChunk() {
        const chunkId0 = this.formatChunkNumber(0); // #### incrementing chunk number
        const chunkData0 = this.getFirmwareChunk(0); // XXXXXXXXXXXXXXXX
        await this.sendRawFrameWithRetry(`514${chunkId0}`,chunkData0);
        await delay(delayMs);
        const chunkId1 = this.formatChunkNumber(1); // #### incrementing chunk number
        const chunkData1 = this.getFirmwareChunk(1); // XXXXXXXXXXXXXXXX
        await this.sendRawFrameWithRetry(`515${chunkId1}`,chunkData1);
        this.startTime = Date.now();
        this.logMessage('Step 4.1: Waiting for acknowledgment of the first chunk...', 'INFO');
        do{
            await delay(delayMs);
            if (Date.now() - this.startTime > this.timeout) {
                throw 'Step 4.1: Timeout reached, exiting loop....';
            }
        }while(!this.firstChunkACK);
    }
    async sendDataChunks() {
        this.logMessage('Step 5: Sending data chunks...', 'INFO');
        // Loop through all chunks except the very last one
        for (let i = 2; i < this.NUM_CHUNKS - 1; i++) {
            const chunkId = this.formatChunkNumber(i); // #### incrementing chunk number
            const chunkData = this.getFirmwareChunk(i); // XXXXXXXXXXXXXXXX
            this.lastChunkSendIndex = i;
            await this.sendRawFrameWithRetry(`515${chunkId}`,chunkData);
            this.progress = Math.round((i/this.NUM_CHUNKS)*100);
            if ((i - 2) % 256 === 0 && i!==2) {
                this.startTime = Date.now();
                do{
                    await delay(delayMs);
                    if (Date.now() - this.startTime > this.timeout) {
                        throw `Step 5(chunkId:${chunkId}): Timeout reached, exiting loop....`;
                    }
                }while(!this.chunksACKObject[i]);
            }else
                await delay(delayMs);
        }
        this.logMessage('All data chunks (except the last) sent.', 'INFO');
    }
    async sendDataChunksWithACK() {
        this.logMessage('Step 5: Sending data chunks...', 'INFO');
        // Loop through all chunks
        for (let i = 0; i < this.NUM_CHUNKS - 1; i++) {
            const chunkId = this.formatChunkNumber(i); // #### incrementing chunk number
            const chunkData = this.getFirmwareChunk(i); // XXXXXXXXXXXXXXXX
            //logMessage(`ID:515${chunkId}#${chunkData} `, 'SENT');
            this.lastChunkSendIndex = i;
            await this.sendRawFrameWithRetry(`515${chunkId}`,chunkData);
            this.progress = Math.round((i/this.NUM_CHUNKS)*100);
            this.startTime = Date.now();
            do{
                await delay(delayMs);
                if (Date.now() - this.startTime > this.timeout) {
                    throw `Step 5(chunkId:${chunkId}): Timeout reached, exiting loop....`;
                }
            }while(!this.chunksACKObject[i]);
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
        await this.sendRawFrameWithRetry(`516${this.lastChunkId}`,lastPackageContent);
        await delay(delayMs);
        //Reset timeout and wait for response
        this.startTime = Date.now();
        this.logMessage('Step 7: Waiting for acknowledgment of the last package...', 'INFO');
        do{
            await delay(delayMs);
            if (Date.now() - this.startTime > (60000)) {
                throw 'Step 7: Timeout reached, exiting loop....';
            }
        }while(!this.lastChunkConfirmed);
        
    }
    async announceFirmwareUpgradeEnd() {
        this.logMessage('Step 8: Announcing firmware upgrade end...', 'INFO');
        await delay(5000);
        await this.sendRawFrameWithRetry("5FF3005","01");
        await delay(5000);
    }
    async announceFirmwareUpgradeEndOld() {
        this.logMessage('Step 8: Announcing firmware upgrade end...', 'INFO');
        await delay(4000);
        for (let i = 0; i < 6; i++) {
            await this.sendRawFrameWithRetry("5FF3005","00");
            await this.sendRawFrameWithRetry(this.controllerReadyIdSent,this.first3bytes.join(''));
            await delay(50);
        }
        await delay(4000);
        for (let i = 0; i < 4; i++) {
            await this.sendRawFrameWithRetry("5F83501","00");
            await delay(20);
        }
        await delay(4000);
    }

    async startUpdateProcedure(fileBuffer) {
        try {
            this.logToFile = await setupLogger();
            this.init();
            this.initFile(fileBuffer);
            this.emitProgress()
            this.announceHostReady();
            await this.checkForControllerReady();
            await delay(20);
            if(this.controllerReadyIdSent == '5114000'){
                await this.send5116008Id();
                await delay(20);
            }
            await this.sendFirstPackage();
            if(this.controllerReadyIdSent == '5114000'){
                await this.sendFirstChunk();
                await delay(20);
                await this.sendDataChunks();
            }
            else
                await this.sendDataChunksWithACK();
            await delay(100);
            await this.sendLastPackageAndEndTransfer();
            await delay(20);
            await this.announceFirmwareUpgradeEnd();
            if(this.controllerReadyIdSent == '5114000')
                await this.announceFirmwareUpgradeEnd();
            else
                await this.announceFirmwareUpgradeEndOld();
            this.logMessage('Firmware update completed successfully!', 'INFO');
        } catch (error) {
            this.logMessage(error, 'ERROR');
            this.logMessage('Firmware update failed or was not completed.', 'ERROR');
        } finally {
            this.end = true
            this.ws.send(`FW_UPDATE_END`);
        }
    }

}

module.exports = FwUpdater;