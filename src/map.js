// Map & UI module for Drone Planner
// Exports:
// - initMap(): initializes the Leaflet map and returns an object with map, drawnItems, layerStrips, layerPhotos
// - bindUI(state): binds UI controls to the provided state and map objects (minimal bindings)
//
// This module assumes Leaflet and Leaflet.draw are loaded globally (via CDN) and Turf.js is available as `turf`.

/**
 * Initialize the Leaflet map and common layer groups.
 * @returns {Object} { map, drawnItems, layerStrips, layerPhotos }
 */
export function initMap() {
  const map = L.map('map').setView([48.137, 11.575], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  const drawnItems = new L.FeatureGroup().addTo(map);
  map.addLayer(drawnItems);
  const drawControl = new L.Control.Draw({
    draw: { polygon: { allowIntersection: false }, polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false },
    edit: { featureGroup: drawnItems }
  });
  map.addControl(drawControl);

  const layerStrips = L.layerGroup().addTo(map);
  const layerPhotos = L.layerGroup().addTo(map);
  const overlays = { "Streifen": layerStrips, "Fotopunkte": layerPhotos };
  L.control.layers({}, overlays, { collapsed: false }).addTo(map);

  return { map, drawnItems, layerStrips, layerPhotos, drawControl };
}

/**
 * Bind minimal UI to state. This does not replicate all inline app logic,
 * but demonstrates how to wire up events to state objects. The goal is incremental extraction.
 *
 * @param {Object} params
 *  - mapObjects: { map, drawnItems, layerStrips, layerPhotos, drawControl }
 *  - uiElements: object of DOM elements needed (calcBtn, exportKmlBtn, etc.)
 *  - callbacks: { onCalculate: fn, onExportKml: fn, onPolygonCreated: fn }
 */
export function bindUI({ mapObjects, uiElements, callbacks }) {
  const { map, drawnItems, drawControl } = mapObjects;
  const { calcBtn, exportKmlBtn } = uiElements;
  const { onCalculate, onExportKml, onPolygonCreated } = callbacks || {};

  // Hook draw button (external) - if present, trigger drawing
  const drawBtn = document.getElementById('drawPolygonBtn');
  if (drawBtn) drawBtn.onclick = () => { new L.Draw.Polygon(map, drawControl.options.draw.polygon).enable(); };

  // Clear polygon button
  const clearBtn = document.getElementById('clearPolygonBtn');
  if (clearBtn) clearBtn.onclick = () => { drawnItems.clearLayers(); if (callbacks.onClearPolygon) callbacks.onClearPolygon(); };

  map.on(L.Draw.Event.CREATED, function (e) {
    if (e.layer instanceof L.Polygon) {
      drawnItems.clearLayers();
      drawnItems.addLayer(e.layer);
      if (onPolygonCreated) onPolygonCreated(e.layer);
    }
  });

  if (calcBtn) {
    calcBtn.addEventListener('click', async () => {
      if (onCalculate) await onCalculate();
    });
  }

  if (exportKmlBtn) {
    exportKmlBtn.addEventListener('click', () => {
      if (onExportKml) onExportKml();
    });
  }
}