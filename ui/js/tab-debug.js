// tab-debug.js — ES Module
import {
    state, socket,
    debugElements, tabButtons, connectCanButton, log, clearLogButton,
    switchTab, addLog, updateCanInterfaceDisplay,
    sendCustomFrame, encodeToHex,
    rawParamFieldMappings,
} from './shared.js';

export function populateHexEditor() {
    const tableBody = debugElements.hexEditorTableBody;
    const placeholder = debugElements.hexEditorPlaceholder;
    const hexEditorContainer = document.querySelector('.hex-editor-container');

    if (!tableBody || !placeholder || !hexEditorContainer) {
        console.error("Hex editor elements not found!");
        return;
    }

    // --- BEGIN PRESERVE FOCUS/VALUE ---
    let activeInputIndex = null;
    let activeInputValue = null;
    let activeInputSelectionStart = null;
    let activeInputSelectionEnd = null;

    if (document.activeElement && document.activeElement.matches('#hexEditorTableBody input[data-index]')) {
        activeInputIndex = document.activeElement.dataset.index;
        activeInputValue = document.activeElement.value;
        activeInputSelectionStart = document.activeElement.selectionStart;
        activeInputSelectionEnd = document.activeElement.selectionEnd;
    }
    // --- END PRESERVE FOCUS/VALUE ---

    tableBody.innerHTML = '';

    if (!state.currentRawParamType || !state.rawParamData[state.currentRawParamType]) {
        placeholder.textContent = state.currentRawParamType ? `Data for ${state.currentRawParamType} not yet received.` : 'Select a parameter block to view/edit.';
        placeholder.style.display = 'block';
        if (hexEditorContainer) hexEditorContainer.style.display = 'none';
        return;
    }

    placeholder.style.display = 'none';
    if (hexEditorContainer) hexEditorContainer.style.display = 'block';
    const bytes = state.rawParamData[state.currentRawParamType];
    const mappingInfo = rawParamFieldMappings[state.currentRawParamType];
    const numBytes = mappingInfo ? mappingInfo.byteLength : bytes.length;
    const numRows = 8;
    const numCols = 8;

    for (let i = 0; i < numRows; i++) {
        const row = tableBody.insertRow();
        for (let j = 0; j < numCols; j++) {
            const cell = row.insertCell();
            const byteIndex = i * numCols + j;

            if (byteIndex < numBytes) {
                const input = document.createElement('input');
                input.type = 'text';
                input.maxLength = 2;
                if (activeInputIndex === byteIndex.toString()) {
                    input.value = activeInputValue;
                } else {
                    input.value = bytes[byteIndex]?.toString(16).toUpperCase().padStart(2, '0') || '00';
                }
                input.dataset.index = byteIndex;
                input.addEventListener('change', handleHexInputChange);
                input.addEventListener('input', (e) => {
                    e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '');
                });

                let tooltipTextContent = `Byte Index: ${byteIndex}`;
                let fieldClass = 'hex-byte-single';

                if (mappingInfo && mappingInfo.fields) {
                    for (const field of mappingInfo.fields) {
                        if (byteIndex >= field.index && byteIndex < field.index + field.length) {
                            tooltipTextContent += `\nField: ${field.name}`;
                            if (field.length > 1) {
                                if (byteIndex === field.index) fieldClass = 'hex-byte-highlight-start';
                                else if (byteIndex === field.index + field.length - 1) fieldClass = 'hex-byte-highlight-end';
                                else fieldClass = 'hex-byte-highlight-middle';
                            }
                            break;
                        }
                    }
                }
                cell.classList.add(fieldClass);

                const tooltipSpan = document.createElement('span');
                tooltipSpan.classList.add('tooltiptext');
                tooltipSpan.textContent = tooltipTextContent;
                cell.appendChild(tooltipSpan);
                cell.appendChild(input);

                cell.addEventListener('mouseenter', () => {
                    const tooltip = cell.querySelector('.tooltiptext');
                    if (!tooltip) return;
                    tooltip.style.position = 'absolute';
                    tooltip.style.visibility = 'hidden';
                    tooltip.style.display = 'block';
                    const cellRect = cell.getBoundingClientRect();
                    const containerRect = hexEditorContainer.getBoundingClientRect();
                    const tooltipWidth = tooltip.offsetWidth;
                    let idealLeft = (cell.offsetWidth / 2) - (tooltipWidth / 2);
                    const cellLeftInContainer = cellRect.left - containerRect.left + hexEditorContainer.scrollLeft;
                    let potentialTooltipLeftInContainer = cellLeftInContainer + idealLeft;
                    if (potentialTooltipLeftInContainer < hexEditorContainer.scrollLeft + 5) {
                        idealLeft = (hexEditorContainer.scrollLeft + 5) - cellLeftInContainer;
                    } else if (potentialTooltipLeftInContainer + tooltipWidth > hexEditorContainer.scrollLeft + hexEditorContainer.clientWidth - 5) {
                        idealLeft = (hexEditorContainer.scrollLeft + hexEditorContainer.clientWidth - tooltipWidth - 5) - cellLeftInContainer;
                    }
                    tooltip.style.left = `${idealLeft}px`;
                    tooltip.style.display = '';
                    tooltip.style.visibility = '';
                });
            } else {
                cell.textContent = '--';
            }
        }
    }

    if (activeInputIndex !== null) {
        const inputToRestore = tableBody.querySelector(`input[data-index='${activeInputIndex}']`);
        if (inputToRestore) {
            inputToRestore.focus();
            try {
                inputToRestore.setSelectionRange(activeInputSelectionStart, activeInputSelectionEnd);
            } catch (e) {
                console.warn("Could not restore selection range:", e);
            }
        }
    }
}

