const fsp = require("fs").promises;
const path = require("path");
const logsDir = path.join(__dirname, "logs");
const nanoTimer = require("nanotimer");

function mapId(canIdNum) {
  const byte0 = (canIdNum >> 24) & 0xff;
  const byte1 = (canIdNum >> 16) & 0xff;
  const byte2 = (canIdNum >> 8) & 0xff;
  const byte3 = canIdNum & 0xff;
  return [byte0, byte1, byte2, byte3];
}

function parseCanFrame(frame) {
  // Strip the channel prefix from the source byte to get the logical Bafang ID
  const logicalSourceDeviceCode = frame[0] & 0x0f; // Mask to get lower 4 bits

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

function formatRawCanFrameData(frame) {
  if (
    !frame ||
    typeof frame.can_id !== "number" ||
    typeof frame.can_dlc !== "number" ||
    !(frame.data instanceof DataView)
  ) {
    return {
      idHex: "INVALID",
      dataHex: "INVALID",
      dlc: 0,
      timestamp: Date.now() * 1000,
    };
  }

  const idHex = frame.can_id.toString(16).toUpperCase().padStart(8, "0");
  const dlc = frame.can_dlc;
  const dataBytes = [];

  // Safely read data bytes up to DLC length
  for (let i = 0; i < dlc && i < frame.data.byteLength; i++) {
    dataBytes.push(
      frame.data.getUint8(i).toString(16).toUpperCase().padStart(2, "0")
    );
  }
  const dataHex = dataBytes.join(" ");
  // Use frame timestamp if available, otherwise use current time
  const timestamp = frame.timestamp_us || Date.now() * 1000;

  return { idHex, dataHex, dlc, timestamp };
}

function formatRawCanFrameData2(frame) {
  if (
    !frame ||
    typeof frame.can_id !== "number" ||
    typeof frame.can_dlc !== "number" ||
    !(frame.data instanceof DataView)
  ) {
    return {
      idHex: "INVALID",
      data: [],
      dlc: 0,
      timestamp: Date.now() * 1000,
    };
  }

  const idHex = frame.can_id.toString(16).toUpperCase().padStart(8, "0");
  const dlc = frame.can_dlc;
  // Use frame timestamp if available, otherwise use current time
  const timestamp = frame.timestamp_us || Date.now() * 1000;

  return { idHex, dlc, timestamp, data: frame.data };
}

async function setupLogger(fileExt = 'log', countFiles = false) {
  try {
    // 1. Ensure directory exists
    await fsp.mkdir(logsDir, { recursive: true });

    // 2. Count existing files for the index
    let nextIndex = 0;
    if (countFiles) {
      const files = await fsp.readdir(logsDir);
      const logFiles = files.filter(f => f.endsWith(`.${fileExt}`));
      nextIndex = logFiles.length + 1;
    }

    // 3. Generate Date and Time strings
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "-"); // HH-MM-SS
    
    // Filename format: log-2023-10-27-14-30-05-n5.log
    const fileName = `log-${dateStr}-${timeStr}-n${nextIndex}.${fileExt}`;
    const logFilePath = path.join(logsDir, fileName);
    
    console.log("New log session started:", logFilePath);

    return async function logToFile(message) {
      const logEntry = `${message}\n`;
      try {
        await fsp.appendFile(logFilePath, logEntry);
      } catch (err) {
        console.error("Log write error:", err);
      }
    };
  } catch (err) {
    console.error("Logger setup failed:", err);
    process.exit(1);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const timer = new nanoTimer();
function delayu(ms) {
  ms = ms + "u";
  return new Promise((resolve) => timer.setTimeout(resolve, "", ms));
}

module.exports = {
  setupLogger,
  formatRawCanFrameData,
  formatRawCanFrameData2,
  delay,
  delayu
};
