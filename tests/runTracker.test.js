// Simulated testing of distance mapping logic

// haversine function from app.js
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

// destination function from app.js
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

// linear interpolation function from app.js
function interpolateSegment(pt1, pt2, currentDistance) {
    const segmentLen = pt2.cumulativeDistance - pt1.cumulativeDistance;
    if (segmentLen === 0) return [pt1.lng, pt1.lat];
    
    const t = (currentDistance - pt1.cumulativeDistance) / segmentLen;
    const lat = pt1.lat + t * (pt2.lat - pt1.lat);
    const lng = pt1.lng + t * (pt2.lng - pt1.lng);
    return [lng, lat];
}

function runTests() {
    let passed = 0;
    let failed = 0;
    
    function assertEqual(actual, expected, msg, tolerance = 0.0001) {
        if (Math.abs(actual - expected) < tolerance) {
            console.log("✅ PASS:", msg);
            passed++;
        } else {
            console.error("❌ FAIL:", msg, `(Expected ${expected}, got ${actual})`);
            failed++;
        }
    }

    console.log("--- Running Distance & Map Coordinate Tests ---");

    // 1. Basic Haversine Test
    // Approx 1 degree of lat = 111.139 km
    const dist1 = haversineDistanceMeters(0, 0, 1, 0);
    assertEqual(dist1, 111194.9266, "Haversine Distance (1 deg Lat)", 100);

    // 2. Interpolation Logic Test
    // Create a fake route segment of exactly 100 meters going purely North
    const fakeSegment = [
        { lat: 0, lng: 0, cumulativeDistance: 0 },
        { lat: 0.000898, lng: 0, cumulativeDistance: 100 } // roughly 100m north
    ];
    
    const midPoint = interpolateSegment(fakeSegment[0], fakeSegment[1], 50); // 50 meters in
    assertEqual(midPoint[1], 0.000449, "Interpolation Lat should be exactly half");
    assertEqual(midPoint[0], 0, "Interpolation Lng should remain 0");

    // 3. Interpolation Edge Case (End of segment)
    const endPoint = interpolateSegment(fakeSegment[0], fakeSegment[1], 100);
    assertEqual(endPoint[1], 0.000898, "Interpolation should hit end perfectly");

    // 4. Checking the discrepancy between interpolation and physical earth curvature over short distances
    // Our app uses linear interpolation (y = mx + b) on Lat/Lng for speed. Let's see how much error that introduces over 10m.
    const realMidpointDist = haversineDistanceMeters(fakeSegment[0].lat, fakeSegment[0].lng, midPoint[1], midPoint[0]);
    assertEqual(realMidpointDist, 50, "Haversine distance to linear midpoint should be ~50m", 0.5);

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
}

runTests();