const FTMS_SERVICE = 0x1826;
const TREADMILL_DATA_CHAR = 0x2ACD;
const CONTROL_POINT_CHAR = 0x2AD9;

let bluetoothDevice = null;
let gattServer = null;
let treadmillCharacteristic = null;
let controlCharacteristic = null;

// UI Elements
const btnConnect = document.getElementById('btn-connect');
const btnDisconnect = document.getElementById('btn-disconnect');
const btnStartRun = document.getElementById('btn-start-run');
const btnStopRun = document.getElementById('btn-stop-run');
const statusDot = document.getElementById('bt-status-dot');
const statusText = document.getElementById('bt-status-text');
const runStatusText = document.getElementById('run-status-text');

// Machine Controls UI
const machineControlsPanel = document.getElementById('machine-controls');
const btnMachineStart = document.getElementById('btn-machine-start');
const btnMachinePause = document.getElementById('btn-machine-pause');
const btnMachineStop = document.getElementById('btn-machine-stop');
const btnSetSpeed = document.getElementById('btn-set-speed');
const inputSpeed = document.getElementById('input-speed');
const btnSetIncline = document.getElementById('btn-set-incline');
const inputIncline = document.getElementById('input-incline');
const cmdStatus = document.getElementById('machine-cmd-status');

// Metrics Elements
const elSpeed = document.getElementById('metric-speed');
const elDistance = document.getElementById('metric-distance');
const elTime = document.getElementById('metric-time');
const elIncline = document.getElementById('metric-incline');
const elHr = document.getElementById('metric-hr');

// Current Run State
let isRecording = false;
let currentRun = {
    startTime: null,
    durationSeconds: 0,
    distanceStartOffset: null, // to calc distance within the session
    distance: 0, // meters
    speeds: [],
    caloriesStartOffset: null,
    calories: 0
};

// --- Bluetooth Connection ---

async function connectToTreadmill() {
    try {
        console.log('Requesting Bluetooth Device...');
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [FTMS_SERVICE] }]
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

        console.log('Connecting to GATT Server...');
        gattServer = await bluetoothDevice.gatt.connect();

        console.log('Getting FTMS Service...');
        const service = await gattServer.getPrimaryService(FTMS_SERVICE);

        console.log('Getting Treadmill Data Characteristic...');
        treadmillCharacteristic = await service.getCharacteristic(TREADMILL_DATA_CHAR);

        console.log('Starting Notifications...');
        await treadmillCharacteristic.startNotifications();
        treadmillCharacteristic.addEventListener('characteristicvaluechanged', handleTreadmillData);

        console.log('Getting Control Point Characteristic...');
        try {
            controlCharacteristic = await service.getCharacteristic(CONTROL_POINT_CHAR);
            await controlCharacteristic.startNotifications(); // Enables Indications
            controlCharacteristic.addEventListener('characteristicvaluechanged', handleControlResponse);
            
            // Auto-request control upon connecting
            setTimeout(requestMachineControl, 500); 
        } catch (ctrlError) {
            console.warn('Control Point not found or failed to subscribe. Machine cannot be controlled via app.', ctrlError);
        }

        updateConnectionStatus(true);
    } catch (error) {
        console.error('Connection failed!', error);
        alert('Failed to connect: ' + error.message);
    }
}

function disconnectTreadmill() {
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
    }
}

function onDisconnected() {
    console.log('Device disconnected');
    updateConnectionStatus(false);
    if (isRecording) {
        stopRun();
    }
}

function updateConnectionStatus(connected) {
    if (connected) {
        statusDot.classList.replace('bg-red-500', 'bg-green-500');
        statusText.textContent = 'Connected: ' + (bluetoothDevice.name || 'Treadmill');
        btnConnect.classList.add('hidden');
        btnDisconnect.classList.remove('hidden');
        btnStartRun.disabled = false;
        btnStartRun.classList.remove('opacity-50', 'cursor-not-allowed');
        
        if (controlCharacteristic) {
            machineControlsPanel.classList.remove('opacity-50', 'pointer-events-none');
        }
    } else {
        statusDot.classList.replace('bg-green-500', 'bg-red-500');
        statusText.textContent = 'Disconnected';
        btnConnect.classList.remove('hidden');
        btnDisconnect.classList.add('hidden');
        btnStartRun.disabled = true;
        btnStartRun.classList.add('opacity-50', 'cursor-not-allowed');
        machineControlsPanel.classList.add('opacity-50', 'pointer-events-none');
        
        // Reset metrics
        elSpeed.textContent = '0.0';
        elIncline.textContent = '0';
        elHr.textContent = '--';
    }
}

