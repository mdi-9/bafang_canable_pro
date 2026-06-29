// tab-sniffer.js — ES Module
import {
    socket,
    snifferElements,
    addLog,
} from './shared.js';

snifferElements.startButton.onclick = () => {
    snifferElements.logArea.innerHTML = '';
    snifferElements.startButton.disabled = true;
    snifferElements.stopButton.disabled = false;
    const items = snifferElements.filteredIdsListOn.querySelectorAll('.item span');
    const itemsJoined = Array.from(items).map(item => item.textContent).join(';');
    socket.send(`SNIFFER_START:${snifferElements.snifferLogToFileCheckbox.checked}:${itemsJoined}`);
};

snifferElements.stopButton.onclick = () => {
    snifferElements.startButton.disabled = false;
    snifferElements.stopButton.disabled = true;
    socket.send(`SNIFFER_STOP`);
};

snifferElements.clearButton.onclick = () => { snifferElements.logArea.innerHTML = ''; };

export function addSnifferLog(data) {
    const entry = document.createElement('div'); entry.classList.add('log-entry');
    const dataSpan = document.createElement('span'); dataSpan.classList.add('log-data');
    dataSpan.textContent = String(data);

    entry.appendChild(dataSpan);

    snifferElements.logArea.appendChild(entry);
    snifferElements.logArea.scrollTop = snifferElements.logArea.scrollHeight;
}

function createFilteredIdItem(text) {
    const li = document.createElement('li');
    li.className = 'item';
    li.draggable = true;
    li.innerHTML = `<span>${text}</span>`;

    li.addEventListener('dragstart', () => li.classList.add('dragging'));
    li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        snifferElements.zones.forEach(z => z.classList.remove('drag-over'));
    });

    return li;
}

snifferElements.addFilteredIdButton.onclick = () => {
    const id = snifferElements.newFilteredIdInput.value.trim();
    if (id && /^[0-9a-fA-F]+$/.test(id)) {
        snifferElements.filteredIdsListOn.appendChild(createFilteredIdItem(id));
        const items = snifferElements.filteredIdsListOn.querySelectorAll('.item span');
        document.cookie = `FilteredIdsOn=${Array.from(items).map(item => item.textContent).join(',')}; path=/; max-age=31536000; `;
        snifferElements.newFilteredIdInput.value = '';
        snifferElements.newFilteredIdInput.focus();
    } else
        alert('CAN ID must be hex.');
};

snifferElements.zones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');

        const draggingItem = document.querySelector('.dragging');
        if (!draggingItem) return;

        const afterElement = getDragAfterElement(zone, e.clientX);

        if (afterElement == null) {
            zone.appendChild(draggingItem);
        } else {
            zone.insertBefore(draggingItem, afterElement);
        }
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', () => {
        zone.classList.remove('drag-over');
        const items = snifferElements.filteredIdsListOn.querySelectorAll('.item span');
        const itemsJoined = Array.from(items).map(item => item.textContent).join(';');
        document.cookie = `FilteredIdsOn=${Array.from(items).map(item => item.textContent).join(',')}; path=/; max-age=31536000; `;
        const itemsOff = snifferElements.filteredIdsListOff.querySelectorAll('.item span');
        document.cookie = `FilteredIdsOff=${Array.from(itemsOff).map(item => item.textContent).join(',')}; path=/; max-age=31536000; `;
        socket.send(`SNIFFER_FILTEREDIDS_SET:${itemsJoined}`);
    });
});

function getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('.item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

snifferElements.snifferLogToFileCheckbox.addEventListener('change', (e) => {
    socket.send(`SNIFFER_LOG_ENABLE:${e.target.checked}`);
});

const getCookie = (name) => {
    return document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)')?.pop() || null;
};

const savedFilteredIdsOn = getCookie('FilteredIdsOn');
if (savedFilteredIdsOn)
    savedFilteredIdsOn.split(',').forEach(t => snifferElements.filteredIdsListOn.appendChild(createFilteredIdItem(t)));
else
    ['82F83200', '82F83201', '82F83202', '82F83203', '82F83204', '82F83205', '82F83206', '82F83207', '82F83208', '82F83209', '82F8320A', '82F8320B',
    ].forEach(t => snifferElements.filteredIdsListOn.appendChild(createFilteredIdItem(t)));

const savedFilteredIdsOff = getCookie('FilteredIdsOff');
if (savedFilteredIdsOff)
    savedFilteredIdsOff.split(',').forEach(t => snifferElements.filteredIdsListOff.appendChild(createFilteredIdItem(t)));
