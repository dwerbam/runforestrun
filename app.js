const FTMS_SERVICE = 0x1826;
const TREADMILL_DATA_CHAR = 0x2ACD;
const CONTROL_POINT_CHAR = 0x2AD9;

let bluetoothDevice = null;
let gattServer = null;
let treadmillCharacteristic = null;
let controlCharacteristic = null;

// UI Elements
const btnConnect = document.getElementById('btn-connect');
const btnSimulate = document.getElementById('btn-simulate');
const btnDisconnect = document.getElementById('btn-disconnect');
const btnStartRun = document.getElementById('btn-start-run');
const btnPauseRun = document.getElementById('btn-pause-run');
const btnStopRun = document.getElementById('btn-stop-run');
const statusDot = document.getElementById('bt-status-dot');
const statusText = document.getElementById('bt-status-text');
const runStatusText = document.getElementById('run-status-text');

// Machine Controls UI
const machineControlsPanel = document.getElementById('machine-controls');
const btnMachineStart = document.getElementById('btn-machine-start');
const btnMachinePause = document.getElementById('btn-machine-pause');
const btnMachineStop = document.getElementById('btn-machine-stop');

const displayTargetSpeed = document.getElementById('display-target-speed');
const btnSpeedDown = document.getElementById('btn-speed-down');
const btnSpeedUp = document.getElementById('btn-speed-up');
const btnQuickSpeeds = document.querySelectorAll('.btn-quick-speed');
let currentTargetSpeed = 5.0;

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
let runState = 'idle'; // 'idle', 'recording', 'paused'
let lastMachineDistance = null;
let lastMachineCalories = null;

let currentRun = {
    durationSeconds: 0,
    distance: 0, // meters
    speeds: [],
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
    if (runState !== 'idle') {
        stopRun();
    }
}