function handleHexInputChange(event) {
    const input = event.target;
    const byteIndex = parseInt(input.dataset.index, 10);
    let newValue = parseInt(input.value, 16);

    if (isNaN(newValue) || newValue < 0 || newValue > 255) {
        const oldValue = state.rawParamData[state.currentRawParamType]?.[byteIndex];
        input.value = oldValue?.toString(16).toUpperCase().padStart(2, '0') || '00';
        addLog('ERROR', `Invalid hex value entered for byte ${byteIndex}. Must be 00-FF.`);
        return;
    }

    if (state.rawParamData[state.currentRawParamType] && byteIndex < state.rawParamData[state.currentRawParamType].length) {
        state.rawParamData[state.currentRawParamType][byteIndex] = newValue;
        addLog('DEBUG', `Raw param ${state.currentRawParamType} byte ${byteIndex} changed to 0x${newValue.toString(16).toUpperCase()}`);

        const mapping = rawParamFieldMappings[state.currentRawParamType];
        if (mapping && mapping.byteLength === 64 && byteIndex !== 63) {
            const checksumByteIndex = 63;
            let sum = 0;
            for (let k = 0; k < checksumByteIndex; k++) {
                sum += state.rawParamData[state.currentRawParamType][k];
            }
            const newChecksum = sum & 0xFF;
            state.rawParamData[state.currentRawParamType][checksumByteIndex] = newChecksum;

            const checksumInput = debugElements.hexEditorTableBody.querySelector(`input[data-index='${checksumByteIndex}']`);
            if (checksumInput) {
                checksumInput.value = newChecksum.toString(16).toUpperCase().padStart(2, '0');
            }
            addLog('DEBUG', `Auto-updated checksum for ${state.currentRawParamType} to 0x${newChecksum.toString(16).toUpperCase()}`);
        }
    }
}

// --- Tab Switching ---
tabButtons.forEach(button => button.addEventListener('click', () => switchTab(button.getAttribute('data-tab'))));

// --- Connect/Disconnect Button Listener ---
connectCanButton.addEventListener('click', () => {
    if (state.isCanConnected) {
        socket.send('DISCONNECT_CAN');
        updateCanInterfaceDisplay('DISCONNECTING', state.currentCanDeviceName);
    } else if (state.isCanDeviceFound) {
        socket.send('CONNECT_CAN');
        updateCanInterfaceDisplay('CONNECTING', state.currentCanDeviceName);
    } else {
        addLog('INFO', 'Attempted to connect but no CAN device found.');
        socket.send('GET_CAN_INTERFACE_STATUS');
    }
});

clearLogButton.onclick = () => { log.innerHTML = ''; addLog('INFO', 'Log cleared.'); };

document.querySelectorAll('.read-controls button').forEach(button => {
    button.onclick = () => {
        const command = button.getAttribute('data-command');
        if (command && socket.readyState === WebSocket.OPEN) { socket.send(command); addLog('REQ', `${button.textContent} initiated`); }
        else if (!command) { addLog('ERROR', 'Button missing data-command.'); }
        else { addLog('ERROR', 'WebSocket not open.'); }
    };
});

