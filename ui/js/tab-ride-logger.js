// tab-ride-logger.js — ES Module
/* global Plotly */
import {
    socket,
    rideLoggerElements,
} from './shared.js';

rideLoggerElements.startButton.onclick = () => {
    rideLoggerElements.startButton.disabled = true;
    rideLoggerElements.stopButton.disabled = false;
    socket.send(`RIDE_LOGGER_START:${rideLoggerElements.logToFileCheckbox.checked}:${rideLoggerElements.liveViewCheckbox.checked}:${rideLoggerElements.refreshRateMsInput.value}`);
};

rideLoggerElements.stopButton.onclick = () => {
    rideLoggerElements.startButton.disabled = false;
    rideLoggerElements.stopButton.disabled = true;
    socket.send(`RIDE_LOGGER_STOP`);
};

rideLoggerElements.fullscreenButton.onclick = () => {
    const element = document.getElementById('rideLoggerChart');
    if (!document.fullscreenElement) {
        element.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
};

rideLoggerElements.clearButton.onclick = () => {
    rideLoggerSums.totalDist = 0;
    rideLoggerSums.totalWhMotor = 0;
    rideLoggerSums.totalWhHuman = 0;
    rideLoggerSums.lastTs = null;
    rideLoggerElements.liveStats.innerText = `Distance: 0.00 km | Motor: 0.00 Wh | Human: 0.00 Wh`;
    const update = {
        x: [[], [], [], [], [], []],
        y: [[], [], [], [], [], []],
    };
    Plotly.restyle('rideLoggerChart', update, [0, 1, 2, 3, 4, 5]);
};

const rideLoggerSums = {
    totalDist: 0,
    totalWhMotor: 0,
    totalWhHuman: 0,
    lastTs: null,
};

export function updateRideChart(rowCsv) {
    const parts = rowCsv.split(';');
    const row = {
        timestamp: parseFloat(parts[1]),
        soc: parseFloat(parts[2]),
        cadence: parseFloat(parts[3]),
        torque: parseFloat(parts[4]),
        speed: parseFloat(parts[5]),
        current: parseFloat(parts[6]),
        voltage: parseFloat(parts[7]),
        controllerTemp: parseFloat(parts[8]),
        motorTemp: parseFloat(parts[9]),
        assistLevel: parseInt(parts[10], 10),
        motorPower: parseFloat(parts[11]),
        humanPower: parseFloat(parts[12]),
        distance: parseFloat(parts[13]),
    };
    if (isNaN(row.timestamp)) return;

    const timeS = row.timestamp / 1000;

    if (rideLoggerSums.lastTs !== null) {
        const dtHours = (row.timestamp - rideLoggerSums.lastTs) / 3600000;
        if (dtHours > 0) {
            rideLoggerSums.totalDist += (row.speed || 0) * dtHours;
            rideLoggerSums.totalWhMotor += (row.motorPower || 0) * dtHours;
            rideLoggerSums.totalWhHuman += (row.humanPower || 0) * dtHours;
            rideLoggerElements.liveStats.innerText =
                `Distance: ${rideLoggerSums.totalDist.toFixed(2)} km | Motor: ${rideLoggerSums.totalWhMotor.toFixed(2)} Wh | Human: ${rideLoggerSums.totalWhHuman.toFixed(2)} Wh`;
        }
    }
    rideLoggerSums.lastTs = row.timestamp;

    let assistLabel = row.assistLevel;
    if (assistLabel === '-1') assistLabel = 'walk';

    const update = {
        x: [[timeS], [timeS], [timeS], [timeS], [timeS], [timeS]],
        y: [
            [row.motorPower],
            [row.humanPower],
            [row.cadence],
            [row.speed],
            [row.torque],
            [assistLabel],
        ],
    };

    const MAX_POINTS = 12000;
    Plotly.extendTraces('rideLoggerChart', update, [0, 1, 2, 3, 4, 5], MAX_POINTS);

    const windowSize = 600;
    Plotly.relayout('rideLoggerChart', {
        'xaxis.range': [timeS - windowSize, timeS],
    });
}

Plotly.newPlot('rideLoggerChart', [
    { x: [], y: [], name: "Motor Power (W)", line: { color: '#ff4d4d' } },
    { x: [], y: [], name: "Human Power (W)", line: { color: '#00cc66' } },
    { x: [], y: [], name: "Cadence (rpm)", yaxis: 'y2', line: { color: '#3399ff', width: 1 } },
    { x: [], y: [], name: "Speed (km/h)", yaxis: 'y2', line: { color: '#ffffff', width: 1.5 } },
    { x: [], y: [], name: "Torque (mV)", yaxis: 'y3', line: { color: '#9933ff', dash: 'dot' }, visible: "legendonly" },
    { x: [], y: [], name: "Assist Level", yaxis: 'y4', line: { color: '#ffa500', width: 2, shape: 'hv' } },
],
{
    template: "plotly_dark",
    paper_bgcolor: '#111',
    plot_bgcolor: '#111',
    margin: { t: 50, b: 50, l: 80, r: 80 },
    xaxis: { title: "Time (s)", domain: [0.12, 0.88] },
    yaxis: { title: "Power (W)", titlefont: { color: "#ff4d4d" }, tickfont: { color: "#ff4d4d" } },
    yaxis2: { title: "RPM / km/h", anchor: "x", overlaying: "y", side: "right", titlefont: { color: "#3399ff" }, tickfont: { color: "#3399ff" } },
    yaxis3: { title: "Torque (mV)", anchor: "free", overlaying: "y", side: "right", position: 0.98, titlefont: { color: "#9933ff" }, tickfont: { color: "#9933ff" } },
    yaxis4: {
        title: "Assist", anchor: "free", overlaying: "y", side: "left", position: 0.02,
        type: 'category', categoryarray: ['walk', '0', '1', '2', '3', '4', '5'], categoryorder: 'array',
        titlefont: { color: "#ffa500" }, tickfont: { color: "#ffa500" },
    },
    hovermode: "x unified",
    showlegend: true,
    autosize: true,
    legend: { orientation: 'h', y: -0.2 },
}, { responsive: true });

document.addEventListener('fullscreenchange', () => {
    Plotly.Plots.resize('rideLoggerChart');
});
