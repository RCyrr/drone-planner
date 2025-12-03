# Drone Planner

## Overview
Drone Planner is a browser-based application for creating and managing drone flight plans. It allows users to design flight patterns by drawing polygons on a map, calculate optimal flight strips with proper overlap, and export the results in several formats including KML with elevation information.

## Key Features
- Drone model selection with automatic parameter configuration
- Polygon drawing/import for defining flight areas
- Automatic flight strip calculation with configurable parameters
- Photo point generation with overlap configuration
- Elevation data integration from Open Elevation API
- EXIF+XMP READER tool for detailed metadata inspection of single JPG images (including GPS, altitude, attitude, camera and RTK/XMP tags)
- DISPLAY DRONE FLIGHT tool for folder-based JPG import and flight visualization (blue photo markers, skipped-image log, summary integration)
- Automatic calculation and drawing of a "flight area" polygon (yellow) from imported images; stored in runtime session for validation tools
- GCP VALIDATOR tool: preview CSV, validate GCP coordinates against the flight area polygon, and visualize validated GCPs on the map
- FOOTPRINTS HEATMAP tool: computes per-image ground footprints (rotated by yaw when available), aggregates overlap into a grid heatmap, and visualizes coverage intensity
- Export options (CSV, JSON, KML with elevation)
- Photo point filtering for streamlined missions
- Multilingual UI (English/German)

## Tech Stack
- HTML/CSS (single-file app)
- Vanilla JavaScript
- Leaflet.js for map rendering
- Turf.js for geospatial calculations
- Exifr for EXIF/XMP reading
- shapefile.js for shapefile import

## File Layout
- [`index.html`](index.html:1) — main application single-file SPA
- [`README.md`](README.md:1) — this documentation
- shapefile and sample data files in repo root

## How it works
1. Select or configure a drone (focal length, pixel size, sensor size).
2. Draw a polygon on the map or import a shapefile defining the survey area.
3. Configure flight parameters: direction, GSD or height, overlaps.
4. Click "Calculate Flight Strips" to generate strips and photo points.
5. The app fetches terrain elevation data and computes absolute altitudes.
6. Export results (CSV, JSON, KML). KML includes altitude and altitudeMode to show 3D in Google Earth.

## Tools

### EXIF+XMP READER

A dedicated tool for inspecting the metadata of a **single JPG image**:

- Opens via the top **Tools** dropdown in the UI.
- Uses `exifr` with `xmp: true` plus a custom XMP extractor to read:
  - GPS coordinates (lat/lon)
  - Absolute and relative altitude (DJI XMP tags where available)
  - Flight attitude (yaw/roll/pitch) and gimbal angles
  - GNSS / RTK quality information
  - Camera and exposure parameters (make, model, ISO, shutter, f-number)
- Renders a compact summary plus an optional expandable section that lists **all parsed XMP tags** in a table.
- Intended primarily for debugging and understanding how a specific image was captured.

### DISPLAY DRONE FLIGHT
 
A separate tool for visualizing a **complete drone flight** from a folder of JPGs:
 
- Opens via the top **Tools** dropdown as "DISPLAY DRONE FLIGHT".
- Accepts a folder or multi-selection of JPG/JPEG images and:
  - Filters to top-level JPG/JPEG files (subfolders are ignored).
  - Processes images in batches with limited concurrency to keep the UI responsive.
  - Uses the same EXIF+XMP pipeline as the EXIF+XMP READER to obtain GPS and altitude.
  - Creates blue `Leaflet` markers for every image that has valid GPS coordinates.
- Integrates with the existing app state:
  - Updates the global photo-point list and the summary panel (`numPhotos`, etc.).
  - Shows a **skipped images** list with reasons (e.g., "no-gps" or parse errors).
  - Fits the map view to the footprint of all successfully imported images.
- Designed to handle flights with up to approximately 1000 images smoothly in modern browsers when hosted as static files (e.g., GitHub Pages), thanks to:
  - Bounded concurrency
  - Batched parsing with brief yields between batches
  - A configurable hard cap on the maximum number of imported images

