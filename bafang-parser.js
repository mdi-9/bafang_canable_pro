// bafang-parser.js
"use strict";
const { CanOperation, DeviceNetworkId } = require('./bafang-constants'); // Use constants

// --- Constants ---
const CAN_CHANNEL_PREFIX = 0x80; // Assuming 0x80 prefix for the channel/interface

function charsToString(char_arr) {
    // Filter out null bytes which can terminate strings early
    const filtered_arr = char_arr.filter(c => c !== 0);
    return String.fromCharCode.apply(null, filtered_arr);
}

// Note: Real checksum calculation might be needed for validation if provided parsers use it
function calculateChecksum(bytes) {
    let summ = 0;
    bytes.forEach((item) => {
        summ += item;
    });
    return summ & 255;
}

class BafangCanBatteryParser {
    static cells(packet, cells_arr) {
        if (!packet || !Array.isArray(packet.data) || !Array.isArray(cells_arr)) return;
        for (let i = 0; i < packet.data.length / 2; i++) {
            // Ensure indices are valid before accessing
            if ((packet.canCommandSubCode - 2) * 4 + i < cells_arr.length &&
                i * 2 + 1 < packet.data.length) {
                cells_arr[(packet.canCommandSubCode - 2) * 4 + i] =
                    ((packet.data[i * 2 + 1] << 8) + packet.data[i * 2]) / 1000;
            }
        }
    }

    static capacity(packet) {
        if (!packet || !Array.isArray(packet.data) || packet.data.length < 7) {
             return { full_capacity: null, capacity_left: null, rsoc: null, asoc: null, soh: null, parseError: true };
        }
        return {
            full_capacity: (packet.data[1] << 8) + packet.data[0],
            capacity_left: (packet.data[3] << 8) + packet.data[2],
            rsoc: packet.data[4],
            asoc: packet.data[5],
            soh: packet.data[6],
        };
    }

    static state(packet) {
         if (!packet || !Array.isArray(packet.data) || packet.data.length < 5) {
             return { current: null, voltage: null, temperature: null, parseError: true };
        }
        let tmp = (packet.data[1] << 8) + packet.data[0];
        // Handle signed int16 conversion (Two's complement)
        const isNegative = (tmp & 0x8000) > 0;
        if (isNegative) {
             // Calculate the negative value using two's complement logic
             tmp = -((~tmp + 1) & 0xFFFF); // Invert bits, add 1, mask to 16 bits, then negate
        }
        // Original logic for negative values (might be incorrect for standard two's complement)
        // if ((tmp & 32768) > 0) {
        //     tmp = -(65536 - tmp); // Corrected negation
        // }
        return {
            current: tmp / 100,
            voltage: ((packet.data[3] << 8) + packet.data[2]) / 100,
            temperature: packet.data[4] - 40, // Assuming temp is unsigned offset
        };
    }
}

class BafangCanControllerParser {
    static package0(packet) { // Realtime 0
        if (!packet || !Array.isArray(packet.data) || packet.data.length < 8) {
             return { remaining_capacity: null, single_trip: null, cadence: null, torque: null, remaining_distance: null, parseError: true };
        }
        const tmp = (packet.data[7] << 8) + packet.data[6];
        return {
            remaining_capacity: packet.data[0],
            single_trip: ((packet.data[2] << 8) + packet.data[1]) / 100,
            cadence: packet.data[3],
            torque: (packet.data[5] << 8) + packet.data[4],
            remaining_distance: tmp < 65535 ? tmp / 100 : null, // Handle max value as null
        };
    }

    static package1(packet) { // Realtime 1
        if (!packet || !Array.isArray(packet.data) || packet.data.length < 8) {
             return { speed: null, current: null, voltage: null, temperature: null, motor_temperature: null, parseError: true };
        }
        return {
            speed: ((packet.data[1] << 8) + packet.data[0]) / 100,
            current: ((packet.data[3] << 8) + packet.data[2]) / 100,
            voltage: ((packet.data[5] << 8) + packet.data[4]) / 100,
            temperature: packet.data[6] === 0xFF ? null : packet.data[6] - 40, // Handle invalid temp
            motor_temperature: packet.data[7] === 0xFF ? null : packet.data[7] - 40, // Handle invalid temp
        };
    }