function updateConnectionStatus(connected) {
    if (connected) {
        statusDot.classList.replace('bg-red-500', 'bg-green-500');
        statusText.textContent = 'Connected: ' + (bluetoothDevice?.name || 'Treadmill');
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
        btnSimulate.classList.remove('hidden');
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

// --- Simulator ---

let simulationInterval = null;
let simDistance = 0;
let simTime = 0;

function toggleSimulation() {
    if (simulationInterval) {
        // Stop Simulation
        clearInterval(simulationInterval);
        simulationInterval = null;
        btnSimulate.textContent = 'Simulate Machine';
        btnSimulate.classList.replace('bg-purple-800', 'bg-purple-500');
        onDisconnected(); // Re-use standard disconnect logic
    } else {
        // Start Simulation
        simDistance = 0;
        simTime = 0;
        btnSimulate.textContent = 'Stop Simulation';
        btnSimulate.classList.replace('bg-purple-500', 'bg-purple-800');
        
        // Mock connection status
        updateConnectionStatus(true);
        statusText.textContent = 'Connected: Simulator';
        btnConnect.classList.add('hidden');
        btnSimulate.classList.remove('hidden'); // Keep simulator button visible

        // Push fake data every second (simulating ~10 km/h)
        simulationInterval = setInterval(() => {
            simTime += 1;
            simDistance += 2.778; // 10 km/h in meters per second
            
            updateDashboard({
                speed: 10.0,
                totalDistance: Math.round(simDistance),
                elapsedTime: simTime,
                inclination: 1.5,
                heartRate: 145
            });
        }, 1000);
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

async function setMachineSpeed(speed) {
    if (speed !== undefined) {
         currentTargetSpeed = Math.max(1.0, Math.min(22.0, speed));
         displayTargetSpeed.textContent = currentTargetSpeed.toFixed(1);
    }
    
    // Resolution is 0.01 km/h. Example: 6.5 km/h -> 650.
    const speedInt = Math.round(currentTargetSpeed * 100);
    const lowByte = speedInt & 0xFF;
    const highByte = (speedInt >> 8) & 0xFF;
    
    await sendCommand([0x02, lowByte, highByte]);
    showCmdStatus(`Sent Speed: ${currentTargetSpeed.toFixed(1)} km/h`);
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

// --- Motivational Coach System ---
const motOverlay = document.getElementById('motivational-overlay');
const motText = document.getElementById('motivational-text');
const selectLang = document.getElementById('select-lang');

let currentLang = localStorage.getItem('coachLanguage') || 'en';
selectLang.value = currentLang;

selectLang.addEventListener('change', (e) => {
    currentLang = e.target.value;
    localStorage.setItem('coachLanguage', currentLang);
});

const phrases = {
    en: {
        speed_up: ["Time to fly!", "Punch it! Speed increasing!", "Turbo mode engaged!", "Feel the wind!"],
        speed_down: ["Easy tiger, slowing down...", "Recovery time!", "Breathe! Speed decreasing.", "Take it easy."],
        hill_up: ["Oh boy... Hill approaching!", "Get ready to climb!", "Gravity is just a theory!", "Push through the incline!"],
        hill_down: ["What goes up, must come down!", "Wheeeeee! Downhill!", "Free speed! Incline dropping."],
        start_3: "3...", start_2: "2...", start_1: "1...", start_go: "GO!",
        hr_warning: "Heart rate too high! Dropping speed."
    },
    es: {
        speed_up: ["¡A volar!", "¡Métele nitro!", "¡Modo turbo activado!", "¡Siente la brisa!"],
        speed_down: ["Tranquilo fiera, bajando velocidad...", "¡Recupera el aliento!", "¡Respira! Aflojando el paso.", "Tómatelo con calma."],
        hill_up: ["Ay mamá... ¡Se viene una cuesta!", "¡A escalar se ha dicho!", "¡La gravedad es un mito!", "¡Sube con fuerza!"],
        hill_down: ["¡Todo lo que sube, baja!", "¡Wiiii! ¡Cuesta abajo!", "¡Velocidad gratis! Disfruta la bajada."],
        start_3: "3...", start_2: "2...", start_1: "1...", start_go: "¡VAMOS!",
        hr_warning: "¡Pulsaciones al límite! Bajando velocidad."
    }
};

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playNotificationSound() {
    if (currentLang === 'none') return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
    osc.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.1); // Up to A6
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

let coachMessageTimeout = null;

function showMotivationalMessage(type) {
    if (currentLang === 'none') return;
    
    let msg = "";
    if (Array.isArray(phrases[currentLang][type])) {
        const arr = phrases[currentLang][type];
        msg = arr[Math.floor(Math.random() * arr.length)];
    } else {
        msg = phrases[currentLang][type];
    }
    
    if (!msg) return;

    motText.textContent = msg;
    motOverlay.classList.remove('opacity-0');
    
    // Force reflow to restart CSS transitions
    void motText.offsetWidth;
    motText.classList.remove('scale-50');
    motText.classList.add('scale-100');

    playNotificationSound();

    if (coachMessageTimeout) clearTimeout(coachMessageTimeout);
    
    // Hide after 3 seconds unless it's a short countdown tick
    const duration = type.startsWith('start_') && type !== 'start_go' ? 800 : 3000;
    
    coachMessageTimeout = setTimeout(() => {
        motOverlay.classList.add('opacity-0');
        motText.classList.remove('scale-100');
        motText.classList.add('scale-50');
    }, duration);
}

// --- Dashboard & Run State ---

let lastHrCmdTime = 0;
const HR_COOLDOWN_MS = 30000; // 30 seconds before reducing speed again

function updateDashboard(data) {
    if (data.speed !== undefined) {
        elSpeed.textContent = data.speed.toFixed(1);
        if (runState === 'recording') currentRun.speeds.push(data.speed);
    }

    if (data.inclination !== undefined) {
        elIncline.textContent = data.inclination.toFixed(1);
    }

    if (data.heartRate !== undefined) {
        elHr.textContent = data.heartRate;
        
        // --- Heart Rate Driven Pace (Zone 5 Protection) ---
        if (runState === 'recording') {
            const maxHrInput = document.getElementById('input-max-hr');
            const maxHr = maxHrInput ? (parseInt(maxHrInput.value) || 170) : 170;
            
            if (data.heartRate >= maxHr) {
                const now = Date.now();
                if (now - lastHrCmdTime > HR_COOLDOWN_MS) {
                    console.log(`HR Control: HR ${data.heartRate} exceeds max ${maxHr}. Reducing speed by 0.5 km/h.`);
                    showMotivationalMessage('hr_warning');
                    
                    // Reduce speed by 0.5 km/h, but never drop below 2.0 km/h
                    setMachineSpeed(Math.max(2.0, currentTargetSpeed - 0.5));
                    lastHrCmdTime = now;
                }
            }
        }
    }

    if (data.totalDistance !== undefined) {
        // Calculate the delta distance since the last machine payload
        let distanceDelta = 0;
        if (lastMachineDistance !== null && data.totalDistance >= lastMachineDistance) {
            distanceDelta = data.totalDistance - lastMachineDistance;
        }
        lastMachineDistance = data.totalDistance;

        // Only accumulate session distance if we are actively recording (not paused)
        if (runState === 'recording') {
            const previousDistance = currentRun.distance;
            currentRun.distance += distanceDelta;
            
            // Move avatar on map if we have a start point
            if (startCoordinates && currentRun.distance > previousDistance) {
                let newPos;
                
                if (loadedGpxRoute && loadedGpxRoute.length > 1) {
                    // Follow the GPX path!
                    let pt1 = loadedGpxRoute[0];
                    let pt2 = loadedGpxRoute[loadedGpxRoute.length - 1];
                    let currentIndex = 0;
                    
                    // Find the segment we are currently on
                    for (let i = 0; i < loadedGpxRoute.length - 1; i++) {
                        if (currentRun.distance >= loadedGpxRoute[i].cumulativeDistance && 
                            currentRun.distance <= loadedGpxRoute[i+1].cumulativeDistance) {
                            pt1 = loadedGpxRoute[i];
                            pt2 = loadedGpxRoute[i+1];
                            currentIndex = i;
                            break;
                        }
                    }
                    
                    if (currentRun.distance > pt2.cumulativeDistance) {
                         // We finished the GPX route!
                         newPos = [pt2.lng, pt2.lat];
                    } else {
                         // Interpolate position along the segment
                         const segmentLen = pt2.cumulativeDistance - pt1.cumulativeDistance;
                         if (segmentLen === 0) {
                             newPos = [pt1.lng, pt1.lat];
                         } else {
                             const t = (currentRun.distance - pt1.cumulativeDistance) / segmentLen;
                             const lat = pt1.lat + t * (pt2.lat - pt1.lat);
                             const lng = pt1.lng + t * (pt2.lng - pt1.lng);
                             newPos = [lng, lat];
                             
                             // --- MAGIC: Auto-Incline (Smoothed & Throttled) ---
                             const now = Date.now();
                             if (now - lastInclineCmdTime > INCLINE_COOLDOWN_MS) {
                                 const currentEle = getElevationAtDistance(currentRun.distance);
                                 const futureEle = getElevationAtDistance(currentRun.distance + LOOKAHEAD_METERS);
                                 
                                 // Calculate gradient over the lookahead window
                                 let gradientPct = ((futureEle - currentEle) / LOOKAHEAD_METERS) * 100;
                                 
                                 // Cap the gradient to physical treadmill limits (0% to 15%)
                                 gradientPct = Math.max(0, Math.min(15.0, gradientPct));
                                 
                                 // Round to nearest 0.5% (treadmills usually don't support finer resolution)
                                 const targetIncline = Math.round(gradientPct * 2) / 2; 
                                 const currentDisplayIncline = parseFloat(elIncline.textContent);
                                 
                             if (!isNaN(currentDisplayIncline) && Math.abs(currentDisplayIncline - targetIncline) >= 0.5) {
                                     // Update the UI Input and trigger the command if connected
                                     inputIncline.value = targetIncline.toFixed(1);
                                     if (controlCharacteristic) {
                                         setMachineIncline();
                                     }
                                     lastInclineCmdTime = now;
                                     console.log(`Auto-Incline Update: Smoothed target set to ${targetIncline}% (Raw Gradient: ${gradientPct.toFixed(2)}%)`);
                                 }
                             }
                             
                             // --- MAGIC: Auto-Speed from Training Profile (Throttled) ---
                             if (currentTrainingProfile && runState === 'recording') {
                                 if (now - lastSpeedCmdTime > SPEED_COOLDOWN_MS) {
                                     const suggestedSpeed = currentTrainingProfile[currentIndex];
                                     if (suggestedSpeed && Math.abs(suggestedSpeed - currentTargetSpeed) >= 0.5) {
                                         console.log(`Auto-Speed Update: Profile changing speed to ${suggestedSpeed} km/h`);
                                         setMachineSpeed(suggestedSpeed);
                                         lastSpeedCmdTime = now;
                                     }
                                 }
                             }
                             
                             // --- MAGIC: Lookahead Motivational Coach ---
                             if (runState === 'recording') {
                                 // Look 30 meters ahead to warn the user
                                 let aheadDist = currentRun.distance + 30;
                                 let aheadIndex = currentIndex;
                                 for (let i = currentIndex; i < loadedGpxRoute.length - 1; i++) {
                                     if (aheadDist >= loadedGpxRoute[i].cumulativeDistance && aheadDist <= loadedGpxRoute[i+1].cumulativeDistance) {
                                         aheadIndex = i;
                                         break;
                                     }
                                 }
                                 
                                 if (aheadIndex > currentIndex && (now - (window.lastMotMessageTime || 0) > 20000)) {
                                     // 1. Check for Speed Changes approaching
                                     if (currentTrainingProfile) {
                                         const futureSpeed = currentTrainingProfile[aheadIndex];
                                         const currentSpeed = currentTrainingProfile[currentIndex];
                                         if (futureSpeed - currentSpeed >= 1.0) {
                                             showMotivationalMessage('speed_up');
                                             window.lastMotMessageTime = now;
                                         } else if (currentSpeed - futureSpeed >= 1.0) {
                                             showMotivationalMessage('speed_down');
                                             window.lastMotMessageTime = now;
                                         }
                                     }
                                     
                                     // 2. Check for Hill Changes approaching (if we didn't just warn about speed)
                                     if (now - (window.lastMotMessageTime || 0) > 20000) {
                                         const currentEle = pt1.ele;
                                         const futureEle = loadedGpxRoute[aheadIndex].ele;
                                         const gradient = ((futureEle - currentEle) / 30) * 100;
                                         
                                         if (gradient >= 4.0) {
                                             showMotivationalMessage('hill_up');
                                             window.lastMotMessageTime = now;
                                         } else if (gradient <= -4.0) {
                                             showMotivationalMessage('hill_down');
                                             window.lastMotMessageTime = now;
                                         }
                                     }
                                 }
                                 
                                 // Trigger chart re-render to update the progress line
                                 if (profileChart && isProfileVisible) {
                                     profileChart.update('none'); // Update without full animation for performance
                                 }
                             }

                         }
                    }
                } else {
                    // No GPX loaded. Do not move the map avatar.
                    return;
                }
                
                // Update global variables for Three.js
                currentRunnerPosition = newPos;
                routeCoordinates.push(newPos);
                
                if (routeLineSource) {
                    routeLineSource.setData({
                        'type': 'Feature',
                        'properties': {},
                        'geometry': { 'type': 'LineString', 'coordinates': routeCoordinates }
                    });
                }
                
                // Keep the camera locked to the runner
                if (cameraMode === 1) {
                     map.easeTo({ center: newPos, duration: 1000, easing: (t) => t });
                } else if (cameraMode === 2) {
                     // Get the direction we are moving
                     let bearing = map.getBearing(); // Fallback to current bearing
                     
                     // If we have a GPX, we can calculate the exact bearing to the next point
                     if (loadedGpxRoute && loadedGpxRoute.length > 1) {
                         // Find the segment we are on again to look ahead
                         for (let i = 0; i < loadedGpxRoute.length - 1; i++) {
                             if (currentRun.distance >= loadedGpxRoute[i].cumulativeDistance && 
                                 currentRun.distance <= loadedGpxRoute[i+1].cumulativeDistance) {
                                 // Look at the NEXT point to get the true heading of the path
                                 let pt2 = loadedGpxRoute[i+1];
                                 bearing = calculateBearing(newPos[1], newPos[0], pt2.lat, pt2.lng);
                                 break;
                             }
                         }
                     }
                     
                     currentRunnerBearing = bearing; // Update for Three.js rotation

                     map.easeTo({
                         center: newPos,
                         bearing: bearing,
                         pitch: 80, 
                         zoom: 19, // Closer zoom for FP feel
                         duration: 1000, 
                         easing: (t) => t 
                     });
                } else {
                     map.easeTo({ center: newPos, duration: 1000, easing: (t) => t });
                }
                
                map.triggerRepaint(); // Force Three.js to render
            }
        }
        
        // Display distance for current session if recording/paused, else machine total
        const displayDist = (runState !== 'idle') ? currentRun.distance : data.totalDistance;
        elDistance.textContent = (displayDist / 1000).toFixed(2);
    }

    if (data.totalCalories !== undefined) {
        let caloriesDelta = 0;
        if (lastMachineCalories !== null && data.totalCalories >= lastMachineCalories) {
            caloriesDelta = data.totalCalories - lastMachineCalories;
        }
        lastMachineCalories = data.totalCalories;

        if (runState === 'recording') {
            currentRun.calories += caloriesDelta;
        }
    }

    // Time from machine
    if (data.elapsedTime !== undefined) {
        if (runState === 'idle') {
             elTime.textContent = formatDuration(data.elapsedTime);
        }
    }
}

// Local timer fallback for run recording
let timerInterval;
let lastTimerTick = 0;

function startRun() {
    if (!startCoordinates && !loadedGpxRoute) {
        if(!confirm("No route loaded. Run in Free Mode without moving the map avatar?")) return;
    }
    if (runState === 'countdown') return; // Prevent double click

    btnStartRun.classList.add('hidden');
    btnPauseRun.classList.remove('hidden');
    btnStopRun.classList.remove('hidden');
    runStatusText.textContent = "Starting...";
    runStatusText.classList.remove('hidden');
    runStatusText.classList.replace('text-green-400', 'text-yellow-400');
    
    runState = 'countdown';
    let count = 3;
    
    // First immediate tick
    showMotivationalMessage('start_' + count);
    count--;

    const countInterval = setInterval(() => {
        if (count > 0) {
            showMotivationalMessage('start_' + count);
            count--;
        } else {
            clearInterval(countInterval);
            showMotivationalMessage('start_go');
            
            // Actual run start logic
            runState = 'recording';
            runStatusText.textContent = "Recording";
            runStatusText.classList.replace('text-yellow-400', 'text-green-400');
            
            currentRun = {
                durationSeconds: 0,
                distance: 0,
                speeds: [],
                calories: 0
            };

            lastTimerTick = Date.now();
            timerInterval = setInterval(updateTimer, 1000);
            
            if (controlCharacteristic) {
                startMachine(); // Auto-send physical start to the treadmill
            }
        }
    }, 1000);
}

function pauseRun() {
    if (runState === 'recording') {
        runState = 'paused';
        btnPauseRun.innerHTML = '▶ Resume';
        btnPauseRun.classList.replace('bg-yellow-500', 'bg-green-500');
        btnPauseRun.classList.replace('hover:bg-yellow-400', 'hover:bg-green-400');
        runStatusText.textContent = "Paused";
        runStatusText.classList.replace('text-green-400', 'text-yellow-400');
    } else if (runState === 'paused') {
        runState = 'recording';
        btnPauseRun.innerHTML = '⏸ Pause';
        btnPauseRun.classList.replace('bg-green-500', 'bg-yellow-500');
        btnPauseRun.classList.replace('hover:bg-green-400', 'hover:bg-yellow-400');
        runStatusText.textContent = "Recording";
        runStatusText.classList.replace('text-yellow-400', 'text-green-400');
        lastTimerTick = Date.now(); // Reset tick to avoid jumping time
    }
}

function updateTimer() {
    if (runState === 'recording') {
        const now = Date.now();
        currentRun.durationSeconds += (now - lastTimerTick) / 1000;
        lastTimerTick = now;
        elTime.textContent = formatDuration(Math.floor(currentRun.durationSeconds));
    }
}

function stopRun() {
    if (!confirm('End and save this run?')) return;
    
    runState = 'idle';
    clearInterval(timerInterval);

    btnStartRun.classList.remove('hidden');
    btnPauseRun.classList.add('hidden');
    btnStopRun.classList.add('hidden');
    runStatusText.classList.add('hidden');
    
    // Reset Pause button to original state for next run
    btnPauseRun.innerHTML = '⏸ Pause';
    btnPauseRun.classList.replace('bg-green-500', 'bg-yellow-500');
    btnPauseRun.classList.replace('hover:bg-green-400', 'hover:bg-yellow-400');
    runStatusText.classList.replace('text-yellow-400', 'text-green-400');

    // Calculate metrics and save
    const avgSpeed = currentRun.speeds.length > 0 
        ? currentRun.speeds.reduce((a, b) => a + b, 0) / currentRun.speeds.length 
        : 0;

    const sessionData = {
        durationSeconds: Math.floor(currentRun.durationSeconds),
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
btnSimulate.addEventListener('click', toggleSimulation);
btnDisconnect.addEventListener('click', disconnectTreadmill);
btnStartRun.addEventListener('click', startRun);
btnPauseRun.addEventListener('click', pauseRun);
btnStopRun.addEventListener('click', stopRun);

btnMachineStart.addEventListener('click', startMachine);
btnMachinePause.addEventListener('click', pauseMachine);
btnMachineStop.addEventListener('click', stopMachine);
btnSpeedDown.addEventListener('click', () => setMachineSpeed(currentTargetSpeed - 0.1));
btnSpeedUp.addEventListener('click', () => setMachineSpeed(currentTargetSpeed + 0.1));
btnQuickSpeeds.forEach(btn => {
    btn.addEventListener('click', (e) => {
        setMachineSpeed(parseFloat(e.target.getAttribute('data-speed')));
    });
});
btnSetIncline.addEventListener('click', setMachineIncline);

// --- MapLibre Integration (Gamified Virtual Run) ---

let map;
let routeLineSource = null;
let routeCoordinates = [];
let startCoordinates = null; // [lng, lat]
let currentRunnerPosition = null; // [lng, lat]
let currentRunnerBearing = 0;

// --- Training Mode Variables ---
let currentTrainingProfile = null; // Array of speeds matching loadedGpxRoute
let profileChart = null;
let currentTrainingMode = 'endurance';
let currentBaseSpeed = 8.0;

let modalTargetSpeed = 8.0;
let modalChartInstance = null;
const displayModalSpeed = document.getElementById('modal-display-speed');

// A realistic satellite tile style for a videogame/flight-simulator feel
const satelliteStyle = {
    "version": 8,
    "sources": {
        "esri": {
            "type": "raster",
            "tiles": ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            "tileSize": 256,
            "attribution": "&copy; Esri, Maxar, Earthstar Geographics",
            "maxzoom": 19
        }
    },
    "layers": [{
        "id": "esri-satellite",
        "type": "raster",
        "source": "esri"
    }]
};

// --- No Custom Layer ---
// We removed Three.js in favor of pure immersive First Person camera and 3D Vector tiles.

function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: satelliteStyle,
        center: [-0.1276, 51.5072], // Default London
        zoom: 19,
        pitch: 80,
        bearing: 0,
        maxTileCacheSize: 500, // Increase RAM cache for tiles
        prefetchZoomDelta: 2 // Prefetch tiles at lower/higher zooms aggressively
    });

    map.on('load', () => {
        // Free 3D Terrain DEM source (Mapzen Terrarium format)
        map.addSource('terrain-source', {
            'type': 'raster-dem',
            'tiles': ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            'encoding': 'terrarium',
            'tileSize': 256,
            'maxzoom': 14
        });
        
        // Initial setup for First Person (default mode)
        map.setTerrain({ 'source': 'terrain-source', 'exaggeration': 2.5 });
        
        // Add OpenStreetMap vector tiles for 3D Buildings
        map.addSource('osm-buildings', {
            'type': 'vector',
            'tiles': ['https://basemaps.arcgis.com/arcgis/rest/services/OpenStreetMap_v2/VectorTileServer/tile/{z}/{y}/{x}.pbf'],
            'maxzoom': 15
        });

        map.addLayer({
            'id': '3d-buildings',
            'source': 'osm-buildings',
            'source-layer': 'Building', // Usually 'Building' or 'building' in ArcGIS OSM vector schema
            'type': 'fill-extrusion',
            'minzoom': 14,
            'paint': {
                'fill-extrusion-color': '#aaa',
                // Use an 'interpolate' expression to add a smooth transition effect to the buildings as the user zooms in
                'fill-extrusion-height': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    14,
                    0,
                    14.05,
                    ['get', 'height'] // Assuming the vector tile has a 'height' property
                ],
                'fill-extrusion-base': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    14,
                    0,
                    14.05,
                    ['get', 'min_height'] // Or 0 if not present
                ],
                'fill-extrusion-opacity': 0.8
            }
        });
        
        // Source and Layer for the planned GPX route
        map.addSource('planned-route', {
            'type': 'geojson',
            'data': { 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': [] } }
        });
        
        map.addLayer({
            'id': 'planned-route-line',
            'type': 'line',
            'source': 'planned-route',
            'layout': { 'line-join': 'round', 'line-cap': 'round' },
            'paint': { 'line-color': '#3B82F6', 'line-width': 4, 'line-opacity': 0.6 } // Tailwind blue-500
        });

        // Source and Layer for the trail behind the runner
        map.addSource('route', {
            'type': 'geojson',
            'data': {
                'type': 'Feature',
                'properties': {},
                'geometry': {
                    'type': 'LineString',
                    'coordinates': []
                }
            }
        });
        
        map.addLayer({
            'id': 'route',
            'type': 'line',
            'source': 'route',
            'layout': {
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#EF4444', // Tailwind red-500
                'line-width': 4
            }
        });
        
        routeLineSource = map.getSource('route');
    });

    // map.on('click') removed as requested
}

function setMapStartPoint(lng, lat) {
    startCoordinates = [lng, lat];
    routeCoordinates = [[lng, lat]];
    currentRunnerPosition = [lng, lat];
    
    if (routeLineSource) {
        routeLineSource.setData({
            'type': 'Feature',
            'properties': {},
            'geometry': { 'type': 'LineString', 'coordinates': routeCoordinates }
        });
    }

    // Orient camera to the start of the GPX if we are in First Person mode
    if (cameraMode === 2 && loadedGpxRoute && loadedGpxRoute.length > 1) {
        let pt2 = loadedGpxRoute[1]; // Look at the second point
        currentRunnerBearing = calculateBearing(lat, lng, pt2.lat, pt2.lng);
        map.jumpTo({ center: [lng, lat], bearing: currentRunnerBearing, zoom: 19, pitch: 80 });
    } else {
        map.jumpTo({ center: [lng, lat] });
    }
    
    if(map) map.triggerRepaint();
}

// Math to calculate a new Lat/Lng based on distance and bearing
function calculateDestinationLocation(lng, lat, distanceMeters, bearingDegrees) {
    const R = 6378137; // Earth's radius in meters
    const d = distanceMeters;
    
    const lat1 = lat * Math.PI / 180;
    const lng1 = lng * Math.PI / 180;
    const brng = bearingDegrees * Math.PI / 180;
    
    let lat2 = Math.asin(Math.sin(lat1) * Math.cos(d / R) + Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng));
    let lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1), Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2));
    
    lat2 = lat2 * 180 / Math.PI;
    lng2 = lng2 * 180 / Math.PI;
    
    return [lng2, lat2];
}