- When images are imported, the app automatically computes a "flight area" polygon from the image extents and stores it in memory at [`window.__DRONE_SESSION['flight area']`](index.html:1651). The polygon is drawn in a distinct yellow layer (`layerFlightArea`) so it can be visually separated from photo points and strips.

### GCP VALIDATOR
 
A tool for importing and validating ground control points (GCPs) in CSV format:
 
- Opens via the top **Tools** dropdown as "GCP VALIDATOR".
- Workflow:
  1. Select a `.csv` file using the file picker (expected header: `pointID,latitude,longitude,elevation,description` — case-insensitive).
  2. The tool shows a live preview table of the CSV (all rows) in the right-side panel with vertical and horizontal scrollbars so the panel size does not change.
  3. Optionally toggle "Swap latitude/longitude" to flip coordinates for all rows before validation.
  4. Click "Validate GCP" to run validation.
- Validation:
  - Uses the runtime-calculated "flight area" polygon (created by DISPLAY DRONE FLIGHT or by drawing a polygon manually) to test whether each GCP falls inside the survey boundary.
  - Uses Turf.js (client-side) boolean point-in-polygon checks.
  - Reports counts: valid points, points outside the flight area, and rows with invalid format.
- Visualization:
  - Valid GCPs are drawn on the map as purple triangle markers on the separate "GCPs" layer and can be toggled in the map layer control.
  - Invalid or outside points are not drawn by default but are listed in the validation results.
- Notes:
  - The flight-area polygon is stored in runtime memory at [`window.__DRONE_SESSION['flight area']`](index.html:1651) and is not persisted across page reloads.
  - All CSV parsing and spatial checks run entirely client-side and are compatible with static hosting (GitHub Pages).
  
### Sample GCP CSV

Example valid CSV file (header required: `pointID,latitude,longitude,elevation,description`):

```csv
pointID,latitude,longitude,elevation,description
GCP01,48.137148,11.576034,245.3,"Corner northeast"
GCP02,48.136540,11.574900,244.8,"Corner southeast"
GCP03,48.136900,11.575500,245.0,"Center point"
```

## FOOTPRINTS HEATMAP

A tool to visualize image coverage intensity by computing per-image ground footprints and aggregating overlaps into a grid-based heatmap:

- Opens via the top **Tools** dropdown as "FOOTPRINTS HEATMAP".
- What it does:
  - For each imported image (stored in [`window.__DRONE_SESSION['flight images']`](index.html:1651)), the tool computes a ground footprint assuming a pinhole camera model:
    - Uses image metadata: focal length (`focal_mm`), sensor size (derived from `pixelSize_um` and image pixel dimensions `imgW`, `imgH`).
    - Uses flight height: prefers relative altitude (`relAlt`) when available; otherwise computes height from absolute altitude (`absAlt`) minus ground elevation fetched from [`src/elevation.js`](src/elevation.js:1).
    - Rotates footprint corners by image yaw when yaw is available to align with flight direction.
  - If a required camera property is missing (for example `pixelSize_um`), the tool tries the following fallbacks in order:
    1. Use pixel size parsed from the image EXIF/XMP.
    2. Match camera model against the internal DRONE_DATABASE to use its known pixel size (automatic DB match).
    3. Use a user-provided "Default pixel size [µm]" value in the FOOTPRINTS panel.
    4. If none are available, the image is skipped and reported in the generation summary.
  - Builds a bounding box for all footprints, divides it into a grid (selectable resolution), and counts how many footprints cover each grid cell (center-based test).
  - Renders grid cells as semi-transparent Leaflet rectangles colored by coverage count (gradient red → yellow → green).
- Visualization and controls:
  - The FOOTPRINTS panel shows controls for grid resolution and default pixel size (µm), a "Generate" button and a "Clear" button.
  - The heatmap is added to a dedicated layer (`layerFootprints`) that can be toggled in the map layer control.
