// canbus.js
const { GSUsb } = require('./gsusb');
const { CanFrame } = require('./canframe');
const { EventEmitter } = require('node:events'); // Use Node.js built-in EventEmitter
//const usb = require('usb');

const {
    CanOperation, DeviceNetworkId, charsToString, parseCanFrame,
    BafangCanBatteryParser, BafangCanControllerParser,
    BafangCanDisplayParser, BafangCanSensorParser,
    generateCanFrameId, // Make sure this is exported correctly from parser
    bafangIdArrayTo32Bit // Make sure this is exported correctly from parser
    // CAN_CHANNEL_PREFIX is not needed here as parser handles it
} = require('./bafang-parser');

const bafangSerializer = require('./bafang-serializer');
const { RequestManager } = require('./request-manager');
const requestFunctions = require('./bafang-can-requests');

const CAN_EFF_FLAG = 0x80000000;
const BAFANG_CAN_BITRATE = 250000;
const TOOL_SOURCE_ID = DeviceNetworkId.BESST; // Define the ID used by this tool for sending


function formatBufferForLog(buffer) {
    // Ensure buffer is an array of numbers before mapping
    if (!buffer || !Array.isArray(buffer)) return "[Invalid Buffer Data]";
    return buffer.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}



class CanBusService extends EventEmitter {
    constructor() {
        super();
        this.canDevice = new GSUsb();
        this.isStarted = false;
        this.frameLength = 20;
        // New multiFrameBuffers structure: keyed by "source-target-cmd-sub"
        this.multiFrameBuffers = {};
        // Still need timeouts, keyed the same way
        this.multiFrameTimeouts = {};
        this.requestManager = new RequestManager(this);
        this.MULTIFRAME_TIMEOUT = 10000; // 10 seconds timeout
		this.connectedDeviceName = null;
		this.cachedParameter0 = null;
        this.cachedParameter1 = null;
        this.cachedParameter2 = null;
        this.cachedSpeedParams = null; // Added for completeness
    }

    getConnectedDeviceName() {
        return this.connectedDeviceName;
    }

     async init(knownDeviceName = null) { // Accept knownDeviceName
        if (this.isStarted) {
            console.log('[CanBusService] CAN device already initialized.');
            // If already started, ensure connectedDeviceName is consistent
            if (knownDeviceName && this.connectedDeviceName !== knownDeviceName) {
                // This case is unlikely if logic is correct but good for consistency
                console.warn(`[CanBusService] Init called while started, known name mismatch: ${this.connectedDeviceName} vs ${knownDeviceName}`);
            }
            this.emit('can_status', true, `CAN device already connected (${this.connectedDeviceName || 'Unknown Device'}).`);
            return true;
        }
        console.log('[CanBusService] Attempting to initialize CAN device with candlelightjs...');
        this.connectedDeviceName = knownDeviceName; // Tentatively set name

        try {
            // GSUsb.start() internally finds the device
            const startResult = await this.canDevice.start(BAFANG_CAN_BITRATE, 0);

            if (!startResult || !startResult.ok) {
                this.connectedDeviceName = null; // Clear name on failure
                throw new Error(startResult.msg || 'Failed to start CAN device (candlelightjs)');
            }

            // If GSUsb.start() succeeds, it found a device.
            // Try to get a more descriptive name from the GSUsb instance if not already provided
            if (!this.connectedDeviceName && this.canDevice.gs_usb && this.canDevice.gs_usb.productName) {
                this.connectedDeviceName = this.canDevice.gs_usb.productName;
                if (this.canDevice.gs_usb.manufacturerName) {
                    this.connectedDeviceName += ` (by ${this.canDevice.gs_usb.manufacturerName})`;
                }
            } else if (!this.connectedDeviceName) {
                this.connectedDeviceName = "GS_USB Device"; // Fallback if GSUsb doesn't provide it
            }


            this.frameLength = this.canDevice.frameLength || 20;
            this.isStarted = true;
            console.log(`[CanBusService] CAN device started successfully at ${BAFANG_CAN_BITRATE} bps. Device: ${this.connectedDeviceName}`);
            this.emit('can_status', true, `CAN device connected (${this.connectedDeviceName}).`);


            this.canDevice.on('frame', (frame) => this._handleFrameReceived(frame));
            this.canDevice.on('error', (err) => this._handleCanError(err));

            try {
                await this.canDevice.startPolling();
                console.log('[CanBusService] CAN device polling started.');
            } catch (pollErr) {
                console.error('[CanBusService] Failed to start CAN polling:', pollErr);
                await this.close();
                // No need to emit can_status here, close() will do it.
                // this.emit('can_error', `Error starting polling: ${pollErr.message}`);
                return false;
            }
			this.requestManager.startQueueProcessor();
            return true;

        } catch (err) {
            console.error('[CanBusService] Failed to initialize CAN device:', err);
            this.isStarted = false;
            this.connectedDeviceName = null; // Clear name on failure
            this.emit('can_status', false, `Error: Failed to connect to CAN device - ${err.message}`);
            // this.emit('can_error', `Error connecting: ${err.message}`); // can_status covers this
            return false;
        }
    }

    _mapRawFrameToBafangFrame(rawFrame) {
        // ... (mapping logic remains the same) ...
        const canIdNum = rawFrame.can_id; 
        const byte0 = (canIdNum >> 24) & 0xFF; 
        const byte1 = (canIdNum >> 16) & 0xFF; 
        const byte2 = (canIdNum >> 8) & 0xFF; 
        const byte3 = canIdNum & 0xFF; 
        const bafangId = [byte0, byte1, byte2, byte3]; 
        const dataArray = []; 
        const dataView = rawFrame.data; 
        for (let i = 0; i < rawFrame.can_dlc; i++) { 
            if (i < dataView.byteLength) 
                dataArray.push(dataView.getUint8(i)); 
            else { 
                console.warn(`DLC mismatch...`); 
                break; 
            } 
        } while(dataArray.length < rawFrame.can_dlc) {
             console.warn(`Padding data...`); 
             dataArray.push(0); 
        } if(dataArray.length > rawFrame.can_dlc) 
            dataArray.length = rawFrame.can_dlc; 
        return { id: bafangId, data: dataArray };
    }

