// KML module for Drone Planner
// Provides functions to generate and download KML with absolute altitudes.
//
// Exports:
// - generateKml(pointsToExport, stripElevations, options) -> string
// - downloadKml(kml, filename)
// - exportKml(pointsToExport, stripElevations, filename, options)
//
// This module is written as an ES module so it can be imported with <script type="module">.
// It is intentionally dependency-free and accepts the data it needs as parameters.

/**
 * Generate a KML document containing flight strips (LineString) and photo points (Point).
 *
 * Coordinates are written as "longitude,latitude,altitude".
 * altitudeMode is set to "absolute" so Google Earth interprets the Z coordinate as meters above sea level.
 *
 * @param {Array<Object>} pointsToExport - Array of photo point objects with {lat, lng, absoluteAltitude, ...}.
 * @param {Object} stripElevations - Map of layerId -> array of {lat,lng,absoluteAltitude}.
 * @param {Object} options - Optional settings:
 *   - title: document title
 *   - description: document description
 * @returns {string} KML string
 */
export function generateKml(pointsToExport = [], stripElevations = {}, options = {}) {
  const title = options.title || 'Drone Flight Plan';
  const description = options.description || 'Flight strips and photo points';

  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escapeXml(title)}</name>
  <description>${escapeXml(description)}</description>

  <Style id="stripStyle">
    <LineStyle>
      <color>ff00ff00</color>
      <width>2</width>
    </LineStyle>
  </Style>

  <Style id="photoStyle">
    <IconStyle>
      <color>ff0000ff</color>
      <scale>0.5</scale>
      <Icon>
        <href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
      </Icon>
    </IconStyle>
  </Style>
`;

  // Add strips
  for (const layerId in stripElevations) {
    const stripPoints = stripElevations[layerId];
    if (!Array.isArray(stripPoints) || stripPoints.length === 0) continue;

    const coordsStr = stripPoints.map((p) => {
      const alt = (typeof p.absoluteAltitude === 'number' && !isNaN(p.absoluteAltitude)) ? p.absoluteAltitude.toFixed(2) : '0';
      return `${p.lng},${p.lat},${alt}`;
    }).join(' ');

    kml += `
  <Placemark>
    <name>Flight Strip</name>
    <styleUrl>#stripStyle</styleUrl>
    <LineString>
      <altitudeMode>absolute</altitudeMode>
      <extrude>1</extrude>
      <coordinates>${coordsStr}</coordinates>
    </LineString>
  </Placemark>
`;
  }

  // Add photo points
  pointsToExport.forEach((pt, idx) => {
    const alt = (typeof pt.absoluteAltitude === 'number' && !isNaN(pt.absoluteAltitude)) ? pt.absoluteAltitude.toFixed(2) : '0';
    kml += `
  <Placemark>
    <name>Photo ${idx + 1}</name>
    <styleUrl>#photoStyle</styleUrl>
    <Point>
      <altitudeMode>absolute</altitudeMode>
      <extrude>0</extrude>
      <coordinates>${pt.lng},${pt.lat},${alt}</coordinates>
    </Point>
  </Placemark>
`;
  });

  kml += `
</Document>
</kml>`;

  return kml;
}

/**
 * Trigger a download of the KML content as a file.
 * @param {string} kml - Full KML string
 * @param {string} filename - Suggested filename (default: drone-flight-plan.kml)
 */
export function downloadKml(kml, filename = 'drone-flight-plan.kml') {
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Convenience function to generate and download a KML file.
 * @param {Array<Object>} pointsToExport
 * @param {Object} stripElevations
 * @param {string} filename
 * @param {Object} options
 */
export function exportKml(pointsToExport = [], stripElevations = {}, filename = 'drone-flight-plan.kml', options = {}) {
  const kml = generateKml(pointsToExport, stripElevations, options);
  downloadKml(kml, filename);
}

/**
 * Simple XML escape for element content (not attributes).
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  if (str === undefined || str === null) return '';
  // For element content, escaping &, <, > is sufficient
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}