// --- GPX Parsing & Map Logic ---

let loadedGpxRoute = null; // Array of {lat, lng, ele, cumulativeDistance}
let cameraMode = 2; // 0: 2D, 1: 3D Bird's Eye, 2: First Person

// Unified GPX file loader
const gpxOverlay = document.getElementById('gpx-overlay');
const dropZone = document.getElementById('drop-zone');
const overlayInputGpx = document.getElementById('overlay-input-gpx');

function handleGpxFile(file) {
    if (!file || !file.name.endsWith('.gpx')) {
        alert("Please select a valid .gpx file.");
        return;
    }
    if (runState !== 'idle') {
        alert("Cannot load a new route while recording or paused.");
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const xmlString = e.target.result;
        parseGPX(xmlString);
        gpxOverlay.classList.add('opacity-0', 'pointer-events-none');
        document.getElementById('training-modal').classList.remove('hidden');
        // Small delay to allow display block to render before opacity transition
        setTimeout(() => {
            document.getElementById('training-modal').classList.remove('opacity-0');
        }, 10);
    };
    reader.readAsText(file);
}

// Event Listeners for File Selection
overlayInputGpx.addEventListener('change', (e) => handleGpxFile(e.target.files[0]));

document.querySelectorAll('.btn-preset-gpx').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        const url = e.target.getAttribute('data-url');
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");
            const xmlString = await response.text();
            parseGPX(xmlString);
            gpxOverlay.classList.add('opacity-0', 'pointer-events-none');
            document.getElementById('training-modal').classList.remove('hidden');
            setTimeout(() => {
                document.getElementById('training-modal').classList.remove('opacity-0');
            }, 10);
        } catch (error) {
            alert("Could not load preset route. Make sure the 'routes' folder exists on the server. Error: " + error.message);
        }
    });
});

