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
            const previousDistance = currentRun.distance;
            currentRun.distance = data.totalDistance - currentRun.distanceStartOffset;
            
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
                         }
                    }
                } else {
                    // Free Run (No GPX): travel in a large circle.
                    const distanceDelta = currentRun.distance - previousDistance;
                    const bearing = (currentRun.distance / 5) % 360;
                    const lastPos = routeCoordinates[routeCoordinates.length - 1];
                    newPos = calculateDestinationLocation(lastPos[0], lastPos[1], distanceDelta, bearing);
                }
                
                routeCoordinates.push(newPos);
                avatarMarker.setLngLat(newPos);
                
                if (routeLineSource) {
                    routeLineSource.setData({
                        'type': 'Feature',
                        'properties': {},
                        'geometry': { 'type': 'LineString', 'coordinates': routeCoordinates }
                    });
                }
                
                if (is3DEnabled) {
                     map.panTo(newPos);
                }
            }
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
btnSimulate.addEventListener('click', toggleSimulation);
btnDisconnect.addEventListener('click', disconnectTreadmill);
btnStartRun.addEventListener('click', startRun);
btnStopRun.addEventListener('click', stopRun);

btnMachineStart.addEventListener('click', startMachine);
btnMachinePause.addEventListener('click', pauseMachine);
btnMachineStop.addEventListener('click', stopMachine);
btnSetSpeed.addEventListener('click', setMachineSpeed);
btnSetIncline.addEventListener('click', setMachineIncline);

// --- MapLibre Integration (Gamified Virtual Run) ---

let map;
let avatarMarker;
let routeLineSource;
let routeCoordinates = [];
let startCoordinates = null; // [lng, lat]

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

function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: satelliteStyle,
        center: [-0.1276, 51.5072], // Default London
        zoom: 13
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

    // Click map to set start point
    map.on('click', (e) => {
        if (isRecording) {
            alert("Cannot change start point while recording.");
            return;
        }
        setMapStartPoint(e.lngLat.lng, e.lngLat.lat);
    });
}

document.getElementById('btn-map-locate').addEventListener('click', () => {
    if (isRecording) return;
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            setMapStartPoint(position.coords.longitude, position.coords.latitude);
            map.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 15 });
        }, (error) => {
            alert("Geolocation error: " + error.message);
        });
    } else {
        alert("Geolocation not supported by your browser.");
    }
});

function setMapStartPoint(lng, lat) {
    startCoordinates = [lng, lat];
    routeCoordinates = [[lng, lat]];
    
    if (avatarMarker) avatarMarker.remove();
    
    // Create a custom red dot for the avatar
    const el = document.createElement('div');
    el.className = 'w-4 h-4 bg-red-600 border-2 border-white rounded-full shadow-md';
    
    avatarMarker = new maplibregl.Marker(el)
        .setLngLat([lng, lat])
        .addTo(map);
        
    if (routeLineSource) {
        routeLineSource.setData({
            'type': 'Feature',
            'properties': {},
            'geometry': { 'type': 'LineString', 'coordinates': routeCoordinates }
        });
    }
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
let is3DEnabled = false;

document.getElementById('btn-toggle-3d').addEventListener('click', (e) => {
    is3DEnabled = !is3DEnabled;
    const btn = e.target;
    if (is3DEnabled) {
        map.setTerrain({ 'source': 'terrain-source', 'exaggeration': 1.5 });
        map.setPitch(60); // Tilt camera
        btn.classList.replace('bg-gray-200', 'bg-blue-600');
        btn.classList.replace('text-gray-700', 'text-white');
    } else {
        map.setTerrain(null);
        map.setPitch(0);
        btn.classList.replace('bg-blue-600', 'bg-gray-200');
        btn.classList.replace('text-white', 'text-gray-700');
    }
});

document.getElementById('input-gpx').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (isRecording) {
        alert("Cannot load a new route while recording.");
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const xmlString = e.target.result;
        parseGPX(xmlString);
    };
    reader.readAsText(file);
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

    // Draw the planned route
    map.getSource('planned-route').setData({
        'type': 'Feature',
        'properties': {},
        'geometry': { 'type': 'LineString', 'coordinates': geoJsonCoords }
    });

    // Auto-set start point to the beginning of the GPX
    const startPt = loadedGpxRoute[0];
    setMapStartPoint(startPt.lng, startPt.lat);
    
    // Fit map bounds to the route
    const bounds = geoJsonCoords.reduce(function(bounds, coord) {
        return bounds.extend(coord);
    }, new maplibregl.LngLatBounds(geoJsonCoords[0], geoJsonCoords[0]));
    
    map.fitBounds(bounds, { padding: 40 });
    
    alert(`Loaded GPX route! Total distance: ${(cumulativeDistance / 1000).toFixed(2)} km`);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initMap);

// --- Smoothed Elevation Helper ---
let lastInclineCmdTime = 0;
const INCLINE_COOLDOWN_MS = 15000; // Minimum 15 seconds between Bluetooth commands
const LOOKAHEAD_METERS = 40; // Calculate average gradient over the next 40 meters to smooth out noise

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