    /**
     * Sends a NORMAL_ACK back to the source device for a specific command.
     * @param {object} originalParsedFrame - The parsed frame of the segment being acknowledged.
     */
    async _sendAck(originalParsedFrame) {
        if (!this.isStarted) return; // Don't send if not connected

        try {
            const ackIdArr = generateCanFrameId(
                TOOL_SOURCE_ID, // Source is this tool
                originalParsedFrame.sourceDeviceCode, // Target is the original sender
                CanOperation.NORMAL_ACK, // Operation is ACK
                originalParsedFrame.canCommandCode, // Command from original request
                originalParsedFrame.canCommandSubCode // Subcommand from original request
            );
            const ackId32 = bafangIdArrayTo32Bit(ackIdArr);
            const ackDataHex = "00"; // Standard ACK payload

            // console.log(`>>> Sending ACK | Target: ${originalParsedFrame.sourceDeviceCode} | Cmd: ${originalParsedFrame.canCommandCode}/${originalParsedFrame.canCommandSubCode} | ID: ${ackId32.toString(16)}`);
            await this.sendFrame(`${ackId32.toString(16).padStart(8, '0')}#${ackDataHex}`);

        } catch (ackError) {
            console.error(`[CanBusService] Failed to send ACK for ${originalParsedFrame.canCommandCode}/${originalParsedFrame.canCommandSubCode} to ${originalParsedFrame.sourceDeviceCode}:`, ackError);
            this.emit('can_error', `Failed to send ACK: ${ackError.message}`);
        }
    }