	static parameter0(packet) {
         if (!packet || !Array.isArray(packet.data) || packet.data.length < 64) {
             return { parseError: true, error: "Invalid data length for Parameter1" };
         }
	
		const pkg = {
			par0_value_offset_0: packet.data[0],
            acceleration_levels: [],
			assist_ratio_levels: [], 
			assist_ratio_upper_limit: null,			
			unknown_bytes: [], 
        };
		
		
		if (packet.data.length >= 63){
		pkg.unknown_bytes = packet.data.slice(30, 63);
		} else {
            console.warn("Insufficient data length for assist levels in Parameter0");
        }
		
		if (packet.data.length >= 10) { // Need up to byte 9
            for (let i = 0; i < 9; i++) {
                 // Check bounds for assist level data access
                 if (1 + i < packet.data.length && 9 + i < packet.data.length) {
                    pkg.acceleration_levels.push({
						acceleration_level: packet.data[1 + i],
                    });
                 } else {
                      console.warn("Insufficient data length for full assist levels in Parameter0");
                      break; // Stop processing assist levels if data is too short
                 }
            }
		} else {
        console.warn("[Parser] Insufficient data for general_acceleration_levels in Parameter0");
        }
		
        if (packet.data.length >= 28) { // Need up to byte 9 (for start_accel) + 18 (for assist_ratio) = byte 27
           for (let i = 0; i < 9; i++) {
                const lowByte = packet.data[10 + (i * 2)];
                const highByte = packet.data[10 + (i * 2) + 1];
                pkg.assist_ratio_levels.push({
                    assist_ratio_level: (highByte << 8) | lowByte,
                });
            }
        } else {
            console.warn("[Parser] Insufficient data for assist_ratio_levels in Parameter0");
        }
		
       if (packet.data.length >= 30) { // Need up to byte 29
            const lowByte = packet.data[28];
            const highByte = packet.data[29];
            pkg.assist_ratio_upper_limit = (highByte << 8) | lowByte;
        } else {
            console.warn("[Parser] Insufficient data for assist_ratio_upper_limit in Parameter0");
        }
		
		return pkg;
    }
	
    static parameter1(packet) {
         if (!packet || !Array.isArray(packet.data) || packet.data.length < 64) {
             return { parseError: true, error: "Invalid data length for Parameter1" };
         }
        // Optional: Add checksum validation if needed
        // if (packet.data[63] !== calculateChecksum(packet.data.slice(0, 63))) {
        //     console.warn("Parameter1 checksum mismatch");
        //     return { parseError: true, error: "Checksum mismatch" };
        // }
        const pkg = {
            system_voltage: packet.data[0], // Assuming SystemVoltage type handled elsewhere
            current_limit: packet.data[1],
            overvoltage: packet.data[2],
            undervoltage: packet.data[5]+(packet.data[6]<<8),
            undervoltage_under_load: packet.data[3]+(packet.data[4]<<8),
            battery_recovery_voltage: packet.data[5],
			par1_value_offset_6: packet.data[6],
            battery_capacity: (packet.data[8] << 8) + packet.data[7],
            max_current_on_low_charge: packet.data[9],
			limp_mode_soc_limit: packet.data[10], 
			limp_mode_soc_limit_stage2: packet.data[11],
            full_capacity_range: packet.data[12],
            pedal_sensor_type: packet.data[13], // Assuming PedalSensorType enum handled elsewhere
            coaster_brake: packet.data[14] === 1,
            pedal_sensor_signals_per_rotation: packet.data[15],
            speed_sensor_channel_number: packet.data[16], // Assuming SpeedSensorChannelNumber type
			par1_value_offset_17: packet.data[17],
            motor_type: packet.data[18], // Assuming MotorType enum
            motor_pole_pair_number: packet.data[19],
            speedmeter_magnets_number: packet.data[20],
            temperature_sensor_type: packet.data[21], // Assuming TemperatureSensorType enum
            deceleration_ratio: ((packet.data[23] << 8) + packet.data[22]) / 100,
            motor_max_rotor_rpm: (packet.data[25] << 8) + packet.data[24],
            motor_d_axis_inductance: (packet.data[27] << 8) + packet.data[26],
            motor_q_axis_inductance: (packet.data[29] << 8) + packet.data[28],
            motor_phase_resistance: (packet.data[31] << 8) + packet.data[30],
            motor_reverse_potential_coefficient: (packet.data[33] << 8) + packet.data[32],
            throttle_start_voltage: packet.data[34] / 10,
            throttle_max_voltage: packet.data[35] / 10,
			speed_limit_enabled: packet.data[36],
            start_current: packet.data[37],
            current_loading_time: packet.data[38] / 10,
            current_shedding_time: packet.data[39] / 10,
            assist_levels: [],
            displayless_mode: packet.data[58] === 1,
            lamps_always_on: packet.data[59] === 1,
			walk_assist_speed: ((packet.data[61] << 8) + packet.data[60]) / 100, // Read bytes 60, 61 (LE), scale back
			par1_value_offset_62: packet.data[62],
        };
        // Ensure data length is sufficient before accessing assist levels
        if (packet.data.length >= 63) {
            for (let i = 0; i < 9; i++) {
                 // Check bounds for assist level data access
                 if (40 + i < packet.data.length && 49 + i < packet.data.length) {
                    pkg.assist_levels.push({
                        current_limit: packet.data[40 + i],
                        speed_limit: packet.data[49 + i],
                    });
                 } else {
                      console.warn("Insufficient data length for full assist levels in Parameter1");
                      break; // Stop processing assist levels if data is too short
                 }
            }
        } else {
             console.warn("Insufficient data length for assist levels in Parameter1");
        }
        return pkg;
    }