// --- Machine Control Functions (FTMS 0x2AD9) ---

function showCmdStatus(msg) {
    cmdStatus.textContent = msg;
    setTimeout(() => { cmdStatus.textContent = ''; }, 3000);
}

function handleControlResponse(event) {
    const value = event.target.value;
    if (value.byteLength >= 3 && value.getUint8(0) === 0x80) {
        const reqOpCode = value.getUint8(1);
        const resultCode = value.getUint8(2);
        
        let resultMsg = resultCode === 0x01 ? 'Success' : 
                        resultCode === 0x02 ? 'Not Supported' : 
                        resultCode === 0x03 ? 'Invalid Parameter' : 
                        resultCode === 0x04 ? 'Operation Failed' : 
                        resultCode === 0x05 ? 'Control Not Permitted' : `Error 0x${resultCode.toString(16)}`;

        console.log(`Command 0x${reqOpCode.toString(16)} returned: ${resultMsg}`);
        
        if (resultCode !== 0x01) {
            showCmdStatus(`Warning: Command rejected (${resultMsg})`);
        }
    }
}

async function sendCommand(bytes) {
    if (!controlCharacteristic) return;
    try {
        await controlCharacteristic.writeValue(new Uint8Array(bytes));
    } catch (e) {
        console.error('Failed to send command', e);
        showCmdStatus('Error sending command.');
    }
}

async function requestMachineControl() {
    console.log('Requesting Control (0x00)...');
    await sendCommand([0x00]);
    showCmdStatus('Requested control of machine.');
}

async function startMachine() {
    await sendCommand([0x07]);
    showCmdStatus('Sent Start command.');
}

async function pauseMachine() {
    await sendCommand([0x08, 0x02]);
    showCmdStatus('Sent Pause command.');
}

async function stopMachine() {
    await sendCommand([0x08, 0x01]);
    showCmdStatus('Sent Stop command.');
}

async function setMachineSpeed() {
    let speedKmh = parseFloat(inputSpeed.value);
    if (isNaN(speedKmh)) return;
    
    // Resolution is 0.01 km/h. Example: 6.5 km/h -> 650.
    const speedInt = Math.round(speedKmh * 100);
    const lowByte = speedInt & 0xFF;
    const highByte = (speedInt >> 8) & 0xFF;
    
    await sendCommand([0x02, lowByte, highByte]);
    showCmdStatus(`Sent Speed: ${speedKmh} km/h`);
}

async function setMachineIncline() {
    let inclinePct = parseFloat(inputIncline.value);
    if (isNaN(inclinePct)) return;

    // Resolution is 0.1%. Example: 3.0% -> 30.
    const inclineInt = Math.round(inclinePct * 10);
    const lowByte = inclineInt & 0xFF;
    const highByte = (inclineInt >> 8) & 0xFF;

    await sendCommand([0x03, lowByte, highByte]);
    showCmdStatus(`Sent Incline: ${inclinePct}%`);
}

// --- Data Parsing ---

function handleTreadmillData(event) {
    const value = event.target.value; // DataView
    let offset = 0;

    // Read Flags (16-bit)
    const flags = value.getUint16(offset, true); // little-endian
    offset += 2;

    const moreData = (flags & (1 << 0)) !== 0; // Bit 0 (inverted logic for speed)
    const avgSpeedPresent = (flags & (1 << 1)) !== 0;
    const totalDistancePresent = (flags & (1 << 2)) !== 0;
    const inclinePresent = (flags & (1 << 3)) !== 0;
    const elevGainPresent = (flags & (1 << 4)) !== 0;
    const instPacePresent = (flags & (1 << 5)) !== 0;
    const avgPacePresent = (flags & (1 << 6)) !== 0;
    const expEnergyPresent = (flags & (1 << 7)) !== 0;
    const hrPresent = (flags & (1 << 8)) !== 0;
    const metPresent = (flags & (1 << 9)) !== 0;
    const elapsedTimePresent = (flags & (1 << 10)) !== 0;
    const remainingTimePresent = (flags & (1 << 11)) !== 0;
    const forcePowerPresent = (flags & (1 << 12)) !== 0;

    let parsed = {};

    try {
        if (!moreData) {
            // Speed is present
            parsed.speed = value.getUint16(offset, true) / 100.0; // km/h
            offset += 2;
        }

        if (avgSpeedPresent) offset += 2;

        if (totalDistancePresent) {
            // 24-bit integer
            const distLow = value.getUint16(offset, true);
            const distHigh = value.getUint8(offset + 2);
            parsed.totalDistance = distLow + (distHigh << 16); // meters
            offset += 3;
        }

        if (inclinePresent) {
            parsed.inclination = value.getInt16(offset, true) / 10.0; // %
            offset += 2;
            // Ramp Angle Setting
            offset += 2;
        }

        if (elevGainPresent) offset += 4;
        if (instPacePresent) offset += 2; // Sometimes 1 byte, standard is 2
        if (avgPacePresent) offset += 2;

        if (expEnergyPresent) {
            parsed.totalCalories = value.getUint16(offset, true);
            offset += 2;
            // Energy Per Hour
            offset += 2;
            // Energy Per Minute
            offset += 1;
        }

        if (hrPresent) {
            parsed.heartRate = value.getUint8(offset);
            offset += 1;
        }

        if (metPresent) offset += 1;

        if (elapsedTimePresent) {
            parsed.elapsedTime = value.getUint16(offset, true); // seconds
            offset += 2;
        }

        updateDashboard(parsed);

    } catch (e) {
        console.warn('Error parsing FTMS payload, might be out of bounds:', e);
    }
}

