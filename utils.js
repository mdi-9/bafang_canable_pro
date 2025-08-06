
function mapId(canIdNum){
    const byte0 = (canIdNum >> 24) & 0xFF; 
    const byte1 = (canIdNum >> 16) & 0xFF; 
    const byte2 = (canIdNum >> 8) & 0xFF; 
    const byte3 = canIdNum & 0xFF; 
    return [byte0, byte1, byte2, byte3]; 
}
    
function parseCanFrame(frame) {

    // Strip the channel prefix from the source byte to get the logical Bafang ID
    const logicalSourceDeviceCode = frame[0] & 0x0F; // Mask to get lower 4 bits

    // Also strip prefix from target if needed? Usually target is just the Bafang ID.
    // Assuming target in byte 1 is already the logical Bafang ID.
    const logicalTargetDeviceCode = (frame[1] & 0b11111000) >> 3;

    return {
        canCommandCode: frame[2].toString(16),
        canCommandSubCode: frame[3].toString(16),
        canOperationCode: (frame[1] & 0b111).toString(16),
        sourceDeviceCode: logicalSourceDeviceCode.toString(16), // Use the stripped logical ID
        targetDeviceCode: logicalTargetDeviceCode.toString(16),
        //data: frame.data,
        // Store original prefixed ID byte for potential debugging
        originalSourceByte: frame[0].toString(16),
    };
}