    _handleFrameReceived(rawFrame) {
        try {
            this.emit('raw_frame_received', rawFrame);
            const bafangFrame = this._mapRawFrameToBafangFrame(rawFrame);
            const parsedFrame = parseCanFrame(bafangFrame);

            // Ignore Echo Check (remains the same)
            if (parsedFrame.sourceDeviceCode === TOOL_SOURCE_ID) {
				
                return;
            }

            if (parsedFrame.parseError || parsedFrame.sourceDeviceCode < 0) {
                console.warn(`Skipping frame due to mapping/parsing error or invalid logical source. Original ID: 0x${rawFrame.can_id.toString(16)}, Mapped ID: [${bafangFrame.id.map(b=>'0x'+b.toString(16)).join(',')}]`);
                return;
            }

            const opCode = parsedFrame.canOperationCode;
            const sourceId = parsedFrame.sourceDeviceCode;
            const targetId = parsedFrame.targetDeviceCode; // Should be TOOL_SOURCE_ID for responses
            const cmdCode = parsedFrame.canCommandCode;
            const subCode = parsedFrame.canCommandSubCode;
            const frameData = parsedFrame.data;

            // --- Check if target is this tool (essential for multi-frame and ACKs) ---
            if (targetId !== TOOL_SOURCE_ID) {
                // This frame is not directly addressed to us (e.g., broadcast or other device comms)
                // We might still want to parse and emit it, but don't process multi-frame or ACKs for it.
                // console.log(`Ignoring frame not targeted at tool (Target: ${targetId})`);
                this._parseAndEmitCompletedFrame(parsedFrame, rawFrame.timestamp_us);
                // Don't try to resolve requests for frames not meant for us
                // this.requestManager.resolveRequest(parsedFrame); // Maybe remove this?
                return;
            }

            // --- Multi-Frame Handling ---
            const bufferKey = `${sourceId}-${targetId}-${cmdCode}-${subCode}`; // Unique key for the original command
 
            if (opCode === CanOperation.MULTIFRAME_START) {
                const expectedLength = frameData[0];
                console.log(`>>> MF_START | Key: ${bufferKey} | ExpLen: ${expectedLength}`);

                if (this.multiFrameTimeouts[bufferKey]) clearTimeout(this.multiFrameTimeouts[bufferKey]);
                if (this.multiFrameBuffers[bufferKey]) console.warn(`>>> Overwriting MF buffer for key ${bufferKey}.`);

                this.multiFrameBuffers[bufferKey] = {
                    expectedLength: expectedLength,
                    //buffer:[],
                    buffer: Array(expectedLength).fill(null),
                    originalFrameInfo: { ...parsedFrame }, // Store context of START
                    //nextSequence: 0
                };
                this.multiFrameTimeouts[bufferKey] = setTimeout(() => { /* ... cleanup ... */ }, this.MULTIFRAME_TIMEOUT);
                this._sendAck(parsedFrame); // ACK the START
                return;

            } else if (opCode === CanOperation.MULTIFRAME || opCode === CanOperation.MULTIFRAME_END) {
                // --- Find the correct buffer ---
                // We need to find the buffer based on source/target, but the cmd/sub might be 0/sequence#
                // Let's iterate active buffers for this source/target pair
                let activeBufferKey = null;
                let bufferInfo = null;
                for (const key in this.multiFrameBuffers) {
                    if (key.startsWith(`${sourceId}-${targetId}-`)) {
                         // Assume the first active buffer for this source/target is the one we're continuing
                         // THIS IS A HEURISTIC AND MIGHT FAIL IF MULTIPLE SEQUENCES ARE TRULY INTERLEAVED
                         activeBufferKey = key;
                         bufferInfo = this.multiFrameBuffers[key];
                         break;
                    }
                }

                if (!bufferInfo || !activeBufferKey) {
                    console.warn(`>>> ${opCode === CanOperation.MULTIFRAME ? 'MF' : 'MF_END'} | Ignored | Src: ${sourceId} | Seq: ${subCode} (No active buffer found for Src/Tgt ${sourceId}-${targetId})`);
                    return;
                }

                const sequenceNumber = parsedFrame.canCommandSubCode; // Sequence from MULTI/END frame

                // if (sequenceNumber !== bufferInfo.nextSequence) {
                //     console.error(`>>> ${opCode === CanOperation.MULTIFRAME ? 'MF' : 'MF_END'} Sequence Error | Key: ${activeBufferKey} | Expected: ${bufferInfo.nextSequence}, Got: ${sequenceNumber}. Discarding.`);
                //     if (this.multiFrameTimeouts[activeBufferKey]) clearTimeout(this.multiFrameTimeouts[activeBufferKey]);
                //     delete this.multiFrameBuffers[activeBufferKey];
                //     delete this.multiFrameTimeouts[activeBufferKey];
                //     this.requestManager.resolveRequest({ ...bufferInfo.originalFrameInfo, canOperationCode: CanOperation.ERROR_ACK, data:[] });
                //     return;
                // }

                console.log(`>>> ${opCode === CanOperation.MULTIFRAME ? 'MF' : 'MF_END'} | Key: ${activeBufferKey} | Seq: ${sequenceNumber} | Data: ${formatBufferForLog(frameData)}`);

                // Reset timeout, append data, increment sequence
                if (this.multiFrameTimeouts[activeBufferKey]) clearTimeout(this.multiFrameTimeouts[activeBufferKey]);
                 this.multiFrameTimeouts[activeBufferKey] = setTimeout(() => { /* ... cleanup ... */ }, this.MULTIFRAME_TIMEOUT);

                bufferInfo.buffer[sequenceNumber] = {...frameData};
                //bufferInfo.buffer.push(...frameData);
                //bufferInfo.nextSequence++;

                // Send ACK referencing the original command context stored in bufferInfo
                this._sendAck(bufferInfo.originalFrameInfo);

                // --- Author's Suggestion: Check for completion after MULTIFRAME too ---
                let isComplete = false;
                if (opCode === CanOperation.MULTIFRAME_END) {
                    isComplete = true; // END frame always triggers final check
                } else if (opCode === CanOperation.MULTIFRAME) {
                    // Check if buffer length now matches expected length
                    if (bufferInfo.buffer.filter(x => x !== null).length >= bufferInfo.expectedLength) {
                        console.log(`>>> MF Completion Check Passed | Key: ${activeBufferKey} | Received: ${bufferInfo.buffer.length}, Expected: ${bufferInfo.expectedLength}`);
                        isComplete = true;
                    }
                }

                if (isComplete) {
                     // --- Assemble and Validate ---
                    if (this.multiFrameTimeouts[activeBufferKey]) clearTimeout(this.multiFrameTimeouts[activeBufferKey]); // Clear timeout on completion
                    delete this.multiFrameTimeouts[activeBufferKey];

                    const assembledData = bufferInfo.buffer;
                    const expected = bufferInfo.expectedLength;
                    const received = assembledData.length;

                    console.log(`>>> MF Final Check | Key: ${activeBufferKey} | Expected: ${expected} bytes | Received: ${received} bytes`);

                    if (received === expected) {
                       // ***** MODIFICATION HERE *****
                        // Construct the final frame using original context, but ensure
                        // the operation code allows it to pass the ACK filter in the parser.
                        const completedFrame = {
                            canCommandCode: bufferInfo.originalFrameInfo.canCommandCode,
                            canCommandSubCode: bufferInfo.originalFrameInfo.canCommandSubCode,
                            sourceDeviceCode: bufferInfo.originalFrameInfo.sourceDeviceCode,
                            targetDeviceCode: bufferInfo.originalFrameInfo.targetDeviceCode,
                            // Use an operation code that signifies data, not just ACK
                            // For example, use WRITE_CMD (0x00) or keep the original START op code (0x04)
                            // Using WRITE_CMD is simple and won't be filtered.
                            canOperationCode: CanOperation.WRITE_CMD, // <<< Changed from NORMAL_ACK
                            data: assembledData,
                        };
                        // ***** END MODIFICATION *****

                        console.log(`>>> MF Success | Key: ${activeBufferKey} | Passing data to parser.`);
                        this._parseAndEmitCompletedFrame(completedFrame, rawFrame.timestamp_us);
                        this.requestManager.resolveRequest({
                            ...bufferInfo.originalFrameInfo, // Original IDs/Cmds
                            canOperationCode: CanOperation.NORMAL_ACK, // Signal success status
                            data: assembledData // Include data in resolution if needed elsewhere
                        });
                    } else {
                        console.error(`>>> MF Length Mismatch | Key: ${activeBufferKey} | Expected: ${expected}, Got: ${received}. Discarding.`);
                        this.requestManager.resolveRequest({ ...bufferInfo.originalFrameInfo, canOperationCode: CanOperation.ERROR_ACK, data: [] });
                    }
                    // Clean up buffer
                    delete this.multiFrameBuffers[activeBufferKey];
                }
                // If !isComplete, we just sent the ACK and updated the buffer, wait for next frame.
                return; // Handled MULTIFRAME and MULTIFRAME_END

            } else {
                 // --- Single frame or standard ACK/NACK ---
                 this._parseAndEmitCompletedFrame(parsedFrame, rawFrame.timestamp_us);
                 this.requestManager.resolveRequest(parsedFrame);
                 return;
            }
        } catch (parseErr) {
            console.error("[CanBusService] Error handling received CAN frame:", parseErr, "Raw Frame ID:", rawFrame?.can_id?.toString(16));
            this.emit('can_error', 'Error processing received frame.');
        }
    }


