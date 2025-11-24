// Elevation module for Drone Planner
// Exports:
// - fetchElevationsBatch(points): fetch elevations from Open Elevation API (returns array of elevations aligned to input points)
// - addElevationData(): collects points from global allPhotoPoints and layerStrips, fetches elevations and writes back elevation & absoluteAltitude
// This module deliberately reads some globals (allPhotoPoints, filteredPhotoPoints, layerStrips, heightInput)
// so it can be integrated incrementally into the app without a full refactor.
// TODO: in a future cleanup, pass dependencies explicitly instead of relying on globals.

export async function fetchElevationsBatch(points) {
  if (!points || points.length === 0) return [];

  // Defensive: ensure loading div is present; create if missing
  let loadingDiv = document.getElementById('loadingElevation');
  if (!loadingDiv) {
    loadingDiv = document.createElement('div');
    loadingDiv.id = 'loadingElevation';
    loadingDiv.style.display = 'block';
    loadingDiv.style.marginTop = '1rem';
    loadingDiv.style.fontWeight = 'bold';
    loadingDiv.textContent = 'Loading elevation data...';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.appendChild(loadingDiv);
    else document.body.appendChild(loadingDiv);
    console.warn('loadingElevation div was missing, created on-the-fly!');
  } else {
    loadingDiv.style.display = 'block';
  }

  const TIMEOUT_MS = 12000; // per-batch timeout (12s)
  const ENDPOINT = 'https://api.open-elevation.com/api/v1/lookup';

  const fetchJsonWithTimeout = async (url, options, timeoutMs) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(to);
    }
  };

  try {
    // Filter invalid points (must be numeric lat/lng)
    const validPoints = points.filter(
      (p) => typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng)
    );
    if (validPoints.length !== points.length) {
      console.warn('Some invalid points were filtered out:', points.length - validPoints.length);
    }

    const batchSize = 500; // conservative limit for Open Elevation
    const allElevations = [];
    const total = validPoints.length;

    for (let i = 0; i < total; i += batchSize) {
      const batch = validPoints.slice(i, i + batchSize);
      const locations = batch.map((p) => ({ latitude: p.lat, longitude: p.lng }));

      try {
        const data = await fetchJsonWithTimeout(
          ENDPOINT,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ locations })
          },
          TIMEOUT_MS
        );

        if (data && Array.isArray(data.results)) {
          allElevations.push(
            ...data.results.map((r) =>
              (typeof r.elevation === 'number' && !isNaN(r.elevation)) ? r.elevation : 0
            )
          );
        } else {
          console.error('Unexpected results from Open Elevation:', data);
          allElevations.push(...new Array(batch.length).fill(0));
        }
      } catch (err) {
        console.error('Batch elevation request failed, using zeros for this batch:', err);
        allElevations.push(...new Array(batch.length).fill(0));
      }

      if (loadingDiv) {
        const processed = Math.min(i + batchSize, total);
        const progress = Math.round((processed / total) * 100);
        loadingDiv.textContent = `Loading elevation data... ${processed}/${total} (${progress}%)`;
      }
    }

    if (loadingDiv) loadingDiv.style.display = 'none';

    // Align with original input order: if invalid points were filtered, insert zeros
    if (validPoints.length !== points.length) {
      let elevationIdx = 0;
      const elevations = points.map((pt) => {
        if (
          typeof pt.lat === 'number' && typeof pt.lng === 'number' &&
          !isNaN(pt.lat) && !isNaN(pt.lng)
        ) {
          return allElevations[elevationIdx++];
        } else {
          return 0;
        }
      });
      console.log('Final elevations array (aligned):', elevations);
      return elevations;
    } else {
      console.log('Final elevations array:', allElevations);
      return allElevations;
    }
  } catch (error) {
    console.error('Error fetching elevations:', error);
    if (loadingDiv) loadingDiv.style.display = 'none';
    // Fallback: zeros for each input point
    return new Array(points.length).fill(0);
  }
}

/**
 * Collects points from the global `allPhotoPoints` array and the `layerStrips` Leaflet layer group,
 * fetches elevations with fetchElevationsBatch and applies elevation / absoluteAltitude fields.
 *
 * Note: This function relies on these globals being present:
 *  - allPhotoPoints (Array)
 *  - filteredPhotoPoints (Array)
 *  - layerStrips (Leaflet LayerGroup)
 *  - heightInput (DOM element with .value)
 *
 * The function populates window.stripElevations for KML export.
 */
export async function addElevationData() {
  // Ensure expected globals exist
  if (typeof allPhotoPoints === 'undefined' || !Array.isArray(allPhotoPoints) || allPhotoPoints.length === 0) {
    console.warn('addElevationData: no photo points to process.');
    return;
  }

  // Collect points to fetch (photo points first, then strip vertices)
  const pointsToFetch = [];

  allPhotoPoints.forEach((pt, idx) => {
    pointsToFetch.push({ lat: pt.lat, lng: pt.lng, type: 'photo', index: idx });
  });

  if (typeof layerStrips !== 'undefined') {
    layerStrips.eachLayer((layer) => {
      if (layer instanceof L.Polyline) {
        const latlngs = layer.getLatLngs();
        latlngs.forEach((ll, idx) => {
          pointsToFetch.push({ lat: ll.lat, lng: ll.lng, type: 'strip', layerId: L.stamp(layer), index: idx });
        });
      }
    });
  }

  console.log('Points to fetch elevation for:', pointsToFetch);

  const elevations = await fetchElevationsBatch(pointsToFetch);
  console.log('Elevations returned:', elevations);

  // Apply elevations back to photo points
  const flightHeight = (typeof heightInput !== 'undefined') ? (parseFloat(heightInput.value) || 0) : 0;

  allPhotoPoints.forEach((pt, idx) => {
    const elevation = elevations[idx] || 0;
    pt.elevation = elevation;
    pt.absoluteAltitude = elevation + flightHeight;
    console.log(`Photo point ${idx}: elevation=${elevation}, flightHeight=${flightHeight}, absoluteAltitude=${pt.absoluteAltitude}`);
  });

  // Update filteredPhotoPoints if present
  if (typeof filteredPhotoPoints !== 'undefined' && Array.isArray(filteredPhotoPoints) && filteredPhotoPoints.length > 0) {
    filteredPhotoPoints.forEach((pt) => {
      const originalPoint = allPhotoPoints.find((p) => p.lat === pt.lat && p.lng === pt.lng);
      if (originalPoint) {
        pt.elevation = originalPoint.elevation;
        pt.absoluteAltitude = originalPoint.absoluteAltitude;
      }
    });
  }

  // Store strip elevations for KML export
  window.stripElevations = {};
  let elevationIndex = allPhotoPoints.length; // start after photos

  if (typeof layerStrips !== 'undefined') {
    layerStrips.eachLayer((layer) => {
      if (layer instanceof L.Polyline) {
        const layerId = L.stamp(layer);
        const latlngs = layer.getLatLngs();
        const stripPoints = latlngs.map((ll, idx) => {
          const elevation = elevations[elevationIndex + idx] || 0;
          return {
            lat: ll.lat,
            lng: ll.lng,
            elevation: elevation,
            absoluteAltitude: elevation + flightHeight
          };
        });
        window.stripElevations[layerId] = stripPoints;
        console.log(`Strip ${layerId} points with elevation:`, stripPoints);
        elevationIndex += latlngs.length;
      }
    });
  }
}