function validIdAndData(id, data) {
    if (!id) {
        alert('CAN ID required.'); return false;
    } if (!/^[0-9a-fA-F]+$/.test(id)) {
        alert('CAN ID must be hex.'); return false;
    } if (data && !/^[0-9a-fA-F]*$/.test(data)) {
        alert('Data must be hex.'); return false;
    } if (data.length % 2 !== 0) {
        alert('Data hex must have even length.'); return false;
    } if (data.length > 16) {
        alert('Data length max 8 bytes.'); return false;
    }
    return true;
}

debugElements.sendCustomFrameButton.onclick = () => {
    const id = debugElements.canIdInput.value.trim();
    const data = debugElements.canDataInput.value.trim().replace(/\s/g, '');
    if (!validIdAndData(id, data)) return;
    sendCustomFrame(id, data);
};

let intervalId = null;
debugElements.startCustomFrameInterval.onclick = () => {
    const id = debugElements.canIdInputInterval.value.trim();
    const data = debugElements.canDataInputInterval.value.trim().replace(/\s/g, '');
    const seconds = parseInt(debugElements.secondsInterval.value.trim());
    if (!validIdAndData(id, data)) return;
    sendCustomFrame(id, data);
    intervalId = setInterval(sendCustomFrame, (seconds * 1000), id, data);
    debugElements.startCustomFrameInterval.disabled = true;
    debugElements.stopCustomFrameInterval.disabled = false;
};

debugElements.stopCustomFrameInterval.onclick = () => {
    clearInterval(intervalId);
    intervalId = null;
    debugElements.startCustomFrameInterval.disabled = false;
    debugElements.stopCustomFrameInterval.disabled = true;
};

function decodeFrame(hexInput) {
    if (!hexInput) {
        addLog('ERROR', 'CAN ID required for decoding.');
        return;
    }
    const frameID = parseInt(hexInput, 16);

    if (isNaN(frameID)) {
        addLog('ERROR', 'Invalid hex input for decoding.');
        return;
    }

    const command = frameID & 0xFFFF;
    const operation = (frameID >> 16) & 0x07;
    const target = (frameID >> 19) & 0x1F;
    const source = (frameID >> 24) & 0x1F;

    const operations = {
        0: "Write",
        1: "Read",
        2: "Acknoledge OK",
        3: "Acknoledge NOK",
        4: "Start Multiframe",
        5: "Multiframe ongoing",
        6: "End Multiframe",
        7: "Multiframe warning",
    };

    const components = {
        1: "Torquesensor",
        2: "Controller",
        3: "Display",
        4: "Battery",
        5: "BESST",
        0x1F: "Broadcast to all listeners on the bus",
    };

    addLog('INFO', `Decoded Frame ID: ${frameID.toString(16).padStart(8, '0')}`);
    addLog('INFO', `Command: ${command.toString(16).padStart(2, '0')}`);
    addLog('INFO', `Operation: ${operations[operation] || "Unknown"} (${operation})`);

    if (components[target])
        addLog('INFO', `Target: ${components[target]} (${target})`);

    if (components[source])
        addLog('INFO', `Source: ${components[source]} (${source})`);
}

debugElements.decodeCustomFrameButton.onclick = () => {
    const hexInput = debugElements.canIdInput.value.trim().replace(/\s/g, '');
    decodeFrame(hexInput);
};

if (debugElements.rawParamSelect) {
    debugElements.rawParamSelect.addEventListener('change', (event) => {
        state.currentRawParamType = event.target.value;
        addLog('DEBUG', `Raw parameter type selected: ${state.currentRawParamType || 'None'}`);
        populateHexEditor();
    });
}

if (debugElements.rawParamSyncButton) {
    debugElements.rawParamSyncButton.onclick = () => {
        state.currentRawParamType = debugElements.rawParamSelect.value;
        if (!state.currentRawParamType) {
            alert('Please select a parameter block from the dropdown first.');
            return;
        }
        addLog('REQ', `Syncing raw parameter: ${state.currentRawParamType}`);
        let readCommand = '';
        switch (state.currentRawParamType) {
            case 'controller_params_0': readCommand = 'READ:2:96:16'; break;
            case 'controller_params_1': readCommand = 'READ:2:96:17'; break;
            case 'controller_params_2': readCommand = 'READ:2:96:18'; break;
            case 'controller_params_6017': readCommand = 'READ:2:96:23'; break;
            case 'controller_params_6018': readCommand = 'READ:2:96:24'; break;
            case 'controller_speed_params': readCommand = 'READ:2:50:3'; break;
            default:
                addLog('ERROR', `Unknown raw parameter type for sync: ${state.currentRawParamType}`);
                return;
        }
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(readCommand);
        } else {
            addLog('ERROR', 'WebSocket not open for raw param sync.');
        }
    };
}

