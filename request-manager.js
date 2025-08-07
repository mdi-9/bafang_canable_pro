// request-manager.js
"use strict";

const { CanOperation, DeviceNetworkId } = require('./bafang-constants');
const { generateCanFrameId, bafangIdArrayTo32Bit } = require('./bafang-parser');

const DEFAULT_TIMEOUT = 3000; // 3 seconds for response timeout
const READ_RETRY_LIMIT = 3;
const DEFAULT_SEND_INTERVAL = 50; // Minimum ms between sending non-ACK frames
const QUEUE_PROCESS_INTERVAL = 20; // How often to check the send queue (ms)

class RequestManager {
    constructor(canbusInstance) {
        this.canbus = canbusInstance; // Reference to CanBusService to send frames
        // Structure for pending ACKs: { targetId: { cmdCode: { subCode: { promiseControls, operation, timeoutHandle, attempts } } } }
        this.pendingAckRequests = {};
        this.ackTimeoutIds = new Set(); // Keep track of active ACK timeouts

        // --- Outgoing Request Queue ---
        this.requestQueue = []; // Stores { details: { source, target, operation, code, subcode, data, promiseControls, attempt }, timestampAdded }
        this.isProcessingQueue = false;
        this.lastSentTimestamp = 0;
        this.queueProcessorIntervalId = null;
    }

    /**
     * Starts the loop that processes the outgoing request queue.
     */
    startQueueProcessor() {
        if (this.queueProcessorIntervalId) return; // Already running
        console.log('[RequestManager] Starting outgoing queue processor.');
        this.isProcessingQueue = false; // Ensure it's reset
        this.lastSentTimestamp = 0; // Reset timestamp
        this.queueProcessorIntervalId = setInterval(
            () => this.processRequestQueue(),
            QUEUE_PROCESS_INTERVAL
        );
    }

    /**
     * Stops the outgoing request queue processing loop.
     */
    stopQueueProcessor() {
        if (this.queueProcessorIntervalId) {
            console.log('[RequestManager] Stopping outgoing queue processor.');
            clearInterval(this.queueProcessorIntervalId);
            this.queueProcessorIntervalId = null;
            this.isProcessingQueue = false;
        }
    }

    /**
     * Adds a request to the outgoing queue.
     * @param {object} requestDetails - Contains source, target, operation, code, subcode, data, promiseControls.
     * @param {number} [attempt=1] - The attempt number for this request.
     */
    enqueueRequest(requestDetails, attempt = 1) {
        if (!this.canbus || !this.canbus.isConnected()) {
             console.warn(`[RequestManager] Cannot enqueue request while disconnected: Target=0x${requestDetails.target.toString(16)}, Cmd=0x${requestDetails.code.toString(16)}`);
             if (requestDetails.promiseControls && requestDetails.promiseControls.resolve) {
                 requestDetails.promiseControls.resolve({ success: false, error: 'CAN device disconnected', timedOut: false });
             }
             return;
        }
        console.log(`[RequestManager] Enqueuing request: Target=0x${requestDetails.target.toString(16)}, Cmd=0x${requestDetails.code.toString(16)}, Sub=0x${requestDetails.subcode.toString(16)},Data=[${requestDetails.data?.map(b => b.toString(16).padStart(2,'0')).join(',')}] ,Attempt=${attempt}`);
        this.requestQueue.push({
            details: { ...requestDetails, attempt: attempt }, // Store attempt count in details
            timestampAdded: Date.now()
        });
        // Ensure the processor is running
        if (!this.queueProcessorIntervalId) {
            this.startQueueProcessor();
        }
    }