// Drag and Drop Events
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('bg-white/10', 'border-white');
});
dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.classList.remove('bg-white/10', 'border-white');
});
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('bg-white/10', 'border-white');
    if (e.dataTransfer.files.length > 0) {
        handleGpxFile(e.dataTransfer.files[0]);
    }
});

document.getElementById('btn-toggle-camera').addEventListener('click', (e) => {
    cameraMode = (cameraMode + 1) % 3;
    const btn = e.target;
    
    if (cameraMode === 0) { // 2D Map
        map.setTerrain(null);
        map.easeTo({ pitch: 0, bearing: 0, zoom: 14, duration: 1000 });
        btn.textContent = '📷 2D Map';
        btn.classList.replace('bg-indigo-600', 'bg-gray-200');
        btn.classList.replace('text-white', 'text-gray-700');
    } else if (cameraMode === 1) { // 3D Bird's Eye
        map.setTerrain({ 'source': 'terrain-source', 'exaggeration': 2.5 });
        map.easeTo({ pitch: 60, zoom: 15, duration: 1000 });
        btn.textContent = '🚁 3D Bird\'s Eye';
        btn.classList.replace('bg-gray-200', 'bg-blue-600');
        btn.classList.replace('text-gray-700', 'text-white');
    } else if (cameraMode === 2) { // First Person
        map.setTerrain({ 'source': 'terrain-source', 'exaggeration': 2.5 });
        // The camera position will be updated dynamically in the animation loop, 
        // but we set a high zoom and extreme pitch here to start.
        map.easeTo({ pitch: 80, zoom: 18, duration: 1000 });
        btn.textContent = '🎮 First Person';
        btn.classList.replace('bg-blue-600', 'bg-indigo-600');
    }
});