- Notes:
  - The current aggregation method tests the center point of each grid cell for inclusion in each image footprint polygon. A future option may add polygon intersection-area aggregation for more accurate coverage area weighting.
  - Polygons are created using Turf.js; each polygon ring is explicitly closed before creating the Turf polygon to avoid ring errors.
  - Per-image metadata used for footprints is stored in runtime memory at [`window.__DRONE_SESSION['flight images']`](index.html:1651).

## Elevation integration details
- Batch requests to Open Elevation API endpoint `https://api.open-elevation.com/api/v1/lookup` (POST JSON: { locations: [{latitude, longitude}, ...] }).
- Batches of up to 1000 points to respect API limits.
- Progress indicator shown during fetching (`#loadingElevation`).
- On success, terrain elevation is added to flight height to produce absolute altitude.
- On failure or timeout, the app falls back to zero elevation for affected points.

## KML export details
- Coordinates are written as `longitude,latitude,altitude`.
- Includes `<altitudeMode>absolute</altitudeMode>` to instruct Google Earth to use provided elevations.
- Uses `<extrude>1</extrude>` for strips to visualize vertical connection to the ground.

## Data structures
- Photo point object:
```javascript
{
  lat: Number,
  lng: Number,
  stripIndex: Number,
  pointIndex: Number,
  marker: L.CircleMarker,
  elevation: Number,         // terrain elevation (m)
  absoluteAltitude: Number   // terrain + flight height (m)
}
```
- Strip elevation storage:
```javascript
window.stripElevations = {
  <layerId>: [ {lat,lng,elevation,absoluteAltitude}, ... ],
  ...
}
```
- Runtime session storage:
```javascript
// Stored in memory while the page is open:
window.__DRONE_SESSION = {
  'flight area': GeoJSON Feature,        // polygon computed from image extents or manually drawn polygon
  'flight images': [ { filename, lat, lng, focal_mm, imgW, imgH, relAlt, absAlt, yaw, pixelSize_um, dbMatched }, ... ]
}
```

## Development guidelines
- Keep code documented with inline comments when adding features.
- Add translations to `TRANSLATIONS` for new UI text.
- Add unit tests for geometric calculations where possible (Turf-based outputs).
- Use console logging for long-running tasks that may require inspection.

## Troubleshooting
- If KML shows features clamped to ground in Google Earth: ensure `<altitudeMode>absolute</altitudeMode>` is present and KML is opened with 3D terrain enabled.
- If elevations are missing: check console logs for Open Elevation request/response, and check network (CORS) restrictions.
- If the loading indicator causes errors: ensure `#loadingElevation` exists in the DOM; the app creates it programmatically if missing.
- If you encounter Turf polygon ring errors ("First and last Position are not equivalent"): ensure your imported images include required camera metadata or provide a default pixel size in the FOOTPRINTS panel.

## Testing checklist
- [ ] Draw polygon and calculate strips
- [ ] Confirm `Points to fetch elevation for` appears in console
- [ ] Confirm elevations returned and `absoluteAltitude` set
- [ ] Export KML and open in Google Earth; verify photo points and strips at expected altitude
- [ ] Test KML with filters applied (filteredPhotoPoints)
- [ ] Import images using DISPLAY DRONE FLIGHT and verify `flight area` polygon and `flight images` session entries exist
- [ ] Use GCP VALIDATOR with `ground control points.csv` to validate GCPs against the flight area
- [ ] Use FOOTPRINTS HEATMAP Generate to render coverage heatmap and verify colors align with expected overlap

## Future improvements
- Split JS into modules for maintainability
- Add unit/integration tests
- Add caching of elevation tiles to reduce API calls
- Support additional elevation providers (Mapbox, Google Elevation) with selectable fallback
- Add offline mode and persistent project save/load

## Contributing
- Fork the repo, make changes, and submit a PR.
- Keep changes small and focused.
- Update README and add any required assets.

## License
MIT

## Contact
For questions or help, open an issue in the repo or contact the maintainer.