export function handleCustomRaw(parsedEvent) {
    const destCode = debugElements.rawDestSelect.value;
    const cmdCode = debugElements.rawParamCodeInput.value;
    const subCode = debugElements.rawParamSubCodeInput.value;
    if (cmdCode.length != 2 || subCode.length != 2)
        return false;
    const cmdCode0x = parseInt('0x' + cmdCode);
    const subCode0x = parseInt('0x' + subCode);
    if (destCode != parsedEvent.source || cmdCode0x != parsedEvent.cmdCode || subCode0x != parsedEvent.subCode)
        return false;
    state.rawParamData[`${destCode}:${cmdCode0x}:${subCode0x}`] = [...parsedEvent.data._rawBytes];
    addLog(`RX (${parsedEvent.type || 'unknown'})`, parsedEvent);
    return true;
}

debugElements.rawParamCustomSyncButton.onclick = () => {
    const destCode = debugElements.rawDestSelect.value;
    const cmdCode = debugElements.rawParamCodeInput.value;
    const subCode = debugElements.rawParamSubCodeInput.value;
    if (cmdCode.length != 2 || subCode.length != 2) {
        alert('Wrong code || subcode');
        return;
    }
    const cmdCode0x = parseInt('0x' + cmdCode);
    const subCode0x = parseInt('0x' + subCode);
    state.currentRawParamType = `${destCode}:${cmdCode0x}:${subCode0x}`;
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(`READ_RAW:${destCode}:${cmdCode0x}:${subCode0x}`);
    } else {
        addLog('ERROR', 'WebSocket not open for raw param sync.');
    }
};

function triggerClick(elem) {
    elem.click();
}

let intervalSyncId = null;
debugElements.rawParamCustomSyncIntervalStartButton.onclick = () => {
    intervalSyncId = setInterval(triggerClick, 1000, debugElements.rawParamCustomSyncButton);
    debugElements.rawParamCustomSyncIntervalStartButton.disabled = true;
    debugElements.rawParamCustomSaveButton.disabled = true;
    debugElements.rawParamCustomSyncIntervalStopButton.disabled = false;
};

debugElements.rawParamCustomSyncIntervalStopButton.onclick = () => {
    clearInterval(intervalSyncId);
    intervalSyncId = null;
    debugElements.rawParamCustomSyncIntervalStartButton.disabled = false;
    debugElements.rawParamCustomSaveButton.disabled = false;
    debugElements.rawParamCustomSyncIntervalStopButton.disabled = true;
};

debugElements.rawParamCustomSaveButton.onclick = () => {
    if (!state.currentRawParamType || !state.rawParamData[state.currentRawParamType]) {
        alert('Please select a parameter block and ensure data is loaded before saving.');
        return;
    }

    let bytesToSend = [...state.rawParamData[state.currentRawParamType]];

    if (!bytesToSend || !Array.isArray(bytesToSend)) {
        addLog('ERROR', `No byte data available to save for ${state.currentRawParamType}`);
        return;
    }

    if (!confirm(`Are you sure you want to write the raw bytes for ${state.currentRawParamType} to the selected destination? This can be risky!`)) {
        return;
    }
    addLog('SAVE_REQ', `Saving raw parameter: ${state.currentRawParamType}`);

    const destCode = debugElements.rawDestSelect.value;
    const cmdCode = debugElements.rawParamCodeInput.value;
    const subCode = debugElements.rawParamSubCodeInput.value;
    if (cmdCode.length != 2 || subCode.length != 2) {
        alert('Wrong code || subcode');
        return;
    }
    const cmdCode0x = parseInt('0x' + cmdCode);
    const subCode0x = parseInt('0x' + subCode);

    const dataHex = bytesToSend.map(b => b.toString(16).padStart(2, '0')).join('');
    let commandToSend = `WRITE_SHORT_RAW:${destCode}:${cmdCode0x}:${subCode0x}:${dataHex}`;
    if (bytesToSend.length > 8) {
        commandToSend = `WRITE_LONG_RAW:${destCode}:${cmdCode0x}:${subCode0x}:${JSON.stringify(bytesToSend)}`;
    }

    if (socket.readyState === WebSocket.OPEN) {
        try {
            socket.send(commandToSend);
            const logDataPreview = bytesToSend.map(b => '0x' + b.toString(16)).join(',');
            addLog('INFO', `Raw data command for ${state.currentRawParamType} sent to server. Data preview: [${logDataPreview}]`);
        } catch (e) {
            addLog('ERROR', `Failed to send raw data command for ${state.currentRawParamType}: ${e.message}`);
        }
    } else {
        addLog('ERROR', 'WebSocket not open for raw param save.');
    }
};