document.getElementById('btn-open-gpx-overlay').addEventListener('click', () => {
    if (runState !== 'idle') {
        alert("Cannot load a new route while recording or paused. Please Stop the run first.");
        return;
    }
    gpxOverlay.classList.remove('opacity-0', 'pointer-events-none');
});

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function calculateBearing(lat1, lng1, lat2, lng2) {
    const toRad = (degree) => degree * Math.PI / 180;
    const toDeg = (rad) => rad * 180 / Math.PI;

    const dLng = toRad(lng2 - lng1);
    const rLat1 = toRad(lat1);
    const rLat2 = toRad(lat2);

    const y = Math.sin(dLng) * Math.cos(rLat2);
    const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng);
    
    let bearing = toDeg(Math.atan2(y, x));
    return (bearing + 360) % 360;
}

function applyKalmanFilter(route) {
    if (!route || route.length === 0) return;
    const R = 32; // Measurement noise (higher = smoother, ignores micro hills)
    const Q = 1;  // Process noise (how fast it adapts to real changes)
    
    let cov = NaN;
    let x = NaN; // Estimated elevation
    
    for (let i = 0; i < route.length; i++) {
        const z = route[i].ele;
        if (isNaN(x)) {
            x = z;
            cov = 1;
        } else {
            // Prediction
            const predX = x;
            const predCov = cov + Q;
            
            // Kalman Gain
            const K = predCov / (predCov + R);
            
            // Update
            x = predX + K * (z - predX);
            cov = (1 - K) * predCov;
        }
        route[i].ele = x; // Overwrite raw data with smoothed data
    }
}

