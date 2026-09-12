const { setupLogger, formatRawCanFrameData, delay,delayu } = require('./utils');
const { monitorEventLoopDelay, PerformanceObserver } = require('perf_hooks');
// --- Configuration Constants ---
const CHUNK_SIZE = 8; // Bytes per chunk
const HEADER_SIZE = 16; // The first 16 hex bytes to be excluded from the data transfer
const delayMs = 2; // Delay between steps (milliseconds, adjust if needed)
const delayUs = 300; // Delay between chunks (microseconds, adjust if needed)

class FwUpdater {

    constructor(canbus, ws=null){
        this.canbus = canbus;
        this.ws = ws;
        this.init()
        this.setupCunbus()
        this.delayUs = delayUs;
        this.rateReportEvery = 4096; // Chunks between throughput reports
        this.maxBlockResends = 0;    // In-place block resend: measured as useless, kept as a knob
        // A device that rejected a block stays latched until it is restarted by hand, and
        // no CAN command is known to clear it - 5F83501 was tried and only froze it harder,
        // to the point of needing the battery pulled. Retrying in software can only waste
        // time, so leave this at 1 unless a real reset is ever found.
        this.maxUpdateAttempts = 1;
        this.maxTotalResends = 200;  // Backstop across the whole transfer
        // Pace on transmit confirmations instead of a fixed delay: delayu() is a busy
        // wait that pegs a core for the whole transfer, and the right rate is whatever
        // the wire does, not a number we guess. 0 falls back to the old delayUs pacing.
        this.maxInFlight = 4;
        this.echoWaitMs = 5;         // Echoes can be dropped; do not wait forever
        // Deliberately stall mid-block to test whether a transmit gap is what gets a
        // block rejected, instead of waiting for a random failure. Set via env so no
        // code or UI change is needed: FW_DEBUG_STALL_MS=60 [FW_DEBUG_STALL_CHUNK=5000]
        this.debugStallMs = Number(process.env.FW_DEBUG_STALL_MS) || 0;
        this.debugStallAtChunk = Number(process.env.FW_DEBUG_STALL_CHUNK) || 5000;
    }
    init(){
        this.firmwareBuffer = null; // Buffer to hold the firmware file content
        this.FIRMWARE_FILE_SIZE = 0; // Will be set after reading the file
        this.NUM_CHUNKS = 0;         // Will be calculated after reading the file
        this.controllerReady =      false; // Flag to track if controler is ready for update
        this.commnad6008ack =    false; // Flag to track if 6008 ACK was received
        this.updateProcessStarted = false; // Flag to track if the update process has started
        this.lastChunkConfirmed =   false; // Flag to track if the last chunk has been confirmed
        this.firstChunkACK =        false;
        this.lastChunkId = null; // Will be set after the last chunk number is calculated
        this.timeout = 15000; // 15 seconds timeout;
        this.startTime = Date.now();
        this.progress = 0; // procentage
        this.end = false;
        this.lastChunkSendIndex = -1;
        this.transferError = null; // Set when the device answers with a 2B (error) frame
        // 0 keeps the original end-of-update timing. Only modes with a capture to
        // copy from should raise it - see announceFirmwareUpgradeEnd().
        this.upgradeEndHoldMs = 0;
        this.upgradeEndKeepaliveMs = 60;
        this.lastAckWriteAddress = null; // Flash offset reported by the last block ACK
        this.echoCount = 0;              // Frames the adapter confirms it transmitted
        this.errorFrameCount = 0;        // CAN controller/bus error reports
        this.echoWaiter = null;          // Resolves the in-flight window wait
        this.lastComplaintChunk = null;  // Chunk the device named when refusing a block
        this.lastErrorFrameId = 0;
        this.leadingIdNum = "8"; // The leading number for the ID, e.g., 8 for 82F83200
        this.chunksACKObject = {}; // Object to track ACKs for each 
        this.chunksACKObjectplus1 = {}; //
        this.deviceId = '2'; //Controler
        this.indexAckCheckFct = (i) => (i - 1) % 256 === 0 && i!==2;
        this.doWhileAckCheckFct = (i) => this.chunksACKObjectplus1[i];
        this.startSendChunkIndex = 2;
        this.chunk0Prefix = '4';
        this.chunkNPrefix = '5';
        this.chunkEndPrefix = '6';
    }
    setupForNewMotor(){
        this.readyIdSent =       '5114000'; 
        this.readyIdAck =        '22A4000'; 
        this.firstPackageId =    '5104001'; 
        this.firstPackageIdAck = '22A4001';
        this.id6008 =            '5116008';
    }
    setupForOldMotor(){
        this.readyIdSent =       '5112000';
        this.readyIdAck =        '22A2000';
        this.firstPackageId =    '5142001';
        this.firstPackageIdAck = '22A2001';
        this.startSendChunkIndex = 0;
        this.indexAckCheckFct = (i) => true;
        this.doWhileAckCheckFct = (i) => this.chunksACKObject[i];
    }
    setupForHMI(){
        this.deviceId = '3'; //HMI
        this.upgradeEndHoldMs = 30000; // Measured against the official tool on a DPC245
        this.indexAckCheckFct = (i) => (i - 1) % 256 === 0 && i!==2;
        this.chunk0Prefix = 'C';
        this.chunkNPrefix = 'D';
        this.chunkEndPrefix = 'E';
        this.readyIdSent =       '5194000'; 
        this.readyIdAck =        '32A4000'; 
        this.firstPackageId =    '5184001'; 
        this.firstPackageIdAck = '32A4001';
        this.id6008 =            '5196008';
    }
    setupForDPC18(){
        this.setupForHMI();
        this.indexAckCheckFct = (i) => (i - 1) % 4096 === 0 && i!==2;
    }
    setupForDPE160(){
        this.setupForHMI();
        this.indexAckCheckFct = (i) => ((i - 1) % 256 === 0 && i!==2) || (i + 127) % 256 === 0;
    }
    setupForHubControler(){
        this.setupForNewMotor();
        this.indexAckCheckFct = (i) => (i % 256 === 0 && i!==2) || (i + 128) % 256 === 0;
        this.doWhileAckCheckFct = (i) => this.chunksACKObject[i];
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
            if(sendOverWS)
                console.log(`[${timestamp}] [${type}] ${message}`);
            this.logToFile(`[${timestamp}]\t[${type}]\t${message}`);
            if(sendOverWS && this.ws){
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
        // const maxValue = (2 ** (3 * 8)) - 1; 
        // if (dataLength < 0 || dataLength > maxValue) { 
        //     throw `File is to big ...`;
        // } 
        this.NUM_CHUNKS = Math.ceil(dataLength / CHUNK_SIZE);
        this.logMessage(`Firmware file loaded. Size: ${this.FIRMWARE_FILE_SIZE} bytes. Data chunks to send: ${this.NUM_CHUNKS}`, 'INFO');
        const fileHeaderData = Array.from(this.firmwareBuffer.slice(0, 15)).map(byte =>byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
        this.logMessage(`File header data: ${fileHeaderData}`, 'INFO');
    }
    setupCunbus(){
        // The adapter reports "ok" for a USB write even when it cannot put the frame on
        // the bus - measured: 1500 writes accepted, 3 frames actually transmitted. The
        // echo is the only real confirmation, so count them and compare per block.
        this.canbus.on('raw_frame_sent', () => {
            this.echoCount++;
            if (this.echoWaiter) this.echoWaiter();
        });
        this.canbus.on('raw_frame_error', (frame) => {
            this.errorFrameCount++;
            this.lastErrorFrameId = frame.can_id;
        });
        this.canbus.on('raw_frame_received', (rawFrame) => {
            if(this.end)
                return;
            const { idHex, dataHex, dlc, timestamp } = formatRawCanFrameData(rawFrame);
            if (idHex === "INVALID") {
                console.warn("Received invalid frame object, skipping.");
                return;
            }
            // The adapter echoes back everything we transmit, so this handler runs
            // once per sent chunk too. Nothing we wait for comes from ourselves, and
            // skipping the echo early avoids tens of thousands of needless string
            // builds during a transfer.
            if(idHex.startsWith(this.leadingIdNum + '5'))
                return;
            // What the device sends is sparse (a few hundred frames per update),
            // so recording all of it costs nothing and shows what we ignore.
            this.logMessage(`RX ${idHex} DLC:${dlc} Data:${dataHex}`, 'RX', false);
            // 2B (rather than 2A) is the device reporting a problem. Without this we
            // would sit in a wait loop until its timeout with no idea why.
            if(idHex.includes(`${this.deviceId}2B`)){
                this.transferError = `Device reported an error: ID:${idHex} Data:${dataHex}`;
                this.logMessage(this.transferError, 'ERROR');
            }
            if(idHex.includes(this.readyIdAck)){
                this.controllerReady = true;
            }
            if(idHex.includes(this.firstPackageIdAck)){
                this.updateProcessStarted = true;
            }
            if(idHex.includes(`${this.deviceId}2A${this.formatChunkNumber(this.NUM_CHUNKS)}`) || idHex.includes(`${this.deviceId}2A${this.formatChunkNumber(this.NUM_CHUNKS-1)}`)){
                this.lastChunkConfirmed = true;
            }
            if(idHex.includes(`${this.deviceId}2A6008`)){
                this.commnad6008ack = true;
            }
            if(this.lastChunkSendIndex >= 0 && idHex.includes(`${this.deviceId}2A${this.formatChunkNumber(this.lastChunkSendIndex)}`)){
                this.chunksACKObject[this.lastChunkSendIndex] = true; // Mark this chunk as acknowledged
            }
            // Any other numbered report from the device during the data phase is it
            // naming the chunk it took issue with - the only clue to where in the block
            // things went wrong, and worth comparing against where our worst stall was.
            if(this.lastChunkSendIndex >= 0 && dlc === 8
               && idHex.includes(`${this.deviceId}2A`)
               && !idHex.includes(`${this.deviceId}2A${this.formatChunkNumber(this.lastChunkSendIndex+1)}`)
               && !idHex.includes(`${this.deviceId}2A4001`) && !idHex.includes(`${this.deviceId}2A6008`)){
                this.lastComplaintChunk = parseInt(idHex.slice(-4), 16);
            }
            if(this.lastChunkSendIndex >= 0 && idHex.includes(`${this.deviceId}2A${this.formatChunkNumber(this.lastChunkSendIndex+1)}`)){
                this.chunksACKObjectplus1[this.lastChunkSendIndex] = true; // Mark this chunk as acknowledged
                // The first four payload bytes are how far the device has actually
                // written, and it always equals chunkNumber * 8 on a healthy transfer.
                // Anything less means it dropped what we sent and is waiting there.
                this.lastAckWriteAddress = this.parseWriteAddress(dataHex);
            }
            if(idHex.includes(`${this.deviceId}2A0002`)){
                this.firstChunkACK = true;
            }
        });
    }
    async sendRawFrameWithRetry(id,data,retries = 3){
        let sent = false;
        let tryCount = 0;
        //this.logMessage(`Sending ID:${this.leadingIdNum+id}`, 'SENT');
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
                if(this.ws)
                    this.ws.send(`FW_UPDATE_PROGRESS:${this.overallProgress()}`);
                else
                    console.log(this.overallProgress())
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
            await delay(60);
        }while(!this.controllerReady && !this.end);
    }
    async checkForControllerReady(){
        this.logMessage('Step 2:Waiting for controler ready state...', 'INFO');
        this.first3bytes = [this.firmwareBuffer[0].toString(16).padStart(2, '0'),this.firmwareBuffer[1].toString(16).padStart(2, '0'),this.deviceId.toString().padStart(2,'0'),this.firmwareBuffer[3].toString(16).padStart(2, '0')]
        do{
            await this.sendRawFrameWithRetry(this.readyIdSent,this.first3bytes.join(''));
            await delay(60);
            // if (Date.now() - this.startTime > (this.timeout-5000) && this.readyIdSent == '5114000') {
            //     this.logMessage('Not responding for this method, trying the old way....', 'INFO');
            //     this.setupForOldMotor();
            // }
            if (Date.now() - this.startTime > this.timeout) {
                throw 'Step 2: Timeout reached, exiting loop....'
                    + (this.transferError ? ` Last device response: ${this.transferError}` : '');
            }
        }while(!this.controllerReady);
        // A refusal seen while negotiating must not abort a later phase.
        this.transferError = null;
    }
    async send6008Id(){
        await this.sendRawFrameWithRetry(this.id6008,"");
        this.startTime = Date.now();
        this.logMessage('Step 2.1: Waiting for acknowledgment of the 6008 package...', 'INFO');
        do{
            await delay(20);
            if (this.transferError) {
                throw `Step 2.1: ${this.transferError}`;
            }
            if (Date.now() - this.startTime > this.timeout) {
                throw 'Step 2.1: Timeout reached, exiting loop....'
            }
        }while(!this.commnad6008ack);
    }
    async sendFirstPackage() {
        this.logMessage('Step 3: Sending first package (file length)...', 'INFO');
        const fileLengthMinus16 = this.FIRMWARE_FILE_SIZE - HEADER_SIZE;
        const hexLength = fileLengthMinus16.toString(16).padStart(6, '0').toUpperCase(); // ## ## ## format
        //this.logMessage(`ID:${this.firstPackageId}#${hexLength}`, 'SENT');
        await this.sendRawFrameWithRetry(this.firstPackageId,hexLength);
        this.startTime = Date.now();
        this.logMessage('Step 4: Waiting for acknowledgment of the first package...', 'INFO');
        do{
            await delay(20);
            if (this.transferError) {
                throw `Step 4: ${this.transferError}`;
            }
            if (Date.now() - this.startTime > this.timeout) {
                throw 'Step 4: Timeout reached, exiting loop....'
            }
        }while(!this.updateProcessStarted);
    }
    // First four payload bytes of a block ACK, big endian: the flash offset the
    // device has committed up to. Returns null for payloads that are not one.
    parseWriteAddress(dataHex) {
        const bytes = dataHex.split(' ').filter(Boolean);
        if (bytes.length < 8) return null;
        return parseInt(bytes.slice(0, 4).join(''), 16);
    }
    formatChunkNumber(num) {
        const wrappedNum = num % 65536;
        return wrappedNum.toString(16).padStart(4, '0').toUpperCase();
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
        await this.sendRawFrameWithRetry(`51${this.chunk0Prefix}${chunkId0}`,chunkData0);
        await delay(delayMs);
        const chunkId1 = this.formatChunkNumber(1); // #### incrementing chunk number
        const chunkData1 = this.getFirmwareChunk(1); // XXXXXXXXXXXXXXXX
        await this.sendRawFrameWithRetry(`51${this.chunkNPrefix}${chunkId1}`,chunkData1);
        this.startTime = Date.now();
        this.logMessage('Step 4.1: Waiting for acknowledgment of the first chunk...', 'INFO');
        do{
            await delay(20);
            if (this.transferError) {
                throw `Step 4.1: ${this.transferError}`;
            }
            if (Date.now() - this.startTime > this.timeout) {
                throw 'Step 4.1: Timeout reached, exiting loop....';
            }
        }while(!this.firstChunkACK);
    }
    // Resolves when the adapter confirms another transmission, or after a short
    // timeout so a dropped echo cannot wedge the transfer.
    waitForEcho() {
        return new Promise((resolve) => {
            const done = () => { clearTimeout(timer); this.echoWaiter = null; resolve(); };
            const timer = setTimeout(done, this.echoWaitMs);
            this.echoWaiter = done;
        });
    }
    async sendDataChunks() {
        this.logMessage('Step 5: Sending data chunks...'
            + (this.debugStallMs ? ` (DEBUG: ${this.debugStallMs}ms stall armed at chunk ${this.debugStallAtChunk})` : ''), 'INFO');
        // Throughput accounting. The interesting number is not the overall rate but
        // how it splits between putting frames on the wire and blocking on the
        // per-block ACKs - only the first half is ours to tune.
        const startNs = process.hrtime.bigint();
        let markNs = startNs;
        let markIndex = this.startSendChunkIndex;
        let ackWaitNs = 0n;
        let ackWaitAtMark = 0n;
        let resends = 0, sameSpotResends = 0, lastResumeAt = -1;
        // Stall accounting. BESST never leaves a gap over 50 ms between chunks; the one
        // run of ours that did (232 of them) had 95 blocks rejected. So measure both the
        // gaps we actually produce and the event loop lag behind them, and attach the
        // numbers to a rejection when it happens - that is what links cause to effect.
        const loopLag = monitorEventLoopDelay({ resolution: 10 });
        loopLag.enable();
        // Event loop lag tracks the transmit gaps almost exactly, so whatever blocks the
        // loop is what gets blocks rejected. Measure garbage collection directly rather
        // than assuming it: the send path allocates ~20 short lived objects per chunk.
        let gcCount = 0, gcTotalMs = 0, gcMaxMs = 0, gcBlockMaxMs = 0;
        const gcObserver = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
                gcCount++;
                gcTotalMs += e.duration;
                if (e.duration > gcMaxMs) gcMaxMs = e.duration;
                if (e.duration > gcBlockMaxMs) gcBlockMaxMs = e.duration;
            }
        });
        gcObserver.observe({ entryTypes: ['gc'] });
        const gapBuckets = [2000, 5000, 20000, 50000];
        const gapCounts = [0, 0, 0, 0];
        let prevSendNs = process.hrtime.bigint();
        let blockMaxGapUs = 0, runMaxGapUs = 0, markMaxGapUs = 0, runMaxLagNs = 0;
        let blockWorstGapAt = -1, blockFirstChunk = this.startSendChunkIndex;
        let lastSentIndex = this.startSendChunkIndex - 1;
        // Split the cycle: time spent inside the USB write, versus time waiting to be
        // given the loop back afterwards. A stall in the first is the transfer itself
        // blocking; in the second it is other work on the event loop.
        let blockMaxSendUs = 0, runMaxSendUs = 0;
        let stallInjected = false;
        const baseEcho = this.echoCount;
        const baseErrors = this.errorFrameCount;
        let blockStartErrors = this.errorFrameCount;
        let maxShortfall = 0;
        try {
        for (let i = this.startSendChunkIndex; i < this.NUM_CHUNKS - 1; i++) {
            const chunkId = this.formatChunkNumber(i); // #### incrementing chunk number
            const chunkData = this.getFirmwareChunk(i); // XXXXXXXXXXXXXXXX
            this.lastChunkSendIndex = i;
            lastSentIndex = i;
            const sendFromNs = process.hrtime.bigint();
            await this.sendRawFrameWithRetry(`51${this.chunkNPrefix}${chunkId}`,chunkData);
            this.progress = Math.round((i/this.NUM_CHUNKS)*100);
            if (this.maxInFlight > 0) {
                // Sliding window: keep the pipe full but never let the adapter's queue
                // run away, which is what a fixed delay cannot know how to avoid.
                let guard = 0;
                while ((i + 1 - this.startSendChunkIndex) - (this.echoCount - baseEcho) >= this.maxInFlight
                       && guard++ < this.maxInFlight * 2) {
                    await this.waitForEcho();
                }
            }
            {
                const nowNs = process.hrtime.bigint();
                const sendUs = Number(nowNs - sendFromNs) / 1000;
                if (sendUs > blockMaxSendUs) blockMaxSendUs = sendUs;
                if (sendUs > runMaxSendUs) runMaxSendUs = sendUs;
                const gapUs = Number(nowNs - prevSendNs) / 1000;
                prevSendNs = nowNs;
                for (let b = 0; b < gapBuckets.length; b++) if (gapUs > gapBuckets[b]) gapCounts[b]++;
                if (gapUs > blockMaxGapUs) { blockMaxGapUs = gapUs; blockWorstGapAt = i; }
                if (gapUs > markMaxGapUs) markMaxGapUs = gapUs;
                if (gapUs > runMaxGapUs) runMaxGapUs = gapUs;
            }
            if (this.debugStallMs && i === this.debugStallAtChunk && !stallInjected) {
                stallInjected = true;
                this.logMessage(`DEBUG: injecting a deliberate ${this.debugStallMs}ms stall after chunk ${i}`, 'WARN');
                await delay(this.debugStallMs);   // counted in the next gap on purpose
            }
            if (this.indexAckCheckFct(i)) {
                const waitFromNs = process.hrtime.bigint();
                this.startTime = Date.now();
                do{
                    await delayu(this.delayUs);
                    if (this.transferError) {
                        throw `Step 5(chunkId:${chunkId}): ${this.transferError}`;
                    }
                    if (Date.now() - this.startTime > this.timeout) {
                        throw `Step 5(chunkId:${chunkId}): Timeout reached, exiting loop....`;
                    }
                }while(!this.doWhileAckCheckFct(i));
                ackWaitNs += process.hrtime.bigint() - waitFromNs;
                // The ACK is cumulative: its payload says the device has committed
                // everything below (i+1)*8. If it reports less, the block we just
                // streamed never landed and the device is still sitting further
                // back, so carry on from where it says it is rather than leaving a
                // hole that only surfaces as a rejected image 45 s later.
                // Cumulative, so echoes still in flight show as a shortfall of one or
                // two that clears itself; a real drop leaves it permanently high.
                const sentSoFar = i + 1 - this.startSendChunkIndex;
                const confirmedSoFar = this.echoCount - baseEcho;
                const shortfall = sentSoFar - confirmedSoFar;
                if (shortfall > maxShortfall) maxShortfall = shortfall;
                const expectedAddress = (i + 1) * CHUNK_SIZE;
                if (this.lastAckWriteAddress !== null && this.lastAckWriteAddress !== expectedAddress) {
                    const behindChunks = (expectedAddress - this.lastAckWriteAddress) / CHUNK_SIZE;
                    const resumeAt = this.lastAckWriteAddress / CHUNK_SIZE;
                    resends++;
                    // Count retries per position: a scattered hiccup recovers and
                    // moves on, a block the device will never take repeats forever.
                    if (resumeAt === lastResumeAt) sameSpotResends++;
                    else { sameSpotResends = 1; lastResumeAt = resumeAt; }
                    this.logMessage(
                        `Device is ${behindChunks} chunk(s) behind at ${i} `
                        + `(committed ${this.lastAckWriteAddress}B, expected ${expectedAddress}B); `
                        + (this.maxBlockResends
                            ? `resend from chunk ${resumeAt} (${sameSpotResends}/${this.maxBlockResends} here, ${resends} total) `
                            : `device wants chunk ${resumeAt} `)
                        + `| worst gap in this block ${blockMaxGapUs.toFixed(0)}us, `
                        + `loop lag max ${(loopLag.max / 1000).toFixed(0)}us, `
                        + `worst GC pause in this block ${gcBlockMaxMs.toFixed(1)}ms, `
                        + `worst single USB write in this block ${blockMaxSendUs.toFixed(0)}us, `
                        + `adapter confirmed ${confirmedSoFar}/${sentSoFar} frames transmitted so far `
                        + `(shortfall ${shortfall}; 1-2 is echo still in flight, more means dropped), `
                        + `CAN error frames in this block ${this.errorFrameCount - blockStartErrors}`
                        + `, block spans ${blockFirstChunk}..${i}`
                        + `, worst stall at chunk ${blockWorstGapAt} (position ${blockWorstGapAt - blockFirstChunk + 1})`
                        + (this.lastComplaintChunk !== null
                            ? `, device complained about chunk 0x${this.lastComplaintChunk.toString(16).toUpperCase()} `
                              + `(position ${((this.lastComplaintChunk - blockFirstChunk) & 0xFFFF) + 1}) `
                              + `-> stall came ${blockWorstGapAt - blockFirstChunk <= ((this.lastComplaintChunk - blockFirstChunk) & 0xFFFF) ? 'BEFORE' : 'AFTER'} the complaint`
                            : ', device named no chunk'), 'WARN');
                    if (sameSpotResends > this.maxBlockResends || resends > this.maxTotalResends
                        || resumeAt < this.startSendChunkIndex || resumeAt > i) {
                        throw `Step 5(chunk ${i}): device rejected the block at ${resumeAt}, ${behindChunks} chunk(s) behind`
                            + (this.maxBlockResends ? ` (${sameSpotResends} in-place retries, ${resends} total)` : '');
                    }
                    for (let j = resumeAt; j <= i; j++) {
                        delete this.chunksACKObject[j];
                        delete this.chunksACKObjectplus1[j];
                    }
                    this.lastAckWriteAddress = null;
                    i = resumeAt - 1; // the loop's i++ puts us back on resumeAt
                    continue;
                }
                this.lastAckWriteAddress = null;
                blockStartErrors = this.errorFrameCount;
                blockFirstChunk = i + 1;
                blockWorstGapAt = -1;
                this.lastComplaintChunk = null;
                blockMaxGapUs = 0;
                blockMaxSendUs = 0;
                gcBlockMaxMs = 0;
                if (loopLag.max > runMaxLagNs) runMaxLagNs = loopLag.max;
                loopLag.reset();   // per-block window, so a rejection reports its own lag
                prevSendNs = process.hrtime.bigint(); // the ACK wait is not a stall
            }else
                await delayu(this.delayUs);
            if (i - markIndex >= this.rateReportEvery) {
                const nowNs = process.hrtime.bigint();
                const n = i - markIndex;
                const totalUs = Number(nowNs - markNs) / 1000;
                const waitUs = Number(ackWaitNs - ackWaitAtMark) / 1000;
                this.logMessage(
                    `chunk ${i}/${this.NUM_CHUNKS} | ${(totalUs / n).toFixed(0)} us/chunk `
                    + `(cycle ${((totalUs - waitUs) / n).toFixed(0)} + ackwait ${(waitUs / n).toFixed(0)}) `
                    + `| worst gap ${markMaxGapUs.toFixed(0)}us `
                    + `| elapsed ${(Number(nowNs - startNs) / 1e9).toFixed(1)}s`, 'RATE');
                markNs = nowNs;
                markIndex = i;
                ackWaitAtMark = ackWaitNs;
                markMaxGapUs = 0;
            }
        }
        } finally {
        const sentCount = Math.max(1, lastSentIndex + 1 - this.startSendChunkIndex);
        const done = lastSentIndex >= this.NUM_CHUNKS - 2;
        const totalUs = Number(process.hrtime.bigint() - startNs) / 1000;
        const waitUs = Number(ackWaitNs) / 1000;
        this.logMessage(
            (done ? 'All data chunks (except the last) sent. ' : `Stopped at chunk ${lastSentIndex}. `)
            + `${sentCount} chunks in ${(totalUs / 1e6).toFixed(1)}s `
            + `= ${(totalUs / sentCount).toFixed(0)} us/chunk `
            + `(cycle ${((totalUs - waitUs) / sentCount).toFixed(0)}, ackwait ${(waitUs / sentCount).toFixed(0)}) `
            + `| pacing: ${this.maxInFlight > 0 ? 'echo window ' + this.maxInFlight : 'delayUs ' + this.delayUs}`, 'RATE');
        loopLag.disable();
        this.logMessage(
            `Stalls: gaps >2ms=${gapCounts[0]} >5ms=${gapCounts[1]} >20ms=${gapCounts[2]} `
            + `>50ms=${gapCounts[3]}, worst ${runMaxGapUs.toFixed(0)}us; `
            + `worst event loop lag ${(Math.max(runMaxLagNs, loopLag.max) / 1000).toFixed(0)}us `
            + `(BESST reference: 0 gaps over 50ms)`, 'RATE');
        gcObserver.disconnect();
        this.logMessage(
            `GC: ${gcCount} collections, ${gcTotalMs.toFixed(0)}ms total, worst ${gcMaxMs.toFixed(1)}ms; `
            + `worst single USB write ${runMaxSendUs.toFixed(0)}us`, 'RATE');
        this.logMessage(
            `Adapter confirmed transmitting ${this.echoCount - baseEcho}/${sentCount} chunk frames `
            + `(peak in-flight shortfall ${maxShortfall})`
            + (sentCount - (this.echoCount - baseEcho) > 2
                ? ` - ${sentCount - (this.echoCount - baseEcho)} FRAME(S) NEVER REACHED THE BUS`
                : ' - nothing dropped by the adapter'), 'RATE');
        // How often the firmware packed several frames into one USB transfer. Before
        // the multi-frame fix in onUSBPollData every one of these lost all but the
        // first frame, so a non-zero count here means the fix is doing real work.
        const packed = this.canbus.canDevice && this.canbus.canDevice.multiFrameTransfers;
        if (packed) this.logMessage(`USB transfers carrying more than one frame: ${packed}`, 'RATE');
        const errs = this.errorFrameCount - baseErrors;
        this.logMessage(`CAN error frames reported by the controller: ${errs}`
            + (errs ? ` (last id 0x${this.lastErrorFrameId.toString(16).toUpperCase()}; `
                    + `set CAN_VERBOSE_ERRORS=1 to decode them)` : ''), 'RATE');
        }
    }
    async sendLastPackageAndEndTransfer() {
        this.logMessage('Step 6: Sending last data package and ending transfer...', 'INFO');
        this.lastChunkId = this.formatChunkNumber(this.NUM_CHUNKS - 1);
        const lastPackageContent = this.getFirmwareChunk(this.NUM_CHUNKS - 1);
        await this.sendRawFrameWithRetry(`51${this.chunkEndPrefix}${this.lastChunkId}`,lastPackageContent);
        this.startTime = Date.now();
        this.logMessage('Step 7: Waiting for acknowledgment of the last package...', 'INFO');
        do{
            await delay(20);
            if (this.transferError) {
                throw `Step 7: ${this.transferError}`;
            }
            if (Date.now() - this.startTime > (30000)) {
                throw 'Step 7: Timeout reached, exiting loop....';
            }
        }while(!this.lastChunkConfirmed);
        
    }
    async announceFirmwareUpgradeEnd() {
        this.logMessage('Step 8: Announcing firmware upgrade end...', 'INFO');
        if (this.upgradeEndHoldMs <= 0) {
            // Devices we have no capture for keep the timing they always had.
            await delay(3000);
            await this.sendRawFrameWithRetry("5FF3005","01");
            await delay(2000);
            return;
        }
        // Captured from the official tool on a DPC245: it announces the end, then
        // keeps the host-present heartbeat running for ~26 s while the device
        // commits the image, and only then closes with a second 01. Going quiet
        // during that window leaves the device writing flash with no host.
        await this.sendRawFrameWithRetry("5FF3005","01");
        await delay(20);
        const holdUntil = Date.now() + this.upgradeEndHoldMs;
        let nextNote = Date.now() + 5000;
        while (Date.now() < holdUntil) {
            await this.sendRawFrameWithRetry("5FF3005","00");
            await delay(this.upgradeEndKeepaliveMs);
            if (Date.now() >= nextNote) {
                const left = Math.round((holdUntil - Date.now()) / 1000);
                this.logMessage(`Step 8: device is writing flash, holding host-present for ${left}s more...`, 'INFO');
                nextNote += 5000;
            }
        }
        await this.sendRawFrameWithRetry("5FF3005","01");
        await delay(500);
    }
    async announceFirmwareUpgradeEndOld() {
        this.logMessage('Step 8: Announcing firmware upgrade end...', 'INFO');
        await delay(2000);
        for (let i = 0; i < 6; i++) {
            await this.sendRawFrameWithRetry("5FF3005","00");
            await this.sendRawFrameWithRetry(this.readyIdSent,this.first3bytes.join(''));
            await delay(50);
        }
        await delay(2000);
        for (let i = 0; i < 4; i++) {
            await this.sendRawFrameWithRetry("5F83501","00");
            await delay(20);
        }
        await delay(1000);
    }

    async runUpdateAttempt(fileBuffer,mode) {
        this.init();
        if(mode == "HMI")
            this.setupForHMI()
        else if(mode == "DPC18")
            this.setupForDPC18()
        else if (mode == "CONTROLER_OLD")
            this.setupForOldMotor()
        else if (mode == "DPE160")
            this.setupForDPE160()
        else if (mode == "CONTROLER_HUB")
            this.setupForHubControler()
        else
            this.setupForNewMotor()
        this.initFile(fileBuffer);
        this.emitProgress()
        this.announceHostReady();
        await this.checkForControllerReady();
        await delay(20);
        if(this.readyIdSent.includes('4000')){
            await this.send6008Id();
            await delay(20);
        }
        await this.sendFirstPackage();
        await delay(20);
        if(this.readyIdSent.includes('4000')){
            await this.sendFirstChunk();
            await delayu(this.delayUs);
        }
        await this.sendDataChunks();
        await delayu(this.delayUs);
        await this.sendLastPackageAndEndTransfer();
        await delay(20);
        if(this.readyIdSent.includes('4000'))
            await this.announceFirmwareUpgradeEnd();
        else
            await this.announceFirmwareUpgradeEndOld();
    }

    async startUpdateProcedure(fileBuffer,mode="CONTROLER") {
        const startTime = performance.now();
        this.logToFile = await setupLogger();
        let succeeded = false;
        try {
            for (let attempt = 1; attempt <= this.maxUpdateAttempts; attempt++) {
                try {
                    if (attempt > 1)
                        this.logMessage(`Retrying whole update, attempt ${attempt}/${this.maxUpdateAttempts}...`, 'INFO');
                    await this.runUpdateAttempt(fileBuffer, mode);
                    this.logMessage('Firmware update completed successfully!', 'INFO');
                    succeeded = true;
                    break;
                } catch (error) {
                    this.logMessage(error, 'ERROR');
                    if (attempt >= this.maxUpdateAttempts) break;
                    // Let the device drop out of update mode before starting over.
                    this.end = true;   // stop the progress emitter and the frame handler
                    await delay(5000);
                }
            }
            if (!succeeded) {
                this.logMessage(`Firmware update failed after ${this.maxUpdateAttempts} attempt(s).`, 'ERROR');
                this.logMessage('Restart the display before trying again - it stays in this state '
                    + 'until it is restarted.', 'ERROR');
            }
        } finally {
            this.end = true
            const timeInSeconds = (performance.now() - startTime) / 1000;
            this.logMessage(`Runtime: ${timeInSeconds}s`,'INFO');
            if(this.ws)
                this.ws.send(`FW_UPDATE_END`);
            if(this.logToFile && this.logToFile.close)
                await this.logToFile.close();
        }
    }

}

module.exports = FwUpdater;