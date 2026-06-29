// init.js — ES Module entry point
import { populateWheelSelect, switchTab, updateCanInterfaceDisplay, statusText } from './shared.js';
import { populateHexEditor } from './tab-debug.js';
import { updatePasCurvesChartUnified, updateStartRampChartUnified } from './tab-gears.js';

// Import all tab files to register their event listeners.
// Modules already imported above (tab-debug, tab-gears) are cached by the browser —
// the side-effect imports below ensure the remaining tabs are loaded too.
import './websocket.js';
import './tab-controller.js';
import './tab-display.js';
import './tab-sensor.js';
import './tab-battery.js';
import './tab-gears-m820.js';
import './tab-info.js';
import './tab-firmware.js';
import './tab-sniffer.js';
import './tab-ride-logger.js';
import './tab-data-backup.js';

// --- Initial State ---
populateWheelSelect();
switchTab('controller');
populateHexEditor();
updateCanInterfaceDisplay('DEVICE_NOT_FOUND');
statusText.textContent = "Connecting to server...";
updatePasCurvesChartUnified(false);
updateStartRampChartUnified(false);
updatePasCurvesChartUnified(true);
updateStartRampChartUnified(true);
