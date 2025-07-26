// bafang-serializer.js
"use strict";

// --- Imports ---
// Constants for CAN operations and device IDs
const { CanOperation, DeviceNetworkId } = require('./bafang-constants');
// List of known write commands (codes and subcodes)
const { CanWriteCommandsList } = require('./bafang-can-write-commands');
// Utility functions for byte manipulation and ID generation/conversion
const { intToByteArray, calculateChecksum, generateCanFrameId, bafangIdArrayTo32Bit } = require('./bafang-parser');
// Assumed CanFrame class definition (needed for structure hint)
const { CanFrame } = require('./canframe');

// --- Low-Level Write Functions (Fire-and-Forget) ---
// These functions initiate the CAN frame sending process via the canbusInstance.
// They do *not* wait for or handle acknowledgments from the target device.

/**
 * Sends a single CAN frame for short parameter writes.
 * @param {object} canbusInstance - The instance of CanBusService (from canbus.js).
 * @param {number} target - Target DeviceNetworkId (e.g., DeviceNetworkId.DISPLAY).
 * @param {object} can_command - Command details from CanWriteCommandsList { canCommandCode, canCommandSubCode }.
 * @param {number[]} data - The data payload bytes (up to 8 bytes).
 */
function writeShortParameter(canbusInstance, target, can_command, data) {
    if (!canbusInstance || !canbusInstance.isConnected()) {
        console.warn(`[Serializer] Attempted writeShortParameter (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode}) while disconnected.`);
        canbusInstance.emit('can_error', `Write attempt failed: Disconnected (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode})`);
        return;
    }
    if (!Array.isArray(data) || data.length > 8) {
        console.error(`[Serializer] Invalid data for writeShortParameter (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode}): Length ${data?.length}`);
        canbusInstance.emit('can_error', `Invalid data length for short write (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode})`);
        return;
    }

    try {
        const bafangIdArr = generateCanFrameId(
            DeviceNetworkId.BESST, // Source is usually the tool/interface
            target,
            CanOperation.WRITE_CMD,
            can_command.canCommandCode,
            can_command.canCommandSubCode
        );
        const canId32bit = bafangIdArrayTo32Bit(bafangIdArr);

        // Use the sendFrame method which expects the ID#Data format string
        const dataHex = Buffer.from(data).toString('hex'); // Convert data bytes to hex string
        const commandString = `${canId32bit.toString(16).padStart(8, '0')}#${dataHex}`; // Pad ID to 8 chars

        // Send the frame using the canbusInstance's method
        canbusInstance.sendFrame(commandString)
            .then(sent => {
                if (!sent) {
                     console.error(`[Serializer] canbus.sendFrame failed for Short Write: ID=0x${canId32bit.toString(16)}`);
                     // Optionally emit an error here if sendFrame indicates immediate failure
                     // canbusInstance.emit('can_error', `Send failed (short): Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode}`);
                } else {
                     // console.log(`[Serializer] Queued Short Write: ID=0x${canId32bit.toString(16)} DLC=${data.length}`);
                }
            })
            .catch(err => { // Catch potential errors from the sendFrame promise itself
                 console.error(`[Serializer] Error during sendFrame call (Short Write):`, err);
                 canbusInstance.emit('can_error', `Send error (short): ${err.message} (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode})`);
            });

    } catch (error) {
        console.error(`[Serializer] Error preparing short write (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode}):`, error);
        canbusInstance.emit('can_error', `Error preparing short write: ${error.message} (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode})`);
    }
}

/**
 * Sends multiple CAN frames for long parameter writes (multi-frame).
 * This function is async because it needs to send frames sequentially with delays.
 * @param {object} canbusInstance - The instance of CanBusService.
 * @param {number} target - Target DeviceNetworkId.
 * @param {object} can_command - Command details from CanWriteCommandsList { canCommandCode, canCommandSubCode }.
 * @param {number[]} value - The full data payload bytes (can be > 8 bytes).
 */