    static parameter2(packet) {
         if (!packet || !Array.isArray(packet.data) || packet.data.length < 64) {
             return { parseError: true, error: "Invalid data length for Parameter2" };
         }
        // Optional: Add checksum validation if needed
        // if (packet.data[63] !== calculateChecksum(packet.data.slice(0, 63))) {
        //     console.warn("Parameter2 checksum mismatch");
        //     return { parseError: true, error: "Checksum mismatch" };
        // }
        const pkg = {
            torque_profiles: [],
			unknown_bytes_1: [],
			unknown_bytes_2: [],			
        };
		
		if (packet.data.length >= 62){
		pkg.unknown_bytes_1 = packet.data.slice(30, 36);
		pkg.unknown_bytes_2 = packet.data.slice(55, 63);
		} else {
            console.warn("Insufficient data length for assist levels in Parameter0");
        }
        // Ensure data length is sufficient before accessing torque profiles
        if (packet.data.length >= 54) { // Need up to index 48 + 5 = 53
             for (let i = 0; i <= 5; i++) {
                 // Check bounds for torque profile data access
                 if (48 + i < packet.data.length) {
                    pkg.torque_profiles.push({
                        start_torque_value: packet.data[0 + i],
                        max_torque_value: packet.data[6 + i],
                        return_torque_value: packet.data[12 + i],
                        min_current: packet.data[24 + i],
                        max_current: packet.data[18 + i],
                        torque_decay_time: packet.data[30 + i],
                        start_pulse: packet.data[36 + i],
                        current_decay_time: packet.data[42 + i] * 5,
                        stop_delay: packet.data[48 + i] * 2,
                    });
                 } else {
                     console.warn("Insufficient data length for full torque profiles in Parameter2");
                     break; // Stop processing profiles if data is too short
                 }
             }
			 pkg.acceleration_level = packet.data[54];
        } else {
             console.warn("Insufficient data length for torque profiles in Parameter2");
        }
        return pkg;
    }

    static parameter3(packet) { // Speed Parameters
         if (!packet || !Array.isArray(packet.data) || packet.data.length < 6) {
             return { parseError: true, error: "Invalid data length for Speed Parameters" };
         }
        // Finding wheel diameter requires WheelDiameterTable - cannot do here without it
        // For now, just return the codes
        const wheelCode = [packet.data[2], packet.data[3]];
        return {
            speed_limit: ((packet.data[1] << 8) + packet.data[0]) / 100,
            wheel_diameter_code: wheelCode, // Return code instead of object
            circumference: (packet.data[5] << 8) + packet.data[4],
        };
    }
	