function parseGPX(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const trackPoints = Array.from(xmlDoc.getElementsByTagName("trkpt"));
    
    if (trackPoints.length === 0) {
        alert("No valid track points found in GPX.");
        return;
    }

    let cumulativeDistance = 0;
    loadedGpxRoute = [];
    const geoJsonCoords = [];

    for (let i = 0; i < trackPoints.length; i++) {
        const pt = trackPoints[i];
        const lat = parseFloat(pt.getAttribute("lat"));
        const lng = parseFloat(pt.getAttribute("lon"));
        const eleNode = pt.getElementsByTagName("ele")[0];
        const ele = eleNode ? parseFloat(eleNode.textContent) : 0;
        
        if (i > 0) {
            const prev = loadedGpxRoute[i - 1];
            cumulativeDistance += haversineDistanceMeters(prev.lat, prev.lng, lat, lng);
        }
        
        loadedGpxRoute.push({ lat, lng, ele, cumulativeDistance });
        geoJsonCoords.push([lng, lat]);
    }

    // Apply Kalman Filter to remove micro-hills
    applyKalmanFilter(loadedGpxRoute);

    // Draw the planned route
    map.getSource('planned-route').setData({
        'type': 'Feature',
        'properties': {},
        'geometry': { 'type': 'LineString', 'coordinates': geoJsonCoords }
    });

    // Auto-set start point to the beginning of the GPX
    const startPt = loadedGpxRoute[0];
    setMapStartPoint(startPt.lng, startPt.lat);
    
    // Reset Run Progress
    if (runState === 'idle') {
        currentRun = { durationSeconds: 0, distance: 0, speeds: [], calories: 0 };
        elDistance.textContent = "0.00";
        elTime.textContent = "00:00";
    }

    // Fit map bounds to the route
    const bounds = geoJsonCoords.reduce(function(bounds, coord) {
        return bounds.extend(coord);
    }, new maplibregl.LngLatBounds(geoJsonCoords[0], geoJsonCoords[0]));
    
    map.fitBounds(bounds, { padding: 40 });
    
    // Update live preview in modal as soon as file loads
    updatePreviewChart();
}