    /**
     * Processes the next request in the queue if the delay condition is met.
     */
    async processRequestQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0 || !this.canbus || !this.canbus.isConnected()) {
            // Stop processing if busy, queue empty, or disconnected
             if (!this.canbus || !this.canbus.isConnected()) {
                 if (this.requestQueue.length > 0) {
                     // console.log("[RequestManager] Pausing queue processing - disconnected.");
                 }
                 // Don't clear the queue here, just stop processing until reconnected
                 this.stopQueueProcessor(); // Stop the interval if disconnected
             }
            return;
        }

        this.isProcessingQueue = true; // Lock processing

        try {
            const now = Date.now();
            const queuedItem = this.requestQueue[0]; // Peek at the next request
            // Deconstruct details, including the attempt count
            const { source, target, operation, code, subcode, data, promiseControls, attempt } = queuedItem.details;

            // Calculate required delay
            let requiredDelay = DEFAULT_SEND_INTERVAL;
           // if (code === 0x60) { // Special delay for command 0x60 as per author
                const calculatedDelay = 50 * (subcode % 5); // Example: 50ms base * (subcode mod 5)
                requiredDelay = Math.max(DEFAULT_SEND_INTERVAL, calculatedDelay); // Use calculated or default, whichever is larger
           // }

            if (now - this.lastSentTimestamp >= requiredDelay) {
                // --- Send the request ---
                this.requestQueue.shift(); // Remove from queue *before* sending
                this.lastSentTimestamp = now; // Update timestamp *before* async send

                console.log(`[RequestManager] Dequeuing & Sending: Tgt=0x${target.toString(16)}, Cmd=0x${code.toString(16)}, Sub=0x${subcode.toString(16)},Data=[${data?.map(b => b.toString(16).padStart(2,'0')).join(',')}] Attempt=${attempt}, Delay=${now - this.lastSentTimestamp}ms (Req: ${requiredDelay}ms)`);

                const bafangIdArr = generateCanFrameId(source, target, operation, code, subcode);
                const canId32bit = bafangIdArrayTo32Bit(bafangIdArr);
                //let dataHex = "";
                // Prepare data hex only for write operations
                let dataHex = data ? Buffer.from(data).toString('hex') : "";
                // if (operation === CanOperation.WRITE_CMD) {
                //      dataHex = data ? Buffer.from(data).toString('hex') : "";
                //      // Note: Long writes are handled differently (see bafang-can-requests.js)
                //      // This path is mainly for READ and WRITE_SHORT
                // }

                try {
                    // Use the low-level canbus sendFrame
                    const sent = await this.canbus.sendFrame(`${canId32bit.toString(16).padStart(8, '0')}#${dataHex}`);

                    if (sent) {
                        // Successfully sent, now register for ACK/timeout
                        // Pass the correct 'attempt' count when registering
                        this.registerForAck(source, target, operation, code, subcode, promiseControls, attempt, data);
                    } else {
                        console.error(`[RequestManager] sendFrame failed for ${code}/${subcode}`);
                        if (promiseControls) {
                            promiseControls.resolve({ success: false, error: 'Failed to send frame via CAN bus', timedOut: false });
                        }
                    }
                } catch (sendError) {
                    console.error(`[RequestManager] Error during sendFrame for ${code}/${subcode}:`, sendError);
                    if (promiseControls) {
                        promiseControls.resolve({ success: false, error: `Send error: ${sendError.message}`, timedOut: false });
                    }
                }
            } else {
                 // Optional: Log if waiting
                 // console.log(`[RequestManager] Waiting for delay: ${requiredDelay - (now - this.lastSentTimestamp)}ms remaining`);
            }
        } catch (error) {
            console.error("[RequestManager] Error processing queue:", error);
            // Try to remove the problematic item and resolve its promise as failed
            const failedRequest = this.requestQueue.shift();
             if (failedRequest?.details?.promiseControls) {
                 failedRequest.details.promiseControls.resolve({ success: false, error: `Queue processing error: ${error.message}`, timedOut: false });
             }
        } finally {
            this.isProcessingQueue = false; // Unlock processing
            // If the queue is now empty, maybe stop the processor? Or let it run.
            // if (this.requestQueue.length === 0) {
            //     this.stopQueueProcessor();
            // }
        }
    }

    /**
     * Registers a request *after* it has been sent, waiting for an acknowledgment or response.
     * @param {number} source - Source DeviceNetworkId.
     * @param {number} target - Target DeviceNetworkId.
     * @param {CanOperation} operation - The operation performed.
     * @param {number} code - The CAN command code.
     * @param {number} subcode - The CAN command sub-code.
     * @param {object} promiseControls - Object containing { resolve, reject } functions.
     * @param {number} [attempt=1] - Current attempt number (for retries).
     */
   registerForAck(source, target, operation, code, subcode, promiseControls, attempt = 1, data = null) {
        if (!promiseControls || !promiseControls.resolve) return;
        if (!this.canbus) { /* ... handle no canbus ... */ return; }

        // --- Check for duplicate registration ---
        if (this.pendingAckRequests[target]?.[code]?.[subcode]) {
             console.warn(`[RequestManager] Duplicate ACK registration ignored: Tgt=0x${target.toString(16)}, Cmd=0x${code.toString(16)}, Sub=0x${subcode.toString(16)}`);
             return;
        }
        // --- End check ---

        if (!this.pendingAckRequests[target]) this.pendingAckRequests[target] = {};
        if (!this.pendingAckRequests[target][code]) this.pendingAckRequests[target][code] = {};

        // Clear any potential leftover timeout (shouldn't happen with duplicate check, but safe)
        // (No change needed here)

        const timeoutHandle = setTimeout(() => {
            this.ackTimeoutIds.delete(timeoutHandle);
            const requestInfo = this.pendingAckRequests[target]?.[code]?.[subcode];

            if (requestInfo) {
                 console.warn(`ACK timed out: Target=0x${target.toString(16)}, Cmd=0x${code.toString(16)}, Sub=0x${subcode.toString(16)}, Attempt=${attempt}`);

                // Retry logic for READ commands
                if (operation === CanOperation.READ_CMD && attempt < READ_RETRY_LIMIT) {
                    const nextAttempt = attempt + 1;
                    console.log(`Enqueueing retry (Attempt ${nextAttempt}) for read ${code}/${subcode}`);

                    // Clean up the *current* timed-out pending ACK entry *before* enqueueing retry
                    // (No change needed here, cleanup happens before enqueue)
                    delete this.pendingAckRequests[target][code][subcode];
                    if (Object.keys(this.pendingAckRequests[target][code]).length === 0) delete this.pendingAckRequests[target][code];
                    if (Object.keys(this.pendingAckRequests[target]).length === 0) delete this.pendingAckRequests[target];

                    this.enqueueRequest(
                        { source, target, operation, code, subcode, data, promiseControls },
                        nextAttempt
                    );

                } else {
                    // No more retries or not READ
                    const failureReason = (operation === CanOperation.READ_CMD)
                        ? `Request failed after ${READ_RETRY_LIMIT} attempts (Timeout)`
                        : 'Request timed out (no ACK)';

                    if (operation === CanOperation.READ_CMD) {
                        console.error(`Read request failed after ${READ_RETRY_LIMIT} attempts: Target=0x${target.toString(16)}, Cmd=0x${code.toString(16)}, Sub=0x${subcode.toString(16)}`);
                    } else {
                        console.error(`Write request timed out: Target=0x${target.toString(16)}, Cmd=0x${code.toString(16)}, Sub=0x${subcode.toString(16)}`);
                    }

                    // 1. Resolve the promise as failed
                    if (requestInfo.promiseControls && typeof requestInfo.promiseControls.resolve === 'function') {
                        requestInfo.promiseControls.resolve({ success: false, error: failureReason, timedOut: true });
                    }

                    // 2. Schedule the cleanup of the entry AFTER a short delay
                    //    This keeps the entry present to block immediate duplicates via enqueueRequest.
                    const cleanupDelay = 200; // ms - adjust as needed, maybe slightly more than queue interval
                    console.log(`[RequestManager] Scheduling cleanup for failed request ${target}/${code}/${subcode} in ${cleanupDelay}ms.`);
                    setTimeout(() => {
                        // Check if the entry *still* exists before deleting, just in case
                        // something else resolved it in the meantime (unlikely but safe).
                        if (this.pendingAckRequests[target]?.[code]?.[subcode] === requestInfo) {
                            console.log(`[RequestManager] Executing delayed cleanup for ${target}/${code}/${subcode}.`);
                            delete this.pendingAckRequests[target][code][subcode];
                            if (Object.keys(this.pendingAckRequests[target]?.[code] ?? {}).length === 0) delete this.pendingAckRequests[target][code];
                            if (Object.keys(this.pendingAckRequests[target] ?? {}).length === 0) delete this.pendingAckRequests[target];
                        } else {
                            console.log(`[RequestManager] Delayed cleanup skipped for ${target}/${code}/${subcode} (entry changed or removed).`);
                        }
                    }, cleanupDelay);

                    // DO NOT delete the entry immediately here anymore.
                    // delete this.pendingAckRequests[target][code][subcode];
                    // ... (cleanup parent objects logic is moved to the setTimeout callback) ...
                }
            }
        }, DEFAULT_TIMEOUT);

        this.ackTimeoutIds.add(timeoutHandle);

        this.pendingAckRequests[target][code][subcode] = {
            promiseControls,
            operation: operation,
            timeoutHandle,
            attempts: attempt
        };
    }

    /**
     * Resolves a pending request based on an incoming frame (ACK, NACK, or Data).
     * Called by canbus.js _handleFrameReceived.
     * @param {object} responseFrame - The parsed Bafang CAN frame.
     */
     resolveRequest(responseFrame) {
        if (!responseFrame) return;

        const source = responseFrame.sourceDeviceCode;
        const code = responseFrame.canCommandCode;
        const subcode = responseFrame.canCommandSubCode;
        const opCode = responseFrame.canOperationCode;

        if (source === undefined || code === undefined || subcode === undefined || opCode === undefined) { /* ... log warning ... */ return; }

        const requestInfo = this.pendingAckRequests[source]?.[code]?.[subcode];

        if (requestInfo) {
            // --- Clear the main timeout ---
            if (requestInfo.timeoutHandle) {
                clearTimeout(requestInfo.timeoutHandle);
                this.ackTimeoutIds.delete(requestInfo.timeoutHandle);
            }
            // --- Clear potential delayed cleanup timeout ---
            // We need a way to track this specific timeout if we implement the delayed cleanup.
            // Let's skip tracking the delayed cleanup timeout for now, it's less critical.
            // If a response comes in *during* the short delay after failure, this resolve
            // will handle it correctly, and the delayed cleanup will find the entry missing.

            const success = (opCode !== CanOperation.ERROR_ACK);
            const isErrorAck = (opCode === CanOperation.ERROR_ACK);

            if (requestInfo.promiseControls && typeof requestInfo.promiseControls.resolve === 'function') {
                requestInfo.promiseControls.resolve({
                    success: success,
                    error: isErrorAck ? 'Received ERROR_ACK' : null,
                    timedOut: false,
                    responseData: responseFrame.data || null
                });
            }

            // Clean up immediately upon successful resolution
            delete this.pendingAckRequests[source][code][subcode];
            if (Object.keys(this.pendingAckRequests[source]?.[code] ?? {}).length === 0) delete this.pendingAckRequests[source][code];
            if (Object.keys(this.pendingAckRequests[source] ?? {}).length === 0) delete this.pendingAckRequests[source];

        } else {
             // console.log(`No pending ACK found for incoming frame: Src=0x${source.toString(16)}, Cmd=0x${code.toString(16)}, Sub=0x${subcode.toString(16)}`);
        }
    }

     clearAllRequests() {
        console.log("[RequestManager] Clearing all pending ACK requests, timeouts, and outgoing queue...");

        // Resolve all pending ACK requests as failed
        for (const targetId in this.pendingAckRequests) {
             for (const cmdCode in this.pendingAckRequests[targetId]) {
                for (const subCode in this.pendingAckRequests[targetId][cmdCode]) {
                    const request = this.pendingAckRequests[targetId][cmdCode][subCode];
                    // Clear the main timeout associated with this request
                    if (request?.timeoutHandle) {
                         clearTimeout(request.timeoutHandle);
                         this.ackTimeoutIds.delete(request.timeoutHandle);
                    }
                    // Resolve the promise
                    if (request?.promiseControls?.resolve) {
                        request.promiseControls.resolve({ success: false, error: 'Connection closed/cleared', timedOut: false });
                    }
                }
            }
        }
        this.pendingAckRequests = {}; // Clear the main pending object

        // Clear any remaining tracked timeout IDs (belt-and-suspenders)
        this.ackTimeoutIds.forEach(timeoutId => clearTimeout(timeoutId));
        this.ackTimeoutIds.clear();

        // Clear the outgoing queue and resolve associated promises as failed
        this.requestQueue.forEach(queuedItem => {
            if (queuedItem?.details?.promiseControls?.resolve) {
                 queuedItem.details.promiseControls.resolve({ success: false, error: 'Queue cleared', timedOut: false });
            }
        });
        this.requestQueue = [];
        this.stopQueueProcessor(); // Stop the processor loop
        this.lastSentTimestamp = 0;
        this.isProcessingQueue = false;
    }
}

module.exports = { RequestManager };