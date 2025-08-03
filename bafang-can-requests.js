// bafang-can-requests.js
"use strict";
const { CanOperation, DeviceNetworkId } = require('./bafang-constants');
//const { generateCanFrameId, bafangIdArrayTo32Bit } = require('./bafang-parser');

/**
 * Enqueues a READ command request.
 * @param {CanBusService} canbusInstance - The CanBusService instance (needed by RequestManager).
 * @param {RequestManager} requestManagerInstance - The RequestManager instance.
 * @param {DeviceNetworkId} target - The target device ID.
 * @param {object} can_command - Command object { canCommandCode, canCommandSubCode }.
 * @param {number[]|null} [data=null] - Optional data payload for the read request.
 * @returns {Promise<object>} Promise resolving with { success: boolean, error: string|null, timedOut: boolean }.
 */
function readParameter(canbusInstance, requestManagerInstance, target, can_command, data = null) { 
    return new Promise((resolve, reject) => {
        try {
            if (!canbusInstance.isConnected()) {
                 return resolve({ success: false, error: 'CAN device not connected', timedOut: false });
            }
            const source = DeviceNetworkId.BESST; // Tool is the source
            const code = can_command.canCommandCode;
            const subcode = can_command.canCommandSubCode;
			
			// --- Validation for optional data ---
            if (data && (!Array.isArray(data) || data.length > 16)) {
                 console.error(`Invalid data payload provided for readParameter enqueue: Length ${data?.length}`);
                 return resolve({ success: false, error: 'Invalid data payload length for read request.', timedOut: false });
            }

            // Enqueue the request
            requestManagerInstance.enqueueRequest({
                source,
                target,
                operation: CanOperation.READ_CMD,
                code,
                subcode,
                data: data, // Pass the provided data (or null)
                promiseControls: { resolve, reject } // Pass the promise controls
            });

        } catch (error) {
             console.error("Error preparing readParameter for queue:", error);
             resolve({ success: false, error: `Internal error: ${error.message}`, timedOut: false });
        }
    });
}

/**
 * Enqueues a short WRITE command request.
 * @param {CanBusService} canbusInstance - The CanBusService instance.
 * @param {RequestManager} requestManagerInstance - The RequestManager instance.
 * @param {DeviceNetworkId} target - The target device ID.
 * @param {object} can_command - Command object { canCommandCode, canCommandSubCode }.
 * @param {number[]} data - Data payload array.
 * @returns {Promise<object>} Promise resolving with { success: boolean, error: string|null, timedOut: boolean }.
 */
function writeShortParameter(canbusInstance, requestManagerInstance, target, can_command, data) {
     return new Promise((resolve, reject) => {
         try {
            if (!canbusInstance.isConnected()) {
                 return resolve({ success: false, error: 'CAN device not connected', timedOut: false });
            }
            const source = DeviceNetworkId.BESST;
            const code = can_command.canCommandCode;
            const subcode = can_command.canCommandSubCode;

             // Basic data validation
             if (!Array.isArray(data) || data.length > 8) {
                 console.error(`Invalid data for writeShortParameter enqueue: Length ${data?.length}`);
                 return resolve({ success: false, error: 'Invalid data payload length for short write.', timedOut: false });
             }

            // Enqueue the request
            requestManagerInstance.enqueueRequest({
                source,
                target,
                operation: CanOperation.WRITE_CMD,
                code,
                subcode,
                data: data, // Include data payload
                promiseControls: { resolve, reject }
            });

         } catch (error) {
             console.error("Error preparing writeShortParameter for queue:", error);
             resolve({ success: false, error: `Internal error: ${error.message}`, timedOut: false });
         }
    });
}

/**
 * Enqueues a long WRITE command request (multi-frame).
 * Note: The actual multi-frame sending is still handled by the low-level serializer,
 * but this function now just queues the *intention* to write. The RequestManager
 * will eventually trigger the low-level writeLongParameter when dequeuing.
 * We need to adjust the RequestManager to handle this.
 *
 * *** Revised Approach: Keep writeLongParameter calling the serializer directly,
 *     but have the serializer enqueue individual frames. This is too complex.
 *
 * *** Simpler Approach: Let RequestManager handle the data, and the low-level
 *     sendFrame in canbus.js will just send whatever it gets. The serializer
 *     should be called *by the RequestManager* when dequeuing.
 *
 * *** Final Approach for now: Let bafang-can-requests call the low-level
 *     serializer directly, and the serializer uses canbus.sendFrame, bypassing
 *     the RequestManager queue for the individual MF parts. Only the *overall*
 *     write operation needs ACK tracking via RequestManager.registerForAck.
 */
async function writeLongParameter(canbusInstance, requestManagerInstance, target, can_command, value) {
      // Keep calling the low-level serializer which sends multiple frames
      // but register only ONCE for the final ACK.
      // eslint-disable-next-line no-async-promise-executor
      return new Promise(async (resolve, reject) => {
         try {
            if (!canbusInstance.isConnected()) {
                 return resolve({ success: false, error: 'CAN device not connected', timedOut: false });
            }
            const source = DeviceNetworkId.BESST;
            const code = can_command.canCommandCode;
            const subcode = can_command.canCommandSubCode;

            // Await the completion of sending *all* multi-frame packets via serializer
            // Import the low-level function directly here or keep it in bafang-serializer
            const { writeLongParameter: lowLevelWriteLong } = require('./bafang-serializer');
            await lowLevelWriteLong(canbusInstance, target, can_command, value);

            // Register for the final ACK *after* all frames have been sent
            requestManagerInstance.registerForAck(source, target, CanOperation.WRITE_CMD, code, subcode, { resolve, reject });

         } catch (error) {
             console.error("Error sending writeLongParameter sequence:", error);
             // Ensure promise resolves even if sending fails before registration
             resolve({ success: false, error: `Send error: ${error.message}`, timedOut: false });
         }
    });
}


module.exports = {
    readParameter,
    writeShortParameter,
    writeLongParameter,
};