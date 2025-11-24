// Strips & Photo Points module for Drone Planner
// Exports:
// - calculateStrips(polygonGeoJSON, drone, options) -> { photoPoints, stripLines, summaryStats }
//
// This module uses Turf.js (global `turf`) for geospatial operations and assumes callers
// will handle rendering (Leaflet) and storage of leaflet layers. The return values are
// plain JS objects and arrays to make integration incremental and testable.

/**
 * Calculate flight strips and photo points for a polygon.
 *
 * Inputs:
 *  - polygonGeoJSON: GeoJSON Polygon (coordinates in [lng,lat] order) - this is the survey area.
 *  - drone: object with sensorWidth_px, sensorHeight_px, pixelSize_um, focalLength_mm (can be partial)
 *  - options: {
 *      height: flight height in meters (H),
 *      frontlap: fraction (0..1),
 *      sidelap: fraction (0..1),
 *      direction: flight direction degrees (0=north),
 *      minSegmentLength: minimal segment length in meters to place photos (default 1)
 *    }
 *
 * Returns:
 *  {
 *    photoPoints: [ { lat, lng, stripIndex, pointIndex } ],
 *    stripLines: [ { id, coordinates: [ [lng,lat], ... ] } ],
 *    summaryStats: { areaHa, numStrips, numPhotos, totalLengthKm, estTimeMin }
 *  }
 *
 * Note: this function is pure JS (no Leaflet). Callers should add layers to the map from the returned data.
 */
export function calculateStrips(polygonGeoJSON, drone = {}, options = {}) {
  if (!polygonGeoJSON || !polygonGeoJSON.type || polygonGeoJSON.type !== 'Polygon') {
    throw new Error('polygonGeoJSON must be a GeoJSON Polygon');
  }

  const sensorW_px = drone.sensorWidth_px || 0;
  const sensorH_px = drone.sensorHeight_px || 0;
  const pixelSize_m = (drone.pixelSize_um || 0) * 1e-6;
  const focal_m = (drone.focalLength_mm || 0) * 1e-3;

  const height = parseFloat(options.height) || 0;
  const frontlap = parseFloat(options.frontlap) || 0.7;
  const sidelap = parseFloat(options.sidelap) || 0.6;
  const dir = (parseFloat(options.direction) || 0) % 360;
  const minSegmentLength = options.minSegmentLength || 1;

  // Compute footprint sizes in meters
  const sensorW_m = sensorW_px * pixelSize_m;
  const sensorH_m = sensorH_px * pixelSize_m;
  if (!sensorW_m || !sensorH_m || !focal_m || !height) {
    throw new Error('Missing sensor/pixel/focal/height parameters');
  }
  const footprintX = height * sensorW_m / focal_m; // ground width
  const footprintY = height * sensorH_m / focal_m; // ground height

  const poly = turf.polygon(polygonGeoJSON.coordinates);
  const centroid = turf.centroid(poly);
  const rotatedPoly = turf.transformRotate(poly, -dir, { pivot: centroid });
  const bbox = turf.bbox(rotatedPoly); // [minX,minY,maxX,maxY]

  // Spacing
  const stripSpacing = footprintX * (1 - sidelap);
  const photoSpacing = footprintY * (1 - frontlap);

  // Prepare scanning line across bbox center
  const bboxCenter = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const leftPoint = turf.point([bbox[0], bboxCenter[1]]);
  const rightPoint = turf.point([bbox[2], bboxCenter[1]]);
  const totalWidth_km = turf.distance(leftPoint, rightPoint, { units: 'kilometers' });
  const totalWidth_m = totalWidth_km * 1000;

  // number of strips estimate
  let numStrips = Math.ceil((totalWidth_m + stripSpacing) / stripSpacing);
  if (numStrips < 1) numStrips = 1;

  // start point a bit left to include edge
  const startPoint = turf.destination(leftPoint, (-stripSpacing) / 1000, 90, { units: 'kilometers' });

  const photoPoints = [];
  const stripLines = [];
  let totalStripLengthKm = 0;
  let actualStripCount = 0;

  for (let i = 0; i < numStrips; i++) {
    const offset_m = i * stripSpacing;
    const offsetPoint = turf.destination(startPoint, offset_m / 1000, 90, { units: 'kilometers' });
    const top = turf.destination(offsetPoint, 20000 / 1000, 0, { units: 'kilometers' });
    const bottom = turf.destination(offsetPoint, 20000 / 1000, 180, { units: 'kilometers' });
    const line = turf.lineString([bottom.geometry.coordinates, top.geometry.coordinates]);

    const split = turf.lineSplit(line, rotatedPoly);
    let stripSegments = 0;

    split.features.forEach((seg) => {
      const segMid = turf.midpoint(turf.point(seg.geometry.coordinates[0]), turf.point(seg.geometry.coordinates[seg.geometry.coordinates.length - 1]));
      if (turf.booleanPointInPolygon(segMid, rotatedPoly)) {
        // rotate back to original orientation
        const segBack = turf.transformRotate(seg, dir, { pivot: centroid });
        const latlngs = segBack.geometry.coordinates.map((c) => [c[1], c[0]]); // [lat,lng]
        stripLines.push({
          id: `${i}-${stripLines.length}`,
          coordinates: segBack.geometry.coordinates // in [lng,lat] format for consumer
        });
        stripSegments++;

        const segLength_km = turf.length(seg, { units: 'kilometers' });
        const segLength_m = segLength_km * 1000;
        totalStripLengthKm += segLength_km;
        if (segLength_m < minSegmentLength) return;
        const stepCount = Math.floor(segLength_m / photoSpacing);
        let pointIndexInStrip = 0;
        for (let s = 0; s <= stepCount; s++) {
          const dist_km = (s * photoSpacing) / 1000;
          const ptOnSeg = turf.along(seg, dist_km, { units: 'kilometers' });
          const ptBack = turf.transformRotate(ptOnSeg, dir, { pivot: centroid });
          const coords = ptBack.geometry.coordinates; // [lng,lat]
          if (turf.booleanPointInPolygon(ptBack, poly)) {
            photoPoints.push({
              lat: coords[1],
              lng: coords[0],
              stripIndex: actualStripCount,
              pointIndex: pointIndexInStrip
            });
            pointIndexInStrip++;
          }
        }
      }
    });

    if (stripSegments > 0) actualStripCount++;
  }

  // summary
  const areaHa = turf.area(poly) / 10000;
  const estFlightTimeMin = (totalStripLengthKm / 0.6) * 60; // assuming 10 m/s = 0.6 km/min

  const summaryStats = {
    areaHa: parseFloat(areaHa.toFixed(2)),
    numStrips: actualStripCount,
    numPhotos: photoPoints.length,
    totalLengthKm: parseFloat(totalStripLengthKm.toFixed(2)),
    estTimeMin: Math.ceil(estFlightTimeMin)
  };

  return {
    photoPoints,
    stripLines, // coordinates in [lng,lat] arrays
    summaryStats
  };
}