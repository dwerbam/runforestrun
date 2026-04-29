# RunTracker Future Enhancements (Todo)

## 1. Map & 3D Upgrades
- [ ] **Three.js Integration (Avatar):** Replace the native GeoJSON red dot with an actual animated 3D runner or bicycle using `Three.js` Custom Layer (`GLTFLoader`).
- [ ] **Weather Effects:** Integrate a canvas-based particle system (rain/snow) that matches the real-world weather of the GPX location via a weather API.
- [ ] **Street-level POIs:** Fetch points of interest (monuments, viewpoints) from OpenStreetMap and pop up informational markers when the runner passes them.

## 2. Training Algorithms
- [ ] **User-Defined Intervals:** Allow users to build their own custom workout blocks in the UI (e.g., 2km at 10km/h, 500m at 14km/h) instead of relying solely on the GPX altimetry.
- [ ] **Heart Rate Driven Pace:** If the treadmill sends Heart Rate data (`0x2ACD`), dynamically lower the speed if the user's HR enters the red zone (Zone 5).
- [ ] **Elevation Smoothing refinement:** Use an advanced low-pass filter (e.g., Kalman filter) on the GPX elevation data array right after loading to completely eliminate micro-hills before passing it to the auto-incline logic.

## 3. Social & Gamification
- [ ] **Ghost Runners:** Load a secondary GPX of a previous run (or a friend's run) and display a "Ghost" avatar on the map to race against.
- [ ] **Strava Integration:** Add an OAuth login to automatically fetch the user's latest routes or upload the finished session directly to Strava.
- [ ] **Achievements:** Reward badges (stored in LocalStorage) for hitting milestones (e.g., "100km total distance", "Alps Climb Survivor").

## 4. UI Polish
- [ ] **Audio Voiceovers:** Replace the WebAudio "beep" with the Web Speech API (`speechSynthesis`) so the coach literally *speaks* the motivational phrases in English or Spanish.
- [ ] **Interactive Profile Chart:** Allow the user to click anywhere on the `Chart.js` graph and instantly teleport the runner to that specific point on the map/GPX.