	    /**
     * Parses the Startup Angle data (Command 0x62, Sub 0xD9)
     * @param {object} packet - The parsed CAN frame object { data: number[] }
     * @returns {object} Object containing { startup_angle: number } or parse error.
     */
    static parameter4(packet) { // Startup Angle
         if (!packet || !Array.isArray(packet.data) || packet.data.length < 2) { // Needs at least 2 bytes
             return { parseError: true, error: "Invalid data length for Startup Angle (0x62/0xD9)" };
         }
         const angleByte1 = packet.data[0]; // Low byte
         const angleByte2 = packet.data[1]; // High byte
         const angle = (angleByte2 * 256) + angleByte1; // Little Endian calculation

         return {
             startup_angle: angle,
         };
    }
	
	static parameter5(packet) { // Calories
         if (!packet || !Array.isArray(packet.data) || packet.data.length < 2) { // Needs at least 2 bytes
             return { parseError: true, error: "Invalid data length for calories" };
         }

		 return {
         calories: ((packet.data[1] << 8) + packet.data[0])
		 }

    }
}

class BafangCanDisplayParser {
    static decodeCurrentAssistLevel(currentAssistLevelCode, totalAssistLevels) {
        // Simplified lookup, as original depends on specific table values
        const assistLevelMap = {
            // Example mappings, replace with actual values if known
			0: 0, 12: 1, 2: 2, 3: 3, 6: 'walk',
            0: 0, 11: 1, 13: 2, 21: 3, 23: 4, 3: 5, 6: 'walk',
            0: 0, 1: 1, 11: 2, 12: 3, 13: 4, 2: 5, 21: 6, 22: 7, 23: 8, 3: 9, 6: 'walk' 
        };
        return assistLevelMap[currentAssistLevelCode] !== undefined ? assistLevelMap[currentAssistLevelCode] : 'unknown';
    }

    static errorCodes(data) {
        if (!Array.isArray(data)) return [];
        const errors = [];
        let errorString = charsToString(data);
        while (errorString.length >= 2) {
            // Use try-catch for robustness
            try {
                const code = parseInt(errorString.substring(0, 2), 10);
                if (!isNaN(code)) {
                    errors.push(code);
                }
            } catch (e) { /* ignore parsing errors */ }
            errorString = errorString.substring(2);
        }
        return errors;
    }

    static package0(packet) { // Realtime Data
        if (!packet || !Array.isArray(packet.data) || packet.data.length < 3) {
             return { parseError: true, error: "Invalid data length for Display Realtime" };
        }
        const rideMode = (packet.data[0] & 0b10000) ? 'BOOST' : 'ECO'; // Simplified BafangCanRideMode
        return {
            assist_levels: packet.data[0] & 0b1111,
            ride_mode: rideMode,
            boost: (packet.data[0] & 0b100000) >> 5 === 1,
            current_assist_level: BafangCanDisplayParser.decodeCurrentAssistLevel(
                packet.data[1],
                packet.data[0] & 0b1111,
            ),
            light: (packet.data[2] & 1) === 1,
            button: (packet.data[2] & 0b10) >> 1 === 1,
        };
    }

    static package1(packet) { // Data Block 1 (Mileage/Speed)
        if (!packet || !Array.isArray(packet.data) || packet.data.length < 8) {
             return { parseError: true, error: "Invalid data length for Display Data1" };
        }
        return {
            total_mileage: (packet.data[2] << 16) | (packet.data[1] << 8) | packet.data[0],
            single_mileage: (((packet.data[5] << 16) | (packet.data[4] << 8) | packet.data[3])) / 10,
            max_speed: ((packet.data[7] << 8) + packet.data[6]) / 10,
        };
    }

    static package2(packet) { // Data Block 2 (Avg Speed/Service)
        if (!packet || !Array.isArray(packet.data) || packet.data.length < 5) {
             return { parseError: true, error: "Invalid data length for Display Data2" };
        }
        return {
            average_speed: ((packet.data[1] << 8) + packet.data[0]) / 10,
            service_mileage: (((packet.data[4] << 16) | (packet.data[3] << 8) | packet.data[2])) / 10,
        };
    }
	
	static package3(packet) { // display light levels
        if (!packet || !Array.isArray(packet.data) || packet.data.length < 4) {
             return { parseError: true, error: "Invalid data length for Display Data1" };
        }
   
        return {
            light_sensor_level_numbers: packet.data[0],
            light_sensor_level: packet.data[1],
            backlight_level_numbers: packet.data[2],
            backlight_level: packet.data[3],
        };
    }

}