// --- Chart & Training Logic ---

const hudChartPanel = document.getElementById('hud-chart-panel');
let isProfileVisible = false;

// We need a plugin to draw the vertical progress line on the chart
const verticalLinePlugin = {
    id: 'verticalLinePlugin',
    afterDraw: (chart) => {
        if (runState === 'idle' || !currentRun || currentRun.distance === 0 || !loadedGpxRoute) return;

        const ctx = chart.ctx;
        const xAxis = chart.scales.x;
        const yAxis1 = chart.scales.yElevation;
        const yAxis2 = chart.scales.ySpeed;
        
        // Find the X pixel coordinate based on the current distance
        const currentDistKm = currentRun.distance / 1000;
        const totalDistKm = loadedGpxRoute[loadedGpxRoute.length - 1].cumulativeDistance / 1000;
        
        // Prevent drawing outside bounds
        if (currentDistKm > totalDistKm) return;
        
        // Map the distance to the pixel X coordinate on the chart
        const xPos = xAxis.left + (xAxis.right - xAxis.left) * (currentDistKm / totalDistKm);
        
        const topY = Math.min(yAxis1.top, yAxis2.top);
        const bottomY = Math.max(yAxis1.bottom, yAxis2.bottom);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(xPos, topY);
        ctx.lineTo(xPos, bottomY);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#EF4444'; // Tailwind Red-500
        ctx.stroke();
        
        // Draw a glowing dot on the line
        ctx.beginPath();
        ctx.arc(xPos, topY + 10, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#EF4444';
        ctx.fill();
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#EF4444';
        ctx.fill();

        ctx.restore();
    }
};

Chart.register(verticalLinePlugin);

document.getElementById('btn-toggle-profile').addEventListener('click', () => {
    isProfileVisible = !isProfileVisible;
    if (isProfileVisible) {
        hudChartPanel.classList.remove('-translate-y-[150%]', 'opacity-0');
    } else {
        hudChartPanel.classList.add('-translate-y-[150%]', 'opacity-0');
    }
});

document.getElementById('btn-change-mode').addEventListener('click', () => {
    document.getElementById('training-modal').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('training-modal').classList.remove('opacity-0');
        updatePreviewChart();
    }, 10);
});

// Modal Speed Controls (iPad friendly)
document.getElementById('btn-modal-speed-down').addEventListener('click', () => {
    modalTargetSpeed = Math.max(3.0, modalTargetSpeed - 0.5);
    displayModalSpeed.textContent = modalTargetSpeed.toFixed(1);
    updatePreviewChart();
});

document.getElementById('btn-modal-speed-up').addEventListener('click', () => {
    modalTargetSpeed = Math.min(20.0, modalTargetSpeed + 0.5);
    displayModalSpeed.textContent = modalTargetSpeed.toFixed(1);
    updatePreviewChart();
});

document.querySelectorAll('input[name="training-mode"]').forEach(radio => {
    radio.addEventListener('change', updatePreviewChart);
});

function updatePreviewChart() {
    if (!loadedGpxRoute || typeof TrainingAlgorithms === 'undefined') return;

    const mode = document.querySelector('input[name="training-mode"]:checked').value;
    const profile = TrainingAlgorithms[mode](loadedGpxRoute, modalTargetSpeed);
    const distances = loadedGpxRoute.map(pt => (pt.cumulativeDistance / 1000).toFixed(2));
    const elevations = loadedGpxRoute.map(pt => pt.ele);

    const ctx = document.getElementById('modalProfileChart').getContext('2d');
    
    if (modalChartInstance) {
        modalChartInstance.destroy();
    }

    modalChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: distances,
            datasets: [
                {
                    label: 'Elevation', data: elevations,
                    borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    yAxisID: 'yElevation', fill: true, tension: 0.4, pointRadius: 0
                },
                {
                    label: 'Suggested Speed', data: profile,
                    type: 'bar', backgroundColor: 'rgba(16, 185, 129, 0.6)',
                    yAxisID: 'ySpeed', barPercentage: 1.0, categoryPercentage: 1.0
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                yElevation: { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9CA3AF' } },
                ySpeed: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#34D399' }, suggestedMin: 0 }
            }
        }
    });
}

document.getElementById('btn-apply-training').addEventListener('click', () => {
    currentBaseSpeed = modalTargetSpeed;
    currentTrainingMode = document.querySelector('input[name="training-mode"]:checked').value;
    
    // Hide modal
    document.getElementById('training-modal').classList.add('opacity-0');
    setTimeout(() => document.getElementById('training-modal').classList.add('hidden'), 500);

    if (typeof TrainingAlgorithms !== 'undefined') {
        currentTrainingProfile = TrainingAlgorithms[currentTrainingMode](loadedGpxRoute, currentBaseSpeed);
    }

    renderProfileChart();
    
    // Auto-show chart panel
    if (!isProfileVisible) {
        document.getElementById('btn-toggle-profile').click();
    }
});