async function writeLongParameter(canbusInstance, target, can_command, value) {
     if (!canbusInstance || !canbusInstance.isConnected()) {
        console.warn(`[Serializer] Attempted writeLongParameter (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode}) while disconnected.`);
        canbusInstance.emit('can_error', `Write attempt failed: Disconnected (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode})`);
        return;
    }
     if (!Array.isArray(value)) {
        console.error(`[Serializer] Invalid data for writeLongParameter (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode}): Not an array.`);
        canbusInstance.emit('can_error', `Invalid data type for long write (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode})`);
        return;
     }

    try {
        let arrayClone = [...value]; // Make a copy to modify
        const source = DeviceNetworkId.BESST;
        const code = can_command.canCommandCode;
        const subcode = can_command.canCommandSubCode;
        const delayMs = 20; // Delay between frames (adjust if needed)

        // Helper to send frame and handle errors locally
        const sendMfFrame = async (idArr, dataPayload) => {
            const id32 = bafangIdArrayTo32Bit(idArr);
            const dataHex = Buffer.from(dataPayload).toString('hex');
            const commandString = `${id32.toString(16).padStart(8, '0')}#${dataHex}`;
            try {
                const sent = await canbusInstance.sendFrame(commandString);
                if (!sent) {
                    throw new Error(`sendFrame returned false for ID 0x${id32.toString(16)}`);
                }
            } catch(err) {
                 console.error(`[Serializer] Error sending MF frame ID 0x${id32.toString(16)}:`, err);
                 throw new Error(`Failed to send MF part (ID 0x${id32.toString(16)}): ${err.message}`); // Propagate error up
            }
        };

        // 1. Send initial WRITE_CMD with total data length
        const initIdArr = generateCanFrameId(source, target, CanOperation.WRITE_CMD, code, subcode);
        await sendMfFrame(initIdArr, [arrayClone.length]);
        console.log(`[Serializer] Sent Long Write Init: ID=0x${bafangIdArrayTo32Bit(initIdArr).toString(16)} LenByte=${arrayClone.length}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // 2. Send MULTIFRAME_START
        const startIdArr = generateCanFrameId(source, target, CanOperation.MULTIFRAME_START, code, subcode);
        const startData = arrayClone.slice(0, 8);
        await sendMfFrame(startIdArr, startData);
        console.log(`[Serializer] Sent MF Start: ID=0x${bafangIdArrayTo32Bit(startIdArr).toString(16)}`);
        arrayClone = arrayClone.slice(8);
        await new Promise(resolve => setTimeout(resolve, delayMs));


        // 3. Send MULTIFRAME packets
        let packages = 0;
        while (arrayClone.length > 8) { // Keep sending while more than 8 bytes remain
            const mfIdArr = generateCanFrameId(source, target, CanOperation.MULTIFRAME, 0, packages++); // Command code 0, subcode is sequence number
            const mfData = arrayClone.slice(0, 8);
            await sendMfFrame(mfIdArr, mfData);
            console.log(`[Serializer] Sent MF ${packages-1}: ID=0x${bafangIdArrayTo32Bit(mfIdArr).toString(16)}`);
            arrayClone = arrayClone.slice(8);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        // 4. Send MULTIFRAME_END with remaining data
        const endIdArr = generateCanFrameId(source, target, CanOperation.MULTIFRAME_END, 0, packages); // Command code 0, subcode is sequence number
        const endData = arrayClone; // Remaining data (<= 8 bytes)
        await sendMfFrame(endIdArr, endData);
        console.log(`[Serializer] Sent MF End ${packages}: ID=0x${bafangIdArrayTo32Bit(endIdArr).toString(16)}`);

    } catch (error) {
        // Error should have been logged by sendMfFrame or caught here if preparation fails
        console.error(`[Serializer] Error during writeLongParameter sequence (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode}):`, error);
        canbusInstance.emit('can_error', `Error sending long write: ${error.message} (Cmd ${can_command.canCommandCode}/${can_command.canCommandSubCode})`);
        // Optionally re-throw if the caller needs to know about the failure immediately
        // throw error;
    }
}


function serializeString(value) {
    const buffer = Buffer.from(value, 'ascii'); // Assuming ASCII for Bafang strings
    return [...buffer, 0]; // Convert buffer to array and add null terminator
}

function prepareStringWriteData(canbusInstance, value, target_device, can_command) {
    if (value === null || value === undefined || typeof value !== 'string') {
        console.warn(`[Serializer] Invalid string value for ${can_command.canCommandCode}/${can_command.canCommandSubCode}`);
        return;
    }
    const data = serializeString(value);
    // Strings are typically long parameters requiring multi-frame transfer
    writeLongParameter(canbusInstance, target_device, can_command, data);
}

/**
 * Prepares and initiates the write sequence for the custom "Parameter0" data block.
 * WARNING: Assumes command code 0x60, subcode 0x10 for writing this block. Verify this!
 * 
 *
 * @param {object} canbusInstance - The instance of CanBusService (to emit errors and pass to writeLongParameter).
 * @param {object} value - The parsed JavaScript object for Parameter0. Expected structure:
 *                         { first_value: number,
 *                           acceleration_levels: Array<{acceleration_level: number}>[9],
 *                           unknown_bytes: Array<number>[53] }
 */
function prepareParameter0WriteData(canbusInstance, value) {
    
    const expectedUnknownBytesLength = 33; // Bytes from index 30 to 62 inclusive

       if (!value || typeof value !== 'object' ||
            !Array.isArray(value.acceleration_levels) || value.acceleration_levels.length !== 9 ||
            !Array.isArray(value.assist_ratio_levels) || value.assist_ratio_levels.length !== 9 ||
            typeof value.assist_ratio_upper_limit !== 'number' ||
            !Array.isArray(value.unknown_bytes)
           ){
            console.error("[Serializer] Invalid Parameter0 data object provided for writing.", value);
            canbusInstance.emit('can_error', `Invalid Parameter0 data object structure for write`);
            return;
        }

    const new_pkg = Array(64).fill(0xFF); // Initialize with 0xFF (common padding)

    try {

        // Byte 0
         new_pkg[0] = value.par0_value_offset_0 ?? 0xFF;
  
        // Bytes 1-9: Acceleration Levels
        for (let i = 0; i < 9; i++) {
            const levelData = value.acceleration_levels[i];
            if (levelData && typeof levelData.acceleration_level === 'number' &&
                levelData.acceleration_level >= 0 && levelData.acceleration_level <= 255) {
                new_pkg[1 + i] = levelData.acceleration_level;
            } else {
                // Throw error or use default? Throwing is safer to indicate bad input.
                throw new Error(`Invalid or missing acceleration_level at index ${i}`);
                // Or use default: console.warn(`[Serializer] Missing/invalid acceleration_level ${i}. Using 0xFF.`); new_pkg[1 + i] = 0xFF;
            }
        }
       
	    // Bytes 10-27: Assist Ratio Levels (9 levels, 2 bytes each, LE)
        for (let i = 0; i < 9; i++) {
            const ratioData = value.assist_ratio_levels[i];
            if (ratioData && typeof ratioData.assist_ratio_level === 'number') {
                const ratioBytes = intToByteArray(Math.round(ratioData.assist_ratio_level), 2); // Ensure it's an integer
                new_pkg[10 + (i * 2)] = ratioBytes[0];      // Low Byte
                new_pkg[10 + (i * 2) + 1] = ratioBytes[1];  // High Byte
            } else {
                throw new Error(`Invalid assist_ratio at index ${i}`);
            }
        }

        // Bytes 28-29: Assist Ratio Upper Limit (2 bytes, LE)
        const upperLimitBytes = intToByteArray(Math.round(value.assist_ratio_upper_limit), 2);
        new_pkg[28] = upperLimitBytes[0]; // Low Byte
        new_pkg[29] = upperLimitBytes[1]; // High Byte
		
        // Bytes 30-62: Unknown Bytes
        for (let i = 0; i < expectedUnknownBytesLength; i++) {
             if (typeof value.unknown_bytes[i] === 'number' &&
                 value.unknown_bytes[i] >= 0 && value.unknown_bytes[i] <= 255) {
                new_pkg[30 + i] = value.unknown_bytes[i];
             } else {
                 // Throw error or use default?
                 throw new Error(`Invalid or missing unknown_byte at index ${i}`);
                 // Or use default: console.warn(`[Serializer] Missing/invalid unknown_byte ${i}. Using 0xFF.`); new_pkg[10 + i] = 0xFF;
             }
        }

        new_pkg[63] = calculateChecksum(new_pkg.slice(0, 63));

        writeLongParameter(canbusInstance, DeviceNetworkId.DRIVE_UNIT, CanWriteCommandsList.Parameter0, new_pkg)

        console.log("[Serializer] Parameter0 write sequence initiated.");

    } catch (e) {
        console.error("[Serializer] Error preparing Parameter0 write data:", e, value);
        canbusInstance.emit('can_error', `Error preparing Parameter0 data: ${e.message}`);
    }
}

//  For writing Controller Parameter Block 1
function prepareParameter1WriteData(canbusInstance, value) {
    // Expects 'value' to be a complete JS object representing the Parameter 1 structure
    if (!value || typeof value !== 'object') {
         console.error("[Serializer] Invalid Parameter1 data object provided for writing.");
         canbusInstance.emit('can_error', `Invalid P1 data object for write`);
         return;
    }

    const new_pkg = Array(64).fill(0xFF); // Initialize 64 bytes, 0xFF often used for padding/unused

    try {
        // Populate known fields from the 'value' object, using ?? 0xFF for defaults
        new_pkg[0] = value.system_voltage ?? 0xFF;
        new_pkg[1] = value.current_limit ?? 0xFF;
        new_pkg[2] = value.overvoltage ?? 0xFF;
        new_pkg[3] = value.undervoltage_under_load&0xFF ?? 0xFF;
        new_pkg[4] = value.undervoltage_under_load>>8 ?? 0xFF;
        new_pkg[5] = value.undervoltage&0xFF ?? 0xFF;
		new_pkg[6] = value.undervoltage>>8 ?? 0xFF;
        if (value.battery_capacity !== undefined && value.battery_capacity !== null) {
            const capBytes = intToByteArray(value.battery_capacity, 2); // 2 bytes LE
            new_pkg[7] = capBytes[0]; new_pkg[8] = capBytes[1];
        }
        new_pkg[9] = value.max_current_on_low_charge ?? 0xFF;
        new_pkg[10] = value.limp_mode_soc_limit ?? 0xFF;
		new_pkg[11] = value.limp_mode_soc_limit_stage2 ?? 0xFF;
        new_pkg[12] = value.full_capacity_range ?? 0xFF;
        new_pkg[13] = value.pedal_sensor_type ?? 0xFF;
        new_pkg[14] = value.coaster_brake ? 1 : 0;
        new_pkg[15] = value.pedal_sensor_signals_per_rotation ?? 0xFF;
        new_pkg[16] = value.speed_sensor_channel_number ?? 0xFF;
		new_pkg[17] = value.par1_value_offset_17 ?? 0xFF;
        new_pkg[18] = value.motor_type ?? 0xFF;
        new_pkg[19] = value.motor_pole_pair_number ?? 0xFF;
        new_pkg[20] = value.speedmeter_magnets_number ?? 0xFF;
        new_pkg[21] = value.temperature_sensor_type ?? 0xFF;
        if (value.deceleration_ratio !== undefined && value.deceleration_ratio !== null) {
             const drBytes = intToByteArray(Math.round(value.deceleration_ratio * 100), 2);
             new_pkg[22] = drBytes[0]; new_pkg[23] = drBytes[1];
        }
        if (value.motor_max_rotor_rpm !== undefined && value.motor_max_rotor_rpm !== null) {
             const rpmBytes = intToByteArray(value.motor_max_rotor_rpm, 2);
             new_pkg[24] = rpmBytes[0]; new_pkg[25] = rpmBytes[1];
        }
		if (value.motor_d_axis_inductance !== undefined && value.motor_d_axis_inductance !== null) {
            const dAxisBytes = intToByteArray(value.motor_d_axis_inductance, 2);
            new_pkg[26] = dAxisBytes[0]; new_pkg[27] = dAxisBytes[1];
        }
        if (value.motor_q_axis_inductance !== undefined && value.motor_q_axis_inductance !== null) {
            const qAxisBytes = intToByteArray(value.motor_q_axis_inductance, 2);
            new_pkg[28] = qAxisBytes[0]; new_pkg[29] = qAxisBytes[1];
        }
        if (value.motor_phase_resistance !== undefined && value.motor_phase_resistance !== null) {
            const phaseResBytes = intToByteArray(value.motor_phase_resistance, 2);
            new_pkg[30] = phaseResBytes[0]; new_pkg[31] = phaseResBytes[1];
        }
        if (value.motor_reverse_potential_coefficient !== undefined && value.motor_reverse_potential_coefficient !== null) {
            const revPotBytes = intToByteArray(value.motor_reverse_potential_coefficient, 2);
            new_pkg[32] = revPotBytes[0]; new_pkg[33] = revPotBytes[1];
        }
        new_pkg[34] = (value.throttle_start_voltage !== undefined && value.throttle_start_voltage !== null)
                        ? Math.round(value.throttle_start_voltage * 10)
                        : 0xFF;
        new_pkg[35] = (value.throttle_max_voltage !== undefined && value.throttle_max_voltage !== null)
                        ? Math.round(value.throttle_max_voltage * 10)
                        : 0xFF;
		new_pkg[36] = value.speed_limit_enabled ? 1 : 0; 
        new_pkg[37] = value.start_current ?? 0xFF;
        new_pkg[38] = (value.current_loading_time !== undefined && value.current_loading_time !== null)
                        ? Math.round(value.current_loading_time * 10)
                        : 0xFF;
        new_pkg[39] = (value.current_shedding_time !== undefined && value.current_shedding_time !== null)
                        ? Math.round(value.current_shedding_time * 10)
                        : 0xFF;


        if (Array.isArray(value.assist_levels) && value.assist_levels.length === 9) {
            value.assist_levels.forEach((profile, index) => {
                new_pkg[40 + index] = profile?.current_limit ?? 0xFF; // Add null check for profile
                new_pkg[49 + index] = profile?.speed_limit ?? 0xFF; // Corrected index for speed limit
            });
        } else {
             console.warn("[Serializer] Assist levels data missing or incorrect length for Parameter1 write. Using defaults.");
        }
        
        new_pkg[58] = value.displayless_mode ? 1 : 0;
        new_pkg[59] = value.lamps_always_on ? 1 : 0;  
		
        const walkSpeedRaw = value.walk_assist_speed; // This is already scaled x100 by parser if it comes from device
        let scaledWalkSpeed;
        if (walkSpeedRaw !== undefined && walkSpeedRaw !== null) {
            scaledWalkSpeed = (Math.max(0, Math.min(600, Math.round(walkSpeedRaw))) * 100);
        } else {
            scaledWalkSpeed = 300; // Default to 3km/h * 100
        }
        new_pkg[60] = scaledWalkSpeed & 0xFF;
        new_pkg[61] = (scaledWalkSpeed >> 8) & 0xFF;
        new_pkg[62] = value.par1_value_offset_62 ?? 0xFF;

        // Calculate and set checksum for the first 63 bytes
        new_pkg[63] = calculateChecksum(new_pkg.slice(0, 63));

        // Write the assembled 64-byte package using multi-frame
        writeLongParameter(canbusInstance, DeviceNetworkId.DRIVE_UNIT, CanWriteCommandsList.Parameter1, new_pkg);

    } catch (e) {
         console.error("[Serializer] Error preparing Parameter1 write data:", e, value);
         canbusInstance.emit('can_error', `Error preparing P1 data: ${e.message}`);
    }
}

// For writing Controller Parameter Block 2 (Torque Profiles)
function prepareParameter2WriteData(canbusInstance, value) {
     // Expects 'value' to be an object with a `torque_profiles` array (length 6)
     if (!value || !Array.isArray(value.torque_profiles) || value.torque_profiles.length < 6) {
         console.error("[Serializer] Invalid Parameter2 data provided for writing (needs 6 torque profiles).");
         canbusInstance.emit('can_error', `Invalid P2 data object for write`);
         return;
     }
     const new_pkg = Array(64).fill(0xFF); // Initialize 64 bytes

     try {
         for (let i = 0; i <= 5; i++) {
             const profile = value.torque_profiles[i];
             if (!profile) {
                  console.warn(`[Serializer] Torque profile index ${i} missing in P2 data.`);
                  continue; // Skip if a profile is missing
             }

             new_pkg[0 + i] = profile.start_torque_value ?? 0xFF;
             new_pkg[6 + i] = profile.max_torque_value ?? 0xFF;
             new_pkg[12 + i] = profile.return_torque_value ?? 0xFF;
             new_pkg[24 + i] = profile.min_current ?? 0xFF;
             new_pkg[18 + i] = profile.max_current ?? 0xFF;
             new_pkg[30 + i] = profile.torque_decay_time ?? 0xFF;
             new_pkg[36 + i] = profile.start_pulse ?? 0xFF;
             new_pkg[42 + i] = (profile.current_decay_time !== undefined && profile.current_decay_time !== null) ? Math.min(255, Math.max(0, Math.floor(profile.current_decay_time / 5))) : 0xFF; // Clamp 0-255
             new_pkg[48 + i] = (profile.stop_delay !== undefined && profile.stop_delay !== null)? Math.min(255, Math.max(0, Math.floor(profile.stop_delay / 5))) : 0xFF; // Clamp 0-255
		 }
		 new_pkg[54] = value.acceleration_level ?? 0xFF;

//		 for (let i = 0; i < 6; i++) {
//			 new_pkg[30 + i] = value.unknown_bytes_1[i];
//		 }
		 
		 for (let i = 0; i < 8; i++) {
			 new_pkg[55 + i] = value.unknown_bytes_2[i];
		 }
		 // Calculate and set checksum
         new_pkg[63] = calculateChecksum(new_pkg.slice(0, 63));

         // Write the assembled package using multi-frame
         writeLongParameter(canbusInstance, DeviceNetworkId.DRIVE_UNIT, CanWriteCommandsList.Parameter2, new_pkg);
     } catch (e) {
         console.error("[Serializer] Error preparing Parameter2 write data:", e, value);
         canbusInstance.emit('can_error', `Error preparing P2 data: ${e.message}`);
     }
}

// For writing Speed Parameters
function prepareSpeedPackageWriteData(canbusInstance, value) {
     // Expects 'value' to be { speed_limit: number, circumference: number, wheel_diameter: { code: [byte, byte] } }
     if (!value || typeof value !== 'object' || !value.wheel_diameter || !Array.isArray(value.wheel_diameter.code) || value.wheel_diameter.code.length !== 2 ||
	     typeof value.speed_limit !== 'number' || typeof value.circumference !== 'number') {
         console.error("[Serializer] Invalid Speed Parameters data provided for writing.");
          canbusInstance.emit('can_error', `Invalid Speed Params data object for write`);
         return;
     }
     try {
         const wheelCode = value.wheel_diameter.code;
         const speedLimit = value.speed_limit ?? 0;
         const circumference = value.circumference ?? 0;

         // Data: Speed Limit (2 bytes LE, value * 100), Wheel Code (2 bytes), Circumference (2 bytes LE)
         const data = [
             ...intToByteArray(Math.round(speedLimit * 100), 2),
             wheelCode[0],
             wheelCode[1],
             ...intToByteArray(Math.round(circumference), 2),
         ];

         // This is a short write command
         writeShortParameter(canbusInstance, DeviceNetworkId.DRIVE_UNIT, CanWriteCommandsList.MotorSpeedParameters, data);
     } catch (e) {
         console.error("[Serializer] Error preparing Speed Parameters write data:", e, value);
         canbusInstance.emit('can_error', `Error preparing Speed data: ${e.message}`);
     }
}

 /* Prepares and sends the data for writing the Startup Angle.
 * @param {object} canbusInstance - The instance of CanBusService.
 * @param {number} angleValue - The startup angle value (0-360 or other valid range).
 */
function prepareStartupAngleWriteData(canbusInstance, angleValue) {
    const target = DeviceNetworkId.DRIVE_UNIT; // Target is the Controller
    // Define the command locally as it might not be in the standard write list
    const can_command = {
        canCommandCode: 0x62,
        canCommandSubCode: 0xD9
    };

    // Validate input
    if (typeof angleValue !== 'number' || angleValue < 0 || angleValue > 400) { // Assuming a reasonable max like 400 for safety
        console.error(`[Serializer] Invalid startup angle value provided: ${angleValue}`);
        canbusInstance.emit('can_error', `Invalid startup angle value: ${angleValue}`);
        return;
    }

    try {
        // Serialize angle to 2 bytes, Little Endian
        const byte1 = angleValue & 0xFF;        // Low byte
        const byte2 = (angleValue >> 8) & 0xFF; // High byte
        const data = [byte1, byte2];

        console.log(`[Serializer] Preparing Startup Angle Write: Target=0x${target.toString(16)}, Cmd=0x${can_command.canCommandCode.toString(16)}/${can_command.canCommandSubCode.toString(16)}, Data=[${data.map(b => '0x'+b.toString(16)).join(',')}]`);

        // This is a short write command (2 bytes payload)
        // Using fire-and-forget version for consistency with other custom writes here
        writeShortParameter(canbusInstance, target, can_command, data);

    } catch (e) {
        console.error("[Serializer] Error preparing Startup Angle write data:", e, angleValue);
        canbusInstance.emit('can_error', `Error preparing Startup Angle data: ${e.message}`);
    }
}

function prepareSetServiceThresholdWriteData(canbusInstance, thresholdKm) {
    if (thresholdKm === null || thresholdKm === undefined || typeof thresholdKm !== 'number' || thresholdKm < 0) {
        console.warn(`[Serializer] Invalid service threshold value: ${thresholdKm}`);
        canbusInstance.emit('can_error', `Invalid service threshold value for write`);
        return; // Or throw an error
    }
    if (!CanWriteCommandsList.SetServiceThreshold) {
        console.error("[Serializer] SetServiceThreshold command not defined in CanWriteCommandsList.");
        canbusInstance.emit('can_error', `SetServiceThreshold command undefined`);
        return;
    }

    const mileageBytes = intToByteArray(Math.round(thresholdKm), 3); // Get 3 bytes LE for mileage
    const data = [
            0x00, // The prepended "00" from C#
            mileageBytes[0], // LSB
            mileageBytes[1],
            mileageBytes[2]  // MSB (will be 0 if mileage < 65536)
    ];
        // Ensure data is 4 bytes long, padding with 0 if mileage was small.
    while(data.length < 4) data.push(0x00);

    console.warn("[Serializer] Using fire-and-forget for SetServiceThreshold. ACK tracking might be separate.");
    bafangSerializer.writeShortParameter( // Assuming this exists in bafangSerializer
        canbusInstance,
        DeviceNetworkId.DISPLAY,
        CanWriteCommandsList.SetServiceThreshold,
        data.slice(0, 4)
        );
}

function serializeMileage(mileage) {
    // Mileage is 3 bytes, Little Endian
    return intToByteArray(Math.round(mileage), 3);
}

function prepareTotalMileageWriteData(canbusInstance, value) {
    if (value === null || value === undefined || typeof value !== 'number' || value < 0) {
        console.warn(`[Serializer] Invalid total mileage value: ${value}`);
        return;
    }
    const data = serializeMileage(value);
    writeShortParameter(canbusInstance, DeviceNetworkId.DISPLAY, CanWriteCommandsList.DisplayTotalMileage, data);
}

function prepareSingleMileageWriteData(canbusInstance, value) {
    if (value === null || value === undefined || typeof value !== 'number' || value < 0) {
         console.warn(`[Serializer] Invalid single mileage value: ${value}`);
         return;
    }
    // Single mileage is stored scaled by 10
    const data = serializeMileage(value * 10);
    writeShortParameter(canbusInstance, DeviceNetworkId.DISPLAY, CanWriteCommandsList.DisplaySingleMileage, data);
}

// For writing Display Time
function prepareTimeWriteData(canbusInstance, hours, minutes, seconds) {
     if (hours === null || hours === undefined || minutes === null || minutes === undefined || seconds === null || seconds === undefined) {
         console.warn(`[Serializer] Invalid time values provided.`);
         return;
     }
     // Basic validation
     if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
         console.error("[Serializer] Invalid time format for writing:", hours, minutes, seconds);
         canbusInstance.emit('can_error', `Invalid time format for write`);
         return;
     }
     const data = [hours, minutes, seconds]; // Simple 3-byte payload
     writeShortParameter(canbusInstance, DeviceNetworkId.DISPLAY, CanWriteCommandsList.DisplayTime, data);
}


function prepareCleanServiceMileageWriteData(canbusInstance) {
     // This command usually sends dummy data (e.g., 5 zero bytes)
     const data = [0x00, 0x00, 0x00, 0x00, 0x00];
     writeShortParameter(canbusInstance, DeviceNetworkId.DISPLAY, CanWriteCommandsList.CleanServiceMileage, data);
}

// --- Exports ---
module.exports = {
	prepareParameter0WriteData,
    prepareParameter1WriteData,
    prepareParameter2WriteData,
    prepareSpeedPackageWriteData,
	prepareStartupAngleWriteData,
    prepareStringWriteData,
    prepareTotalMileageWriteData,
    prepareSingleMileageWriteData,
    prepareTimeWriteData,
	prepareSetServiceThresholdWriteData,
    prepareCleanServiceMileageWriteData,
	writeShortParameter, // Make sure this is exported
    writeLongParameter  // Make sure this is exported
};