/**
 * Training Algorithms for Gamified Running
 * 
 * Each algorithm receives the parsed GPX route array and a user-defined base speed.
 * It returns an array of floating point speeds mapped 1:1 to the GPX points.
 */

const TrainingAlgorithms = {
    
    // Constant pace with 10% warm-up and 10% cool-down based on total distance
    endurance: function(gpxRoute, baseSpeed) {
        if (!gpxRoute || gpxRoute.length === 0) return [];
        const totalDistance = gpxRoute[gpxRoute.length - 1].cumulativeDistance;
        
        return gpxRoute.map(pt => {
            const progress = pt.cumulativeDistance / totalDistance;
            let target = baseSpeed;
            
            if (progress < 0.10) {
                // Warmup phase (flat)
                target = baseSpeed - 2.0;
            } else if (progress > 0.90) {
                // Cooldown phase (flat)
                target = baseSpeed - 2.5;
            }
            
            return Math.max(1.0, Math.round(target * 10) / 10);
        });
    },

    // Adjusts speed based on elevation changes. Slows down on hills, speeds up on flats, recovers after hills.
    dynamic: function(gpxRoute, baseSpeed) {
        if (!gpxRoute || gpxRoute.length === 0) return [];
        
        let profile = [];
        let isRecovering = false;
        let recoveryEndDistance = 0;

        for (let i = 0; i < gpxRoute.length; i++) {
            const pt = gpxRoute[i];
            
            // Calculate look-ahead gradient (150m ahead to match main loop smoothing)
            let gradient = 0;
            const lookAheadMeters = 150;
            let targetEle = pt.ele;
            
            for(let j = i+1; j < gpxRoute.length; j++) {
                if (gpxRoute[j].cumulativeDistance - pt.cumulativeDistance >= lookAheadMeters) {
                    targetEle = gpxRoute[j].ele;
                    break;
                }
            }
            
            gradient = ((targetEle - pt.ele) / lookAheadMeters) * 100;
            let target = baseSpeed;

            // Stop recovery if we reached the distance
            if (isRecovering && pt.cumulativeDistance >= recoveryEndDistance) {
                isRecovering = false;
            }

            if (gradient > 4.0) {
                // Hard Hill: Slow down significantly
                target = baseSpeed - 2.0;
                // Trigger recovery for 300m after this hill ends
                isRecovering = true;
                recoveryEndDistance = pt.cumulativeDistance + lookAheadMeters + 300;
            } else if (gradient > 1.5) {
                // Slight Hill
                target = baseSpeed - 1.0;
            } else if (gradient < -2.0) {
                // Downhill
                target = baseSpeed + 1.0;
            } else if (isRecovering) {
                // Flat but recovering from a recent hard hill
                target = baseSpeed - 1.5;
            } else {
                // Normal Flat
                target = baseSpeed;
            }

            profile.push(Math.max(1.0, Math.round(target * 10) / 10));
        }
        
        // Final smoothing pass: Ensure speed doesn't change more often than every 150 meters
        let blockyProfile = [];
        let currentBlockSpeed = profile[0];
        let lastChangeDist = 0;
        
        for (let i = 0; i < gpxRoute.length; i++) {
            const pt = gpxRoute[i];
            if (pt.cumulativeDistance - lastChangeDist >= 150) {
                if (profile[i] !== currentBlockSpeed) {
                    currentBlockSpeed = profile[i];
                    lastChangeDist = pt.cumulativeDistance;
                }
            }
            blockyProfile.push(currentBlockSpeed);
        }

        return blockyProfile;
    },

    // Interval training. Ignores elevation. 1km Fast, 500m slow.
    intervals: function(gpxRoute, baseSpeed) {
        if (!gpxRoute || gpxRoute.length === 0) return [];
        
        return gpxRoute.map(pt => {
            // cycle is 1500m (1000m fast, 500m slow)
            const cyclePos = pt.cumulativeDistance % 1500;
            let target;
            if (cyclePos < 1000) {
                // Fast phase (+1.5 km/h)
                target = baseSpeed + 1.5;
            } else {
                // Recovery phase (-2.0 km/h)
                target = baseSpeed - 2.0;
            }
            return Math.max(1.0, Math.round(target * 10) / 10);
        });
    }
};