if (debugElements.rawParamSaveButton) {
    debugElements.rawParamSaveButton.onclick = () => {
        if (!state.currentRawParamType || !state.rawParamData[state.currentRawParamType]) {
            alert('Please select a parameter block and ensure data is loaded before saving.');
            return;
        }

        let bytesToSend = [...state.rawParamData[state.currentRawParamType]];

        if (!bytesToSend || !Array.isArray(bytesToSend)) {
            addLog('ERROR', `No byte data available to save for ${state.currentRawParamType}`);
            return;
        }

        const mapping = rawParamFieldMappings[state.currentRawParamType];
        if (mapping && mapping.byteLength === 64) {
            const checksumByteIndex = 63;
            if (bytesToSend.length === 64) {
                let sum = 0;
                for (let k = 0; k < checksumByteIndex; k++) {
                    sum += bytesToSend[k];
                }
                const calculatedChecksum = sum & 0xFF;
                bytesToSend[checksumByteIndex] = calculatedChecksum;
                addLog('DEBUG', `Calculated and set checksum for ${state.currentRawParamType} to 0x${calculatedChecksum.toString(16).toUpperCase()} before sending.`);

                const checksumInputInUI = debugElements.hexEditorTableBody.querySelector(`input[data-index='${checksumByteIndex}']`);
                if (checksumInputInUI && parseInt(checksumInputInUI.value, 16) !== calculatedChecksum) {
                    checksumInputInUI.value = calculatedChecksum.toString(16).toUpperCase().padStart(2, '0');
                    addLog('INFO', `Checksum UI field updated to 0x${calculatedChecksum.toString(16).toUpperCase()} to match calculation.`);
                }
            } else {
                addLog('ERROR', `Cannot calculate checksum for ${state.currentRawParamType}: Expected 64 bytes, got ${bytesToSend.length}.`);
                alert(`Data length error for ${state.currentRawParamType}. Cannot calculate checksum.`);
                return;
            }
        }

        if (!confirm(`Are you sure you want to write the (potentially checksum-updated) raw bytes for ${state.currentRawParamType} to the controller? This can be risky.`)) {
            return;
        }
        addLog('SAVE_REQ', `Saving raw parameter: ${state.currentRawParamType}`);

        let commandToSend = '';
        switch (state.currentRawParamType) {
            case 'controller_params_0':
                commandToSend = `WRITE_LONG_P0_RAW:${JSON.stringify(bytesToSend)}`;
                break;
            case 'controller_params_1':
                commandToSend = `WRITE_LONG_P1_RAW:${JSON.stringify(bytesToSend)}`;
                break;
            case 'controller_params_2':
                commandToSend = `WRITE_LONG_P2_RAW:${JSON.stringify(bytesToSend)}`;
                break;
            case 'controller_speed_params': {
                const dataHex = bytesToSend.map(b => b.toString(16).padStart(2, '0')).join('');
                commandToSend = `WRITE_SHORT:2:50:3:${dataHex}`;
                break;
            }
            default:
                addLog('ERROR', `Unknown raw parameter type for save: ${state.currentRawParamType}`);
                alert(`Cannot save unknown raw parameter type: ${state.currentRawParamType}`);
                return;
        }

        if (socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(commandToSend);
                const logDataPreview = bytesToSend.slice(0, 5).map(b => '0x' + b.toString(16)).join(',') +
                    (bytesToSend.length > 5 ? `... (checksum: 0x${bytesToSend[63]?.toString(16)})` : '');
                addLog('INFO', `Raw data command for ${state.currentRawParamType} sent to server. Data preview: [${logDataPreview}]`);
            } catch (e) {
                addLog('ERROR', `Failed to send raw data command for ${state.currentRawParamType}: ${e.message}`);
            }
        } else {
            addLog('ERROR', 'WebSocket not open for raw param save.');
        }
    };
}