function renderProfileChart() {
    if (!loadedGpxRoute || !currentTrainingProfile) return;

    const ctx = document.getElementById('profileChart').getContext('2d');
    
    const distances = loadedGpxRoute.map(pt => (pt.cumulativeDistance / 1000).toFixed(2));
    const elevations = loadedGpxRoute.map(pt => pt.ele);

    if (profileChart) {
        profileChart.destroy();
    }

    profileChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: distances,
            datasets: [
                {
                    label: 'Elevation (m)',
                    data: elevations,
                    borderColor: '#3B82F6', // Blue
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    yAxisID: 'yElevation',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                },
                {
                    label: 'Suggested Speed (km/h)',
                    data: currentTrainingProfile,
                    type: 'bar',
                    backgroundColor: 'rgba(16, 185, 129, 0.5)', // Green
                    yAxisID: 'ySpeed',
                    barPercentage: 1.0,
                    categoryPercentage: 1.0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                yElevation: { 
                    type: 'linear', display: true, position: 'left',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#9CA3AF' }
                },
                ySpeed: { 
                    type: 'linear', display: true, position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#34D399' }
                }
            }
        }
    });
}

// --- HUD & UI Animations ---

const hudTop = document.getElementById('hud-top');
const hudBottom = document.getElementById('hud-bottom');
const hudSide = document.getElementById('hud-side');
const hudHistory = document.getElementById('hud-history');
const hudSpeed = document.getElementById('hud-speed');
const btnShowHud = document.getElementById('btn-show-hud');

let isHudVisible = true;
let isSettingsVisible = false;
let isHistoryVisible = false;

document.getElementById('btn-toggle-hud').addEventListener('click', () => {
    isHudVisible = false;
    hudTop.classList.add('-translate-y-[150%]', 'opacity-0');
    hudBottom.classList.add('translate-y-[150%]', 'opacity-0');
    hudSide.classList.add('translate-x-[150%]'); // Hide settings
    hudHistory.classList.add('-translate-x-[150%]'); // Hide history
    hudSpeed.classList.add('translate-x-[150%]'); // Hide speed column
    hudChartPanel.classList.add('-translate-y-[150%]', 'opacity-0'); // Fix hiding chart panel
    
    isSettingsVisible = false;
    isHistoryVisible = false;
    
    // Request fullscreen for full immersion
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.warn(`Could not enable fullscreen: ${err.message}`);
        });
    }
    
    // Show the minimal return button
    btnShowHud.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
});

btnShowHud.addEventListener('click', () => {
    isHudVisible = true;
    hudTop.classList.remove('-translate-y-[150%]', 'opacity-0');
    hudBottom.classList.remove('translate-y-[150%]', 'opacity-0');
    hudSpeed.classList.remove('translate-x-[150%]'); // Restore speed column
    
    if (isProfileVisible) {
        hudChartPanel.classList.remove('-translate-y-[150%]', 'opacity-0');
    }
    
    // Exit fullscreen
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(err => console.warn(err));
    }
    
    // Hide the minimal return button
    btnShowHud.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10');
});

document.getElementById('btn-toggle-settings').addEventListener('click', () => {
    isSettingsVisible = !isSettingsVisible;
    if (isSettingsVisible) {
        hudSide.classList.remove('translate-x-[150%]', 'translate-x-full');
        hudSide.classList.add('translate-x-0');
        // Auto-hide history if it's open to prevent clutter
        if (isHistoryVisible) {
            isHistoryVisible = false;
            hudHistory.classList.remove('translate-x-0');
            hudHistory.classList.add('-translate-x-[150%]');
        }
    } else {
        hudSide.classList.remove('translate-x-0');
        hudSide.classList.add('translate-x-[150%]');
    }
});

document.getElementById('btn-toggle-history').addEventListener('click', () => {
    isHistoryVisible = !isHistoryVisible;
    if (isHistoryVisible) {
        hudHistory.classList.remove('-translate-x-[150%]', '-translate-x-full');
        hudHistory.classList.add('translate-x-0');
        // Auto-hide settings if it's open
        if (isSettingsVisible) {
            isSettingsVisible = false;
            hudSide.classList.remove('translate-x-0');
            hudSide.classList.add('translate-x-[150%]');
        }
    } else {
        hudHistory.classList.remove('translate-x-0');
        hudHistory.classList.add('-translate-x-[150%]');
    }
});

// --- Smoothed Elevation Helper ---
let lastInclineCmdTime = 0;
const INCLINE_COOLDOWN_MS = 60000; // Safe minimum: 60 seconds between Bluetooth commands to protect incline motor
const LOOKAHEAD_METERS = 150; // Calculate average gradient over the next 150 meters (approx 1 minute of running)

let lastSpeedCmdTime = 0;
const SPEED_COOLDOWN_MS = 60000; // Safe minimum: 60 seconds between Bluetooth commands to protect speed motor

function getElevationAtDistance(targetDist) {
    if (!loadedGpxRoute || loadedGpxRoute.length === 0) return 0;
    if (targetDist <= 0) return loadedGpxRoute[0].ele;
    
    let lastPt = loadedGpxRoute[loadedGpxRoute.length - 1];
    if (targetDist >= lastPt.cumulativeDistance) return lastPt.ele;
    
    for (let i = 0; i < loadedGpxRoute.length - 1; i++) {
        if (targetDist >= loadedGpxRoute[i].cumulativeDistance && targetDist <= loadedGpxRoute[i+1].cumulativeDistance) {
            let pt1 = loadedGpxRoute[i];
            let pt2 = loadedGpxRoute[i+1];
            let segmentLen = pt2.cumulativeDistance - pt1.cumulativeDistance;
            if (segmentLen === 0) return pt1.ele;
            
            let t = (targetDist - pt1.cumulativeDistance) / segmentLen;
            return pt1.ele + t * (pt2.ele - pt1.ele);
        }
    }
    return 0;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initMap);