    _parseAndEmitCompletedFrame(completedParsedFrame, timestamp_us) {
        // --- Skip Data Parsing for Simple ACKs/NACKs ---
		if ((completedParsedFrame.canOperationCode === CanOperation.NORMAL_ACK ||
             completedParsedFrame.canOperationCode === CanOperation.ERROR_ACK) &&
            (!completedParsedFrame.data || completedParsedFrame.data.length === 0 || (completedParsedFrame.data.length === 1 && completedParsedFrame.data[0] === 0)) // No data or just a single 0x00 byte for ACK
           ) {
             // console.log(`Received simple ACK/NACK (Op: ${completedParsedFrame.canOperationCode}) from ${completedParsedFrame.sourceDeviceCode.toString(16)} for ${completedParsedFrame.canCommandCode.toString(16)}/${completedParsedFrame.canCommandSubCode.toString(16)} - No data to parse.`);
             return;
         }
        // --- End ACK Check ---
        let parsedData = null; let dataType = 'unknown'; const sourceId = completedParsedFrame.sourceDeviceCode; const cmdCode = completedParsedFrame.canCommandCode; const subCode = completedParsedFrame.canCommandSubCode;
        switch (sourceId) {
             case DeviceNetworkId.DRIVE_UNIT: 
             dataType = 'controller'; 
             parsedData = { _rawBytes: [...completedParsedFrame.data] };
             if (cmdCode === 0x12)
                if (subCode === 0x00) { parsedData = BafangCanControllerParser.state(completedParsedFrame); dataType = 'controller_state'; }; 
			 if (cmdCode === 0x32) { 
                if (subCode === 0x00) { parsedData = BafangCanControllerParser.package0(completedParsedFrame); dataType = 'controller_realtime_0'; } 
                else if (subCode === 0x01) { parsedData = BafangCanControllerParser.package1(completedParsedFrame); dataType = 'controller_realtime_1'; } 
                else if (subCode === 0x03) { parsedData = BafangCanControllerParser.parameter3(completedParsedFrame); 
                    dataType = 'controller_speed_params'; 
                    this.cachedSpeedParams = { ...parsedData }; // Cache it
                    if (!parsedData.parseError) {parsedData._rawBytes = [...completedParsedFrame.data]}; } 			 
                else if (subCode === 0x05) {
                        parsedData = BafangCanControllerParser.parameter5(completedParsedFrame); dataType = 'controller_calories'; 
                        //console.log(`>>> RX Controller Calories (Raw): ${formatBufferForLog(completedParsedFrame.data)}`);
                        }
                else if (subCode === 0x06) {
                        parsedData = { controller_current_assist_level: completedParsedFrame.data[0] };
                        dataType = 'controller_current_assist_level';
                        //console.log(`>>> RX Controller Current Level (Raw): ${formatBufferForLog(completedParsedFrame.data)}`);
                        }
                else if (subCode === 0x0C) {
                        parsedData = { controller_total_assist_levels: completedParsedFrame.data[0] };
                        dataType = 'controller_total_assist_levels'; parsedData = { raw_data: completedParsedFrame.data };
                        //console.log(`>>> RX Controller Total levels (Raw): ${formatBufferForLog(completedParsedFrame.data)}`);
                }
             }					   
			 else if (cmdCode === 0x60) {
				  if (subCode === 0x10) { parsedData = BafangCanControllerParser.parameter0(completedParsedFrame); 
				  dataType = 'controller_params_0';
				  this.cachedParameter0 = { ...parsedData }; // Cache it
				  if (!parsedData.parseError) {parsedData._rawBytes = [...completedParsedFrame.data]}; // Add raw bytes!
				  } 
			 else if (subCode === 0x11) { parsedData = BafangCanControllerParser.parameter1(completedParsedFrame); 
				  dataType = 'controller_params_1'; 
				  this.cachedParameter1 = { ...parsedData }; // Cache it
				  if (!parsedData.parseError) {parsedData._rawBytes = [...completedParsedFrame.data]}; // Add raw bytes!
				  } 
			 else if (subCode === 0x12) { parsedData = BafangCanControllerParser.parameter2(completedParsedFrame); 
				  dataType = 'controller_params_2'; 
				  this.cachedParameter2= { ...parsedData }; // Cache it
				  if (!parsedData.parseError) {parsedData._rawBytes = [...completedParsedFrame.data]}; // Add raw bytes
				  }
			 else if (subCode === 0x17) {
						dataType = 'controller_params_6017'; 
			            parsedData = { _rawBytes: [...completedParsedFrame.data] };
                        console.log(`[CanBusService] Assembled controller_0x6017: ${completedParsedFrame.data.length} bytes`);
				  } 
			 else if (subCode === 0x18) {  
	                    dataType = 'controller_params_6018'; 
                        parsedData = { _rawBytes: [...completedParsedFrame.data] };
                        console.log(`[CanBusService] Assembled controller_0x6018: ${completedParsedFrame.data.length} bytes`);					
				  } 				  
			 else if (subCode === 0x00) { parsedData = { hardware_version: charsToString(completedParsedFrame.data) }; dataType = 'controller_hw_version'; } 
			 else if (subCode === 0x01) { parsedData = { software_version: charsToString(completedParsedFrame.data) }; dataType = 'controller_sw_version'; } 
			 else if (subCode === 0x03) { parsedData = { serial_number: charsToString(completedParsedFrame.data) }; dataType = 'controller_sn'; } 
			 else if (subCode === 0x02) { parsedData = { model_number: charsToString(completedParsedFrame.data) }; dataType = 'controller_mn'; }  
			 else if (subCode === 0x05) { parsedData = { manufacturer: charsToString(completedParsedFrame.data) }; dataType = 'controller_mfg'; } } 
			 else if (cmdCode === 0x62 && subCode === 0xD9) { // Handle Startup Angle Read Response
                 parsedData = BafangCanControllerParser.parameter4(completedParsedFrame); // Use parameter4 -> startupAngle
                 dataType = 'controller_startup_angle';
             }
			 else if (cmdCode === 0x62 && subCode === 0x07) { // System AutoOff
			     parsedData = { controller_auto_shutdown_time: completedParsedFrame.data[0] };
                 dataType = 'controller_system_auto_off'; 
				 //console.log(`>>> RX Controller Auto Off (Raw): ${formatBufferForLog(completedParsedFrame.data)}`);
             }
             break; 
			 
			 case DeviceNetworkId.DISPLAY: 
                dataType = 'display'; 
                parsedData = { _rawBytes: [...completedParsedFrame.data] };
					if (cmdCode === 0x63) { 
                        if (subCode === 0x00) { 
                                const rawAssistCode = (completedParsedFrame.data && completedParsedFrame.data.length > 1)
                                                    ? completedParsedFrame.data[1] // Get raw code from byte 1
                                                    : null; // Handle cases where data might be missing/short
                                parsedData = BafangCanDisplayParser.package0(completedParsedFrame);
                                dataType = 'display_realtime';
                                // Add the raw code to the parsed data object if parsing succeeded
                                if (parsedData && !parsedData.parseError && rawAssistCode !== null) {
                                    parsedData.current_assist_level_code = rawAssistCode;
                                } else if (rawAssistCode === null && !(parsedData && parsedData.parseError)) {
                                    // Log if raw code couldn't be read but parsing didn't report an error
                                    console.warn("Could not extract raw assist code for display_realtime, data length insufficient.");
                                }
                        } 
                        else if (subCode === 0x01) { parsedData = BafangCanDisplayParser.package1(completedParsedFrame); dataType = 'display_data_1'; } 
                        else if (subCode === 0x02) { parsedData = BafangCanDisplayParser.package2(completedParsedFrame); dataType = 'display_data_2'; } 
                        else if (subCode === 0x03) {
                                // Time settings: Bike autoshutdown (0x63/0x03)
                                if (completedParsedFrame.data && completedParsedFrame.data.length >= 1) {
                                    // Value is minutes, 255 means OFF
                                    parsedData = { display_auto_shutdown_time: completedParsedFrame.data[0] };
                                    dataType = 'display_autoshutdown_time';
                                } else {
                                    parsedData = { parseError: true, error: "Invalid data length for Display Auto Shutdown" };
                                    dataType = 'display_autoshutdown_time_error';
                                }
                        } else if (subCode === 0x04) { 
                            parsedData = BafangCanDisplayParser.package3(completedParsedFrame);
                            dataType = 'display_data_lightsensor';  //00 LightSensNum,  01 LightSensLevel,02 BacklightNum, 03 BacklightLevel 
                            //console.log(`>>> RX Display Data lighsensor (Raw): ${formatBufferForLog(completedParsedFrame.data)}`);//
                        }
                    }
					else if (cmdCode === 0x60) { 
                        if (subCode === 0x07) { parsedData = { error_codes: BafangCanDisplayParser.errorCodes(completedParsedFrame.data) }; dataType = 'display_errors'; } 
                        else if (subCode === 0x00) { parsedData = { hardware_version: charsToString(completedParsedFrame.data) }; dataType = 'display_hw_version'; } 
                        else if (subCode === 0x01) { parsedData = { software_version: charsToString(completedParsedFrame.data) }; dataType = 'display_sw_version'; } 
                        else if (subCode === 0x03) { parsedData = { serial_number: charsToString(completedParsedFrame.data) }; dataType = 'display_sn'; } 
                        else if (subCode === 0x02) { parsedData = { model_number: charsToString(completedParsedFrame.data) }; dataType = 'display_mn'; } 
                        else if (subCode === 0x04) { parsedData = { customer_number: charsToString(completedParsedFrame.data) }; dataType = 'display_cn'; } 
                        else if (subCode === 0x05) { parsedData = { manufacturer: charsToString(completedParsedFrame.data) }; dataType = 'display_mfg'; } 
                        else if (subCode === 0x08) { parsedData = { bootloader_version: charsToString(completedParsedFrame.data) }; dataType = 'display_bootloader_version'; } 
                    }
					else if (cmdCode === 0x21 && subCode === 0x64) 
					    { parsedData = { ack_display_2164: true }; dataType = 'display_ack_2164'; } 
					break; 
             
			 case DeviceNetworkId.BATTERY: 
                dataType = 'battery'; 
                parsedData = { _rawBytes: [...completedParsedFrame.data] };
                if (cmdCode === 0x34) { 
                    if (subCode === 0x00) { parsedData = BafangCanBatteryParser.capacity(completedParsedFrame); dataType = 'battery_capacity'; } 
                    else if (subCode === 0x01) { parsedData = BafangCanBatteryParser.state(completedParsedFrame); dataType = 'battery_state'; } 
                } 
                else if (cmdCode === 0x64) { 
                    if (subCode === 0x00) { parsedData = BafangCanBatteryParser.design(completedParsedFrame); dataType = 'battery_design'; } 
                    else if (subCode === 0x01) { parsedData = BafangCanBatteryParser.chargingInfo(completedParsedFrame); dataType = 'battery_charging_info'; } 
                    else {
                        parsedData = { raw_cell_data: completedParsedFrame.data, subcode: subCode }; dataType = 'battery_cells_raw'; 
                    }
                }  //00 BMSSerialNum, 01 BMSParallelNum, 03 BMSDesignCapacity(mAh), 0x640101 BMSCycleCount, 03 BMSMaxChaInterval(h), 05 BMSCurChaInterval(h)"
                else if (cmdCode === 0x60) { 
                    if (subCode === 0x00) { parsedData = { hardware_version: charsToString(completedParsedFrame.data) }; dataType = 'battery_hw_version'; } 
                    else if (subCode === 0x01) { parsedData = { software_version: charsToString(completedParsedFrame.data) }; dataType = 'battery_sw_version'; } 
                    else if (subCode === 0x03) { parsedData = { serial_number: charsToString(completedParsedFrame.data) }; dataType = 'battery_sn'; } 
                    else if (subCode === 0x02) { parsedData = { model_number: charsToString(completedParsedFrame.data) }; dataType = 'battery_mn'; } 
                } 
                break; // Added mn
             case DeviceNetworkId.TORQUE_SENSOR: 
                dataType = 'sensor'; 
                parsedData = { _rawBytes: [...completedParsedFrame.data] };
                if (cmdCode === 0x31 && subCode === 0x00) { parsedData = BafangCanSensorParser.package0(completedParsedFrame); dataType = 'sensor_realtime'; } 
                else if (cmdCode === 0x60) { if (subCode === 0x00) { parsedData = { hardware_version: charsToString(completedParsedFrame.data) }; dataType = 'sensor_hw_version'; } 
                else if (subCode === 0x01) { parsedData = { software_version: charsToString(completedParsedFrame.data) }; dataType = 'sensor_sw_version'; } 
                else if (subCode === 0x03) { parsedData = { serial_number: charsToString(completedParsedFrame.data) }; dataType = 'sensor_sn'; } 
                else if (subCode === 0x02) { parsedData = { model_number: charsToString(completedParsedFrame.data) }; dataType = 'sensor_mn'; } } 
                break; // Added mn
             case DeviceNetworkId.BESST: dataType = 'besst'; 
                parsedData = { _rawBytes: [...completedParsedFrame.data] };
                if (cmdCode === 0x35 && subCode === 0x01) 
                { parsedData = { besst_status_3501: completedParsedFrame.data }; 
                dataType = 'besst_status_3501'; } 
                break;
             default: 
                dataType = `unknown_source_0x${sourceId.toString(16)}`; 
                parsedData = { original_frame: completedParsedFrame }; 
			 break;
        }
        if (parsedData && !parsedData.parseError) {
            if(!parsedData._rawBytes)
                parsedData._rawBytes = [...completedParsedFrame.data]
            this.emit('bafang_data_received', { type: dataType, source: sourceId, cmdCode, subCode, data: parsedData, timestamp_us: timestamp_us || Date.now() * 1000 });
        } else if (dataType !== 'unknown' && parsedData && parsedData.parseError) { 
            console.warn(`Parsing error for ${dataType}:`, parsedData.error || "Unknown error", "Original Frame:", completedParsedFrame); 
        } 
        // No need to emit unhandled ACKs as they were handled earlier
        // else if (dataType === 'unknown' && completedParsedFrame.canOperationCode !== CanOperation.NORMAL_ACK) { /* Potentially emit unhandled non-ACK frames */ }
    }