// --- Dashboard & Run State ---

function updateDashboard(data) {
    if (data.speed !== undefined) {
        elSpeed.textContent = data.speed.toFixed(1);
        if (isRecording) currentRun.speeds.push(data.speed);
    }

    if (data.inclination !== undefined) {
        elIncline.textContent = data.inclination.toFixed(1);
    }

    if (data.heartRate !== undefined) {
        elHr.textContent = data.heartRate;
    }

    if (data.totalDistance !== undefined) {
        // Absolute total distance from machine
        if (isRecording) {
            if (currentRun.distanceStartOffset === null) {
                currentRun.distanceStartOffset = data.totalDistance;
            }
            currentRun.distance = data.totalDistance - currentRun.distanceStartOffset;
        }
        
        // Display distance for current session if recording, else machine total
        const displayDist = isRecording ? currentRun.distance : data.totalDistance;
        elDistance.textContent = (displayDist / 1000).toFixed(2);
    }

    if (data.totalCalories !== undefined) {
        if (isRecording) {
            if (currentRun.caloriesStartOffset === null) {
                currentRun.caloriesStartOffset = data.totalCalories;
            }
            currentRun.calories = data.totalCalories - currentRun.caloriesStartOffset;
        }
    }

    // Time from machine
    if (data.elapsedTime !== undefined) {
        if (!isRecording) {
             elTime.textContent = formatDuration(data.elapsedTime);
        }
    }
}

// Local timer fallback for run recording
let timerInterval;

function startRun() {
    isRecording = true;
    currentRun = {
        startTime: Date.now(),
        durationSeconds: 0,
        distanceStartOffset: null,
        distance: 0,
        speeds: [],
        caloriesStartOffset: null,
        calories: 0
    };

    btnStartRun.classList.add('hidden');
    btnStopRun.classList.remove('hidden');
    runStatusText.classList.remove('hidden');

    timerInterval = setInterval(() => {
        currentRun.durationSeconds = Math.floor((Date.now() - currentRun.startTime) / 1000);
        elTime.textContent = formatDuration(currentRun.durationSeconds);
    }, 1000);
}

function stopRun() {
    isRecording = false;
    clearInterval(timerInterval);

    btnStartRun.classList.remove('hidden');
    btnStopRun.classList.add('hidden');
    runStatusText.classList.add('hidden');

    // Calculate metrics and save
    const avgSpeed = currentRun.speeds.length > 0 
        ? currentRun.speeds.reduce((a, b) => a + b, 0) / currentRun.speeds.length 
        : 0;

    const sessionData = {
        durationSeconds: currentRun.durationSeconds,
        distance: currentRun.distance,
        avgSpeed: avgSpeed,
        calories: currentRun.calories
    };

    if (typeof saveSession === 'function') {
        saveSession(sessionData);
    } else {
        console.error('saveSession not found! Check storage.js');
    }
}

// --- Event Listeners ---

btnConnect.addEventListener('click', connectToTreadmill);
btnDisconnect.addEventListener('click', disconnectTreadmill);
btnStartRun.addEventListener('click', startRun);
btnStopRun.addEventListener('click', stopRun);

btnMachineStart.addEventListener('click', startMachine);
btnMachinePause.addEventListener('click', pauseMachine);
btnMachineStop.addEventListener('click', stopMachine);
btnSetSpeed.addEventListener('click', setMachineSpeed);
btnSetIncline.addEventListener('click', setMachineIncline);