class BafangCanSensorParser {
    static package0(packet) { // Realtime Data
        if (!packet || !Array.isArray(packet.data) || packet.data.length < 3) {
             return { parseError: true, error: "Invalid data length for Sensor Realtime" };
        }
        return {
            torque: (packet.data[1] << 8) + packet.data[0],
            cadence: packet.data[2],
        };
    }
}

	/**
	 * Parses a Bafang-specific CanFrame (with 4-byte ID array) into a structured object.
	 * IMPORTANT: Assumes the input frame.id[0] might have the channel prefix, which needs stripping
	 *            for logical sourceDeviceCode identification.
	 * @param {object} frame - An object with `id` (number[4]) and `data` (number[]).
	 * @returns {object} ParsedCanFrame object.
	 */
	function parseCanFrame(frame) {
		if (!Array.isArray(frame.id) || frame.id.length !== 4 || !Array.isArray(frame.data)) {
			console.error("Invalid frame format passed to parseCanFrame:", frame);
			return { parseError: true };
		}
		// Strip the channel prefix from the source byte to get the logical Bafang ID
		const logicalSourceDeviceCode = frame.id[0] & 0x0F; // Mask to get lower 4 bits

		// Also strip prefix from target if needed? Usually target is just the Bafang ID.
		// Assuming target in byte 1 is already the logical Bafang ID.
		const logicalTargetDeviceCode = (frame.id[1] & 0b11111000) >> 3;

		return {
			canCommandCode: frame.id[2],
			canCommandSubCode: frame.id[3],
			canOperationCode: frame.id[1] & 0b111,
			sourceDeviceCode: logicalSourceDeviceCode, // Use the stripped logical ID
			targetDeviceCode: logicalTargetDeviceCode,
			data: frame.data,
			// Store original prefixed ID byte for potential debugging
			originalSourceByte: frame.id[0],
		};
	}


	function intToByteArray(integer, bytes) {
		const array = [];
		for (let i = 0; i < bytes; i++) {
			array.push(integer & 255);
			integer >>= 8;
		}
		// Bafang seems to use Little Endian for multi-byte values in data payloads
		return array; // Return in Little Endian order
	}


	function calculateChecksum(bytes) {
		let summ = 0;
		bytes.forEach((item) => {
			summ += item;
		});
		return summ & 255;
	}

	/**
	 * Converts the Bafang 4-byte ID array to a 32-bit number (Big Endian) for sending.
	 */
	function bafangIdArrayTo32Bit(idArray) {
		if (!Array.isArray(idArray) || idArray.length !== 4) {
			throw new Error("Invalid Bafang ID array format for conversion.");
		}
		return (idArray[0] << 24) | (idArray[1] << 16) | (idArray[2] << 8) | idArray[3];
	}

	/**
	 * Generates the Bafang 4-byte CAN ID array, adding the channel prefix to the source byte.
	 * @param {DeviceNetworkId} source - The logical Bafang source ID (e.g., DeviceNetworkId.BESST).
	 * @param {DeviceNetworkId} target - The logical Bafang target ID.
	 * @param {CanOperation} canOperationCode
	 * @param {number} canCommandCode
	 * @param {number} canCommandSubCode
	 * @returns {number[]} The 4-byte array for ID construction.
	 */
	function generateCanFrameId(source, target, canOperationCode, canCommandCode, canCommandSubCode) {
		 // Add the prefix ONLY to the source byte when generating for sending
		 const prefixedSource = (source & 0x0F) | CAN_CHANNEL_PREFIX; // Mask source to 4 bits and add prefix
		 return [
			prefixedSource,
			((target & 0b11111) << 3) | (canOperationCode & 0b111),
			canCommandCode,
			canCommandSubCode,
		];
	}

// --- Export ---
module.exports = {
    CanOperation,
    DeviceNetworkId,
    charsToString,
    parseCanFrame,
    BafangCanBatteryParser,
    BafangCanControllerParser,
    BafangCanDisplayParser,
    BafangCanSensorParser,
    // Export Utilities needed by serializer
    intToByteArray,
    calculateChecksum,
    generateCanFrameId,
    bafangIdArrayTo32Bit,
	CAN_CHANNEL_PREFIX 
};