    _handleCanError(err) {
        console.error('[CanBusService] CAN device error (candlelightjs):', err);
        const wasStarted = this.isStarted;
        this.isStarted = false;
        // this.connectedDeviceName = null; // Keep last known name for potential "disconnected from X" message
        this.requestManager.clearAllRequests();
        Object.keys(this.multiFrameTimeouts).forEach(key => {
           clearTimeout(this.multiFrameTimeouts[key]);
           delete this.multiFrameTimeouts[key];
        });
        this.multiFrameBuffers = {};

        // Only emit 'can_error' if it was previously started.
        // The 'can_status' event from close() or init() failure will handle other cases.
        if (wasStarted) {
            this.emit('can_error', `CAN Error: ${err.message || err}`);
        }
     }

    // --- Public Methods using Request Manager (remain the same) ---
    async readParameter(target, can_command, data = null){ 
         if (!this.isStarted) return { success: false, error: 'CAN device not started', timedOut: false };
         const dataLog = data ? ` Data=[${data.map(b => b.toString(16).padStart(2,'0')).join(',')}]` : "";
         console.log(`Initiating read: Target=0x${target.toString(16)}, Cmd=0x${can_command.canCommandCode.toString(16)}, Sub=0x${can_command.canCommandSubCode.toString(16)}${dataLog}`);
         return requestFunctions.readParameter(this, this.requestManager, target, can_command, data); 
    }
    async writeShortParameterWithAck(target, can_command, data) { 
         if (!this.isStarted) return { success: false, error: 'CAN device not started', timedOut: false };
          console.log(`Initiating short write: Target=0x${target.toString(16)}, Cmd=0x${can_command.canCommandCode.toString(16)}, Sub=0x${can_command.canCommandSubCode.toString(16)}`);
         return requestFunctions.writeShortParameter(this, this.requestManager, target, can_command, data);
    }
    async writeLongParameterWithAck(target, can_command, value) { 
         if (!this.isStarted) return { success: false, error: 'CAN device not started', timedOut: false };
         console.log(`Initiating long write: Target=0x${target.toString(16)}, Cmd=0x${can_command.canCommandCode.toString(16)}, Sub=0x${can_command.canCommandSubCode.toString(16)}`);
         return requestFunctions.writeLongParameter(this, this.requestManager, target, can_command, value);
    }

    // --- Public Write Methods (using Serializers - remain the same) ---
    saveControllerParams0 = async (partialParams0Data) => {
        if (!this.cachedParameter0) {
            console.error("[CanBusService] Cannot save Parameter0: No cached data available. Please read parameters first.");
            this.emit('can_error', 'Save P0 failed: Cache empty. Read first.');
            return;
        }
        // Deep merge might be better if params0Data has nested objects that are partially updated
        const mergedParams0Data = { ...this.cachedParameter0, ...partialParams0Data };
        if (partialParams0Data.acceleration_levels) mergedParams0Data.acceleration_levels = partialParams0Data.acceleration_levels;
        if (partialParams0Data.assist_ratio_levels) mergedParams0Data.assist_ratio_levels = partialParams0Data.assist_ratio_levels;

        bafangSerializer.prepareParameter0WriteData(this, mergedParams0Data);
    }

    saveControllerParams1 = async (partialParams1Data) => {
        if (!this.cachedParameter1) {
            console.error("[CanBusService] Cannot save Parameter1: No cached data available. Please read parameters first.");
            this.emit('can_error', 'Save P1 failed: Cache empty. Read first.');
            return;
        }
        const mergedParams1Data = { ...this.cachedParameter1, ...partialParams1Data };
        // Handle assist_levels specifically if it's in the partial data
        if (partialParams1Data.assist_levels) {
            mergedParams1Data.assist_levels = partialParams1Data.assist_levels;
        }
        bafangSerializer.prepareParameter1WriteData(this, mergedParams1Data);
    }

    saveControllerParams2 = async (partialParams2Data) => {
        if (!this.cachedParameter2) {
            console.error("[CanBusService] Cannot save Parameter2: No cached data available. Please read parameters first.");
            this.emit('can_error', 'Save P2 failed: Cache empty. Read first.');
            return;
        }
        const mergedParams2Data = { ...this.cachedParameter2, ...partialParams2Data };
        // Handle torque_profiles specifically
        if (partialParams2Data.torque_profiles) {
            mergedParams2Data.torque_profiles = partialParams2Data.torque_profiles;
        }
        bafangSerializer.prepareParameter2WriteData(this, mergedParams2Data);
    }

    async saveControllerSpeedParams(partialSpeedParamsData) {
        if (!this.cachedSpeedParams) {
            console.error("[CanBusService] Cannot save SpeedParams: No cached data available. Please read parameters first.");
            this.emit('can_error', 'Save SpeedParams failed: Cache empty. Read first.');
            return;
        }
        const mergedSpeedParams = { ...this.cachedSpeedParams, ...partialSpeedParamsData };
        // Ensure wheel_diameter.code is handled correctly if partially updated
        if (partialSpeedParamsData.wheel_diameter && partialSpeedParamsData.wheel_diameter.code) {
            mergedSpeedParams.wheel_diameter = { ...this.cachedSpeedParams.wheel_diameter, ...partialSpeedParamsData.wheel_diameter };
        } else if (partialSpeedParamsData.wheel_diameter) { // if only description changes
             mergedSpeedParams.wheel_diameter = { ...this.cachedSpeedParams.wheel_diameter, description: partialSpeedParamsData.wheel_diameter.description };
        }


        bafangSerializer.prepareSpeedPackageWriteData(this, mergedSpeedParams);
    }

    async saveDisplayTotalMileage(mileage) { bafangSerializer.prepareTotalMileageWriteData(this, mileage); }
    async saveDisplaySingleMileage(mileage) { bafangSerializer.prepareSingleMileageWriteData(this, mileage); }
    async saveDisplayTime(hours, minutes, seconds) { bafangSerializer.prepareTimeWriteData(this, hours, minutes, seconds); }
	async setDisplayServiceThreshold(thresholdKm) {bafangSerializer.prepareSetServiceThresholdWriteData(this, thresholdKm); }
    async cleanDisplayServiceMileage() { bafangSerializer.prepareCleanServiceMileageWriteData(this); }
    async saveStringParameter(targetDeviceId, commandInfo, value) { bafangSerializer.prepareStringWriteData(this, value, targetDeviceId, commandInfo); }
    async saveControllerStartupAngle(angle) {bafangSerializer.prepareStartupAngleWriteData(this, angle); }

 
     
     /* @param {DeviceNetworkId} targetDeviceId - The target device (e.g., DeviceNetworkId.DRIVE_UNIT).
     * @param {object} commandInfo - From CanWriteCommandsList (e.g., CanWriteCommandsList.Parameter1).
     * @param {number[]} byteArray - The raw byte array (e.g., 64 bytes for P0/P1/P2).
     * @returns {Promise<boolean>} True if the send sequence was initiated, false otherwise.
     */
    async writeRawBytesParameter(targetDeviceId, commandInfo, byteArray) {
        if (!this.isStarted) {
            console.warn('[CanBusService] Attempted writeRawBytesParameter while disconnected.');
            this.emit('can_error', `Raw Write attempt failed: Disconnected (Cmd ${commandInfo.canCommandCode}/${commandInfo.canCommandSubCode})`);
            return false;
        }
        if (!commandInfo || typeof commandInfo.canCommandCode === 'undefined' || typeof commandInfo.canCommandSubCode === 'undefined') {
            console.error('[CanBusService] Invalid commandInfo for writeRawBytesParameter.');
            this.emit('can_error', `Invalid command for raw write.`);
            return false;
        }
        if (!Array.isArray(byteArray) || !byteArray.every(b => typeof b === 'number' && b >= 0 && b <= 255)) {
            console.error('[CanBusService] Invalid byteArray for writeRawBytesParameter.');
            this.emit('can_error', `Invalid byte array for raw write (Cmd ${commandInfo.canCommandCode}/${commandInfo.canCommandSubCode})`);
            return false;
        }

        console.log(`[CanBusService] Initiating raw byte write: Target=0x${targetDeviceId.toString(16)}, Cmd=0x${commandInfo.canCommandCode.toString(16)}/${commandInfo.canCommandSubCode.toString(16)}, Len=${byteArray.length}`);

        try {
            // Directly call the serializer's writeLongParameter function,
            // which is designed to take a raw byte array for the 'value'.
            await bafangSerializer.writeLongParameter(this, targetDeviceId, commandInfo, byteArray);
            // writeLongParameter in serializer is async but doesn't return a success boolean itself.
            // We assume if it doesn't throw, the sequence started.
            return true;
        } catch (error) {
            console.error(`[CanBusService] Error during writeRawBytesParameter (Cmd ${commandInfo.canCommandCode}/${commandInfo.canCommandSubCode}):`, error);
            this.emit('can_error', `Error sending raw write: ${error.message} (Cmd ${commandInfo.canCommandCode}/${commandInfo.canCommandSubCode})`);
            return false;
        }
    }
	
