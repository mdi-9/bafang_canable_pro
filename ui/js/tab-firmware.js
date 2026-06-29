// tab-firmware.js — ES Module
import {
    socket,
    fwUpdateElements, tabButtons, connectCanButton,
    safeSetText,
    addLog,
} from './shared.js';

fwUpdateElements.fileInput.onchange = () => {
    if (fwUpdateElements.fileInput.files && fwUpdateElements.fileInput.files.length > 0) {
        fwUpdateElements.startButton.disabled = false;
    } else {
        fwUpdateElements.startButton.disabled = true;
    }
};

fwUpdateElements.startButton.onclick = () => {
    fwUpdateElements.logArea.innerHTML = '';
    fwUpdateElements.startButton.disabled = true;
    fwUpdateElements.fileInput.disabled = true;
    tabButtons.forEach(button => button.disabled = true);
    connectCanButton.disabled = true;
    const file = fwUpdateElements.fileInput.files[0];
    var reader = new FileReader();
    reader.onload = function (e) {
        const base64Content = e.target.result.split(',')[1];
        socket.send(`FW_UPDATE_START:${fwUpdateElements.modeSelect.value}:${fwUpdateElements.delayInput.value}:${base64Content}`);
        updateFwUpdateProgress(0);
    };
    reader.readAsDataURL(file);
};

fwUpdateElements.clearButton.onclick = () => { fwUpdateElements.logArea.innerHTML = ''; };

export function updateFwUpdateProgress(progress) {
    safeSetText(fwUpdateElements.progressValue, progress);
}

export function addFwUpdateLog(data) {
    const entry = document.createElement('div'); entry.classList.add('log-entry');
    const timeSpan = document.createElement('span'); timeSpan.classList.add('log-time'); timeSpan.textContent = `[${new Date().toLocaleTimeString()}]`;
    const dataSpan = document.createElement('span'); dataSpan.classList.add('log-data');
    dataSpan.textContent = String(data);

    entry.appendChild(timeSpan);
    entry.appendChild(dataSpan);

    fwUpdateElements.logArea.appendChild(entry);
    fwUpdateElements.logArea.scrollTop = fwUpdateElements.logArea.scrollHeight;
}