	async calibrateControllerPositionSensor() {
        const cmd = { canCommandCode: 0x62, canCommandSubCode: 0x00 }; // CalibratePositionSensor command
        const data = [0x00, 0x00, 0x00, 0x00, 0x00]; // Standard payload
        console.log(`Initiating Calibrate Position Sensor command...`);
        // Use the method that tracks ACKs
        return this.writeShortParameterWithAck(DeviceNetworkId.DRIVE_UNIT, cmd, data);
    }
    async sendRawFrame(idHexString, dataHexString) { const commandString = `${idHexString}#${dataHexString}`; return await this.sendFrame(commandString); }

    // --- sendFrame (Low-level sender - Unchanged) ---
    async sendFrame(commandString) { /* ... */
        if (!this.isStarted) throw new Error('CAN device not connected/started.'); 
        try { 
            const parts = commandString.split('#'); 
            if (parts.length !== 2) 
                throw new Error('Invalid command format.'); 
            const idHex = parts[0]; const dataHex = parts[1]; const canId = parseInt(idHex, 16); 
            if (isNaN(canId)) 
                throw new Error('Invalid CAN ID format.'); 
            const dataBytes = []; 
            if (dataHex) { 
                if (dataHex.length % 2 !== 0) 
                    throw new Error('Invalid Data Hex.'); 
                for (let i = 0; i < dataHex.length; i += 2) { 
                    const byte = parseInt(dataHex.substring(i, i + 2), 16); 
                    if (isNaN(byte)) throw new Error('Invalid Data Hex.'); 
                    dataBytes.push(byte); 
                } 
                if (dataBytes.length > 8) 
                    throw new Error('CAN data payload too long.'); 
            } 
            const frameToSend = new CanFrame(this.frameLength); 
            frameToSend.can_id = canId | CAN_EFF_FLAG; 
            /* Ensure Extended ID flag is set */; 
            frameToSend.can_dlc = dataBytes.length; 
            for (let i = 0; i < dataBytes.length; i++) 
                frameToSend.data.setUint8(i, dataBytes[i]); 
            frameToSend.echo_id = 0xFFFFFFFF; frameToSend.channel = 0; frameToSend.flags = 0; frameToSend.reserved = 0; 
            //console.log(`Sending CAN frame: ID=${idHex}, Data=[${dataBytes.map(b => b.toString(16).padStart(2,'0')).join(',')}]`);
            const success = await this.canDevice.writeCANFrame(frameToSend); 
            if (!success) { 
                console.error('CAN -> Failed send'); return false; } return true; 
            } catch (err) { console.error('Error sending CAN frame:', err); throw err; }
    }

    isConnected() { return this.isStarted; }

    async close() {
        if (!this.canDevice) {
            console.log('[CanBusService] No CAN device instance to close.');
            this.isStarted = false; // Ensure state is consistent
            // this.emit('can_status', false, 'CAN device was not initialized.'); // Avoid if not needed
            return;
        }
        if (!this.isStarted && !this.canDevice.gs_usb) { // Check if gs_usb object exists (meaning open was attempted)
            console.log('[CanBusService] CAN device already stopped or never fully started.');
            this.isStarted = false;
            // this.emit('can_status', false, 'CAN device already stopped.'); // Avoid redundant emits
            return;
        }

        console.log('[CanBusService] Stopping CAN device...');
		this.requestManager.stopQueueProcessor();
        this.requestManager.clearAllRequests();

        Object.keys(this.multiFrameTimeouts).forEach(key => {
           clearTimeout(this.multiFrameTimeouts[key]);
           delete this.multiFrameTimeouts[key];
        });
        this.multiFrameBuffers = {};
        const previouslyConnectedDeviceName = this.connectedDeviceName; // Store before clearing

        try {
            if (this.canDevice.pollCanFrames) { // Check if polling was active
                 await this.canDevice.stopPolling();
            }
            if (this.canDevice.gs_usb) { // Check if gs_usb (the usb.Device object) exists
                await this.canDevice.stop(); // This calls _disableCanHardware and then gs_usb.close()
            }
            this.isStarted = false;
            this.connectedDeviceName = null; // Clear the name on successful close
            console.log('[CanBusService] CAN device stopped.');
            this.emit('can_status', false, `CAN device disconnected (${previouslyConnectedDeviceName || 'Unknown Device'}).`);
        }
        catch (err) {
            console.error('[CanBusService] Error stopping CAN device:', err);
            this.isStarted = false; // Ensure state reflects stop attempt
            this.connectedDeviceName = null; // Clear name on error too
            this.emit('can_status', false, `Error stopping CAN device: ${err.message}`);
         }
    }
}

module.exports = new CanBusService();