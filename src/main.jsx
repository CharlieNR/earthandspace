import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShapeUtils, Vector2 } from 'three';
import Globe from 'react-globe.gl';
import * as topojson from 'topojson-client';
import { EVENTS, GEOLOGIC_FACTS, PLATE_BOUNDARIES, PLATES, PERIODS } from './data';
import PlateTectonicsLab from './PlateTectonicsLab';
import EarthSandboxSimulator from './EarthSandboxSimulator';
import './styles.css';

const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const GPLATES_URL = 'https://gws.gplates.org/reconstruct/reconstruct_feature_collection';
const GPLATES_COASTLINES_URLS = [
  'https://gws.gplates.org/reconstruct/coastlines/',
  'https://gws1.gplates.org/reconstruct/coastlines/',
  'https://gws2.gplates.org/reconstruct/coastlines/',
];
const GPLATES_COASTLINES_URL = GPLATES_COASTLINES_URLS[0];
const GPLATES_COUNTRY_URL = 'https://gws.gplates.org/reconstruct/reconstruct_feature_collection';
const GPLATES_TEST_AGE = 100;

const DAY_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';

const USGS_EARTHQUAKE_FEEDS = {
  hour: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
  day: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  week: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson',
  month: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson',
};
const USGS_EARTHQUAKE_MAP_URL = 'https://earthquake.usgs.gov/earthquakes/map/';
const PHIVOLCS_EARTHQUAKE_BULLETINS_URL = 'https://earthquake.phivolcs.dost.gov.ph/';
const QUAKE_REFRESH_INTERVAL_MS = 60000;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function earthquakeMagnitudeColor(magnitude) {
  if (magnitude >= 6) return '#ff526c';
  if (magnitude >= 4.5) return '#ff9b54';
  if (magnitude >= 2.5) return '#f4cf68';
  return '#71d8c4';
}

function earthquakeMagnitudeRadius(magnitude) {
  const value = Number.isFinite(Number(magnitude)) ? Number(magnitude) : 0;
  return Math.max(0.12, Math.min(0.82, 0.14 + Math.max(0, value) * 0.075));
}

// Broad geographic region footprints for classifying earthquake epicentres.
// These are practical map-filter regions, not official political or tectonic boundaries.
const EARTHQUAKE_REGION_POLYGONS = {
  'north-america': [
    [[-168, 50], [-150, 60], [-130, 70], [-110, 82], [-75, 83], [-52, 58], [-63, 8], [-90, 7], [-108, 25], [-130, 45]],
    [[-75, 58], [-53, 58], [-18, 65], [-30, 80], [-52, 84], [-70, 72]],
    [[-180, 50], [-155, 50], [-153, 65], [-180, 72]],
    [[160, 50], [180, 48], [180, 65], [170, 60]],
  ],
  'south-america': [
    [[-82, 13], [-68, 12], [-50, 5], [-34, -7], [-40, -25], [-55, -55], [-70, -56], [-80, -15]],
  ],
  europe: [
    [[-25, 35], [-10, 36], [5, 36], [20, 34], [31, 36], [40, 41], [52, 48], [65, 54], [58, 72], [30, 72], [0, 70], [-15, 65], [-25, 55]],
  ],
  africa: [
    [[-18, 36], [10, 37], [32, 31], [43, 12], [52, -15], [34, -35], [15, -35], [-17, -5]],
  ],
  oceania: [
    [[110, -10], [155, -10], [155, -45], [130, -48], [112, -30]],
    [[130, -10], [155, -10], [155, 2], [140, 2]],
    [[165, -33], [180, -33], [180, -48], [165, -48]],
    [[145, -30], [180, -30], [180, 0], [145, 0]],
    [[145, 0], [180, 0], [180, 22], [150, 22]],
    [[-180, -30], [-130, -30], [-130, 0], [-180, 0]],
  ],
  asia: [
    [[28, 36], [40, 38], [45, 45], [60, 50], [75, 50], [180, 50], [180, 82], [30, 82]],
    [[28, 36], [45, 32], [55, 17], [68, 5], [95, -10], [130, -10], [155, 5], [180, 10], [180, 50], [75, 50], [60, 50], [45, 45]],
  ],
};

function pointInGeographicPolygon(longitude, latitude, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crossesLatitude = (yi > latitude) !== (yj > latitude);
    if (crossesLatitude) {
      const crossingLongitude = ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
      if (longitude < crossingLongitude) inside = !inside;
    }
  }
  return inside;
}

function earthquakeRegionForEvent(event) {
  const coordinates = event?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  // Test the more distinct regions before Asia, where regional borders meet.
  const order = ['north-america', 'south-america', 'europe', 'africa', 'oceania', 'asia'];
  return order.find((region) =>
    EARTHQUAKE_REGION_POLYGONS[region].some((polygon) =>
      pointInGeographicPolygon(longitude, latitude, polygon)
    )
  ) || null;
}

const EARTHQUAKE_REGION_LABELS = {
  world: 'Worldwide',
  asia: 'Asia',
  africa: 'Africa',
  europe: 'Europe',
  'north-america': 'N. America',
  'south-america': 'S. America',
  oceania: 'Oceania',
};

function formatEarthquakeTime(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return 'Time unavailable';
  return new Date(Number(timestamp)).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}


const GLOBAL_MAP_WIDTH = 1000;
const GLOBAL_MAP_HEIGHT = 500;
const NASA_EONET_VOLCANO_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&days=365&limit=500';
const SMITHSONIAN_VOLCANO_WFS_URL = 'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows';
const USGS_VOLCANO_ALERTS_URL = 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes';
const VOLCANO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// EDIT THESE VALUES TO CONTROL WHICH HOMEPAGE SYSTEMS ARE AVAILABLE.
// Use status: 'open' or status: 'close'. Changes take effect when the site rebuilds/deploys.
// This is intentionally code-defined: there is no remote control API or Cloudflare dependency.
const SYSTEM_CATALOG = {
  'past-globe': { name: 'Past Globe', description: 'Explore Earth through geological time.', status: 'open' },
  'mass-space': { name: 'Mass in Space', description: 'Compare weight across the Solar System.', status: 'open' },
  phivolcs: { name: 'Global Seismic & Volcanic Monitor', description: 'Global earthquake and volcano monitoring.', status: 'open' },
  'plate-lab': { name: 'Plate Tectonics Laboratory', description: 'Interactive tectonics experiments.', status: 'close' },
  'earth-sandbox': { name: 'Earth Sandbox Simulator', description: 'Build and experiment with adjustable Earth systems.', status: 'open' },
};
const SYSTEM_CONTROL_IDS = Object.keys(SYSTEM_CATALOG);
const DIRECT_SYSTEM_LINKS = {
  pastglobe: 'past-globe',
  massspace: 'mass-space',
  phivolcs: 'phivolcs',
  platelab: 'plate-lab',
  earthsandbox: 'earth-sandbox',
};
function getInitialSystemFromUrl() {
  if (typeof window === 'undefined') return 'landing';
  const params = new URLSearchParams(window.location.search);
  for (const [query, id] of Object.entries(DIRECT_SYSTEM_LINKS)) {
    if (params.has(query)) {
      return SYSTEM_CATALOG[id]?.status === 'close' ? 'landing' : id;
    }
  }
  return 'landing';
}
const INITIAL_SYSTEM_AVAILABILITY = Object.fromEntries(
  SYSTEM_CONTROL_IDS.map((id) => [id, SYSTEM_CATALOG[id].status !== 'close'])
);

function equirectangularPoint(longitude, latitude) {
  return {
    x: ((Number(longitude) + 180) / 360) * GLOBAL_MAP_WIDTH,
    y: ((90 - Number(latitude)) / 180) * GLOBAL_MAP_HEIGHT,
  };
}

function geoGeometryToEquirectangularPath(geometry) {
  if (!geometry) return '';
  const pathParts = [];
  const project = (point) => {
    const mapped = equirectangularPoint(point[0], point[1]);
    return Number.isFinite(mapped.x) && Number.isFinite(mapped.y)
      ? [Math.max(-2, Math.min(GLOBAL_MAP_WIDTH + 2, mapped.x)), Math.max(-2, Math.min(GLOBAL_MAP_HEIGHT + 2, mapped.y))]
      : null;
  };

  const appendRing = (ring) => {
    const points = (Array.isArray(ring) ? ring : []).filter((point) =>
      Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
    );
    if (points.length < 3) return;

    // Split rings at the antimeridian rather than drawing a false line across the map.
    let current = [points[0]];
    const segments = [];
    for (let index = 1; index <= points.length; index += 1) {
      const previous = points[index - 1];
      const next = points[index % points.length];
      const rawDifference = Number(next[0]) - Number(previous[0]);
      if (Math.abs(rawDifference) > 180) {
        const crossesEast = rawDifference < -180;
        const unwrappedNextLongitude = Number(next[0]) + (crossesEast ? 360 : -360);
        const boundaryLongitude = crossesEast ? 180 : -180;
        const denominator = unwrappedNextLongitude - Number(previous[0]);
        const fraction = Math.abs(denominator) > 1e-9
          ? (boundaryLongitude - Number(previous[0])) / denominator
          : 0.5;
        const boundaryLatitude = Number(previous[1]) + (Number(next[1]) - Number(previous[1])) * fraction;
        current.push([boundaryLongitude, boundaryLatitude]);
        segments.push(current);
        current = [[-boundaryLongitude, boundaryLatitude]];
        if (index < points.length) current.push(next);
      } else if (index < points.length) {
        current.push(next);
      }
    }
    segments.push(current);

    segments.forEach((segment) => {
      if (segment.length < 3) return;
      const mapped = segment.map(project);
      if (mapped.some((point) => !point)) return;
      pathParts.push('M' + mapped.map((point) => point[0].toFixed(2) + ',' + point[1].toFixed(2)).join('L') + 'Z');
    });
  };

  const visitPolygonCoordinates = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    coordinates.forEach(appendRing);
  };
  const visit = (item) => {
    if (!item) return;
    if (item.type === 'Feature') {
      visit(item.geometry);
    } else if (item.type === 'FeatureCollection') {
      (item.features || []).forEach(visit);
    } else if (item.type === 'Polygon') {
      visitPolygonCoordinates(item.coordinates);
    } else if (item.type === 'MultiPolygon') {
      (item.coordinates || []).forEach(visitPolygonCoordinates);
    } else if (item.type === 'GeometryCollection') {
      (item.geometries || []).forEach(visit);
    }
  };
  visit(geometry);
  return pathParts.join('');
}

function getVolcanoProperty(properties, candidateKeys) {
  if (!properties || typeof properties !== 'object') return null;
  const entries = Object.entries(properties);
  const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const candidate of candidateKeys) {
    const wanted = normalize(candidate);
    const found = entries.find(([key, value]) => normalize(key) === wanted && value !== null && value !== undefined && String(value).trim() !== '');
    if (found) return found[1];
  }
  for (const candidate of candidateKeys) {
    const wanted = normalize(candidate);
    const found = entries.find(([key, value]) => normalize(key).includes(wanted) && value !== null && value !== undefined && String(value).trim() !== '');
    if (found) return found[1];
  }
  return null;
}

function eonetGeometryPoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const longitude = Number(geometry.coordinates[0]);
    const latitude = Number(geometry.coordinates[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? { longitude, latitude } : null;
  }
  let coordinateList = [];
  const gather = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      coordinateList.push(value);
      return;
    }
    value.forEach(gather);
  };
  gather(geometry.coordinates);
  if (!coordinateList.length) return null;
  const longitudes = coordinateList.map((coordinate) => Number(coordinate[0]));
  const latitudes = coordinateList.map((coordinate) => Number(coordinate[1]));
  const longitude = longitudes.reduce((sum, value) => sum + value, 0) / longitudes.length;
  const latitude = latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length;
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? { longitude, latitude } : null;
}

function volcanoAlertColour(alert) {
  const color = String(alert?.color_code || alert?.colorCode || '').toUpperCase();
  if (color === 'RED') return '#ff5b65';
  if (color === 'ORANGE') return '#ff9b58';
  if (color === 'YELLOW') return '#f2d26c';
  return '#8cb5db';
}

const BUMP_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-topology.png';
const STAR_TEXTURE = 'https://unpkg.com/three-globe/example/img/night-sky.png';

const CACHE_DB_NAME = 'intheglobe-keyframe-cache-v3';
const CACHE_STORE_NAME = 'keyframes';
const COUNTRY_CACHE_STORE_NAME = 'country-keyframes';
const CACHE_MANIFEST_KEY = 'intheglobe-keyframe-manifest-v3';
const MAX_AGE = 1800;
const PLAYBACK_STEP = 5;
const KEYFRAME_STEP = 25;
const KEYFRAME_AGES = Array.from({ length: Math.floor(MAX_AGE / KEYFRAME_STEP) + 1 }, (_, index) => Math.min(index * KEYFRAME_STEP, MAX_AGE));
const PRELOAD_WORKERS = 2;
const FRAME_REQUEST_TIMEOUT_MS = 30000;
const FRAME_REQUEST_RETRIES = 3;
const PRIORITY_KEYFRAMES = 8;
const PRELOAD_START_DELAY_MS = 1200;
const PRELOAD_FAILURE_PAUSE_MS = 12000;



const SOLAR_SYSTEM_PLANETS = [
  { name: 'Mercury', gravity: 3.70, diameter: 120, texture: 'https://www.solarsystemscope.com/textures/download/2k_mercury.jpg', fact: 'The smallest planet, with a heavily cratered rocky surface.' },
  { name: 'Venus', gravity: 8.87, diameter: 145, texture: 'https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg', fact: 'A rocky world hidden beneath thick, hot clouds.' },
  { name: 'Earth', gravity: 9.80, diameter: 160, texture: 'https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg', fact: 'Our home world; the reference for your input mass.' },
  { name: 'Mars', gravity: 3.71, diameter: 135, texture: 'https://www.solarsystemscope.com/textures/download/2k_mars.jpg', fact: 'A cold desert world with enormous volcanoes and canyons.' },
  { name: 'Jupiter', gravity: 24.79, diameter: 220, texture: 'https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg', fact: 'The largest planet, with powerful gravity and swirling cloud bands.' },
  { name: 'Saturn', gravity: 10.44, diameter: 205, texture: 'https://www.solarsystemscope.com/textures/download/2k_saturn.jpg', fact: 'A gas giant surrounded by a spectacular ring system.' },
  { name: 'Uranus', gravity: 8.87, diameter: 180, texture: 'https://www.solarsystemscope.com/textures/download/2k_uranus.jpg', fact: 'An ice giant that rotates on a dramatic tilt.' },
  { name: 'Neptune', gravity: 11.15, diameter: 178, texture: 'https://www.solarsystemscope.com/textures/download/2k_neptune.jpg', fact: 'A distant, cold ice giant with very fast winds.' },
];

const MAX_DIAGNOSTIC_LINES = 2500;
let diagnosticSink = null;

function setDiagnosticSink(sink) {
  diagnosticSink = sink;
}

function diagnostic(level, scope, message, meta) {
  const time = new Date().toISOString().slice(11, 23);
  let suffix = '';
  if (meta !== undefined) {
    try {
      suffix = ' ' + JSON.stringify(meta);
    } catch {
      suffix = ' [unserializable details]';
    }
  }
  const line = time + ' ' + level.toUpperCase().padEnd(5) + ' [' + scope + '] ' + message + suffix;
  diagnosticSink?.(line);
  if (level === 'error') console.error('[intheglobe]', line);
  else if (level === 'warn') console.warn('[intheglobe]', line);
  else console.info('[intheglobe]', line);
}

function keyframeAgeFor(age) {
  return Math.min(MAX_AGE, Math.round(Number(age) / KEYFRAME_STEP) * KEYFRAME_STEP);
}

function frameKey(age) {
  return modelForAge(age) + ':' + String(Math.round(age));
}

function readFrameManifest() {
  try {
    const value = JSON.parse(window.localStorage.getItem(CACHE_MANIFEST_KEY) || '{}');
    return new Set(Object.keys(value));
  } catch {
    return new Set();
  }
}

function writeFrameManifestEntry(key) {
  try {
    const current = JSON.parse(window.localStorage.getItem(CACHE_MANIFEST_KEY) || '{}');
    current[key] = 1;
    window.localStorage.setItem(CACHE_MANIFEST_KEY, JSON.stringify(current));
    return true;
  } catch {
    // The localStorage manifest is only an index; the full geometry lives in IndexedDB.
    return false;
  }
}

let frameDbPromise = null;

function openFrameDb() {
  if (!('indexedDB' in window)) {
    diagnostic('warn', 'CACHE', 'IndexedDB is unavailable; persistent frame storage disabled');
    return Promise.resolve(null);
  }
  if (frameDbPromise) return frameDbPromise;
  diagnostic('info', 'CACHE', 'Opening IndexedDB cache', { db: CACHE_DB_NAME, store: CACHE_STORE_NAME });
  frameDbPromise = new Promise((resolve, reject) => {
    // Version 2 adds a separate store for completed country reconstructions.
    // The keyframe store is preserved during this in-place upgrade.
    const request = window.indexedDB.open(CACHE_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CACHE_STORE_NAME)) {
        database.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(COUNTRY_CACHE_STORE_NAME)) {
        database.createObjectStore(COUNTRY_CACHE_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => { diagnostic('info', 'CACHE', 'IndexedDB ready'); resolve(request.result); };
    request.onerror = () => {
      frameDbPromise = null;
      diagnostic('error', 'CACHE', 'IndexedDB open failed', { message: request.error?.message || String(request.error) });
      reject(request.error);
    };
  });
}


async function getStoredFrameKeys() {
  const db = await openFrameDb().catch(() => null);
  if (!db) return new Set();
  return new Promise((resolve) => {
    const transaction = db.transaction(CACHE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(CACHE_STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result || []));
    request.onerror = () => resolve(new Set());
  });
}

async function getStoredFrame(age) {
  const key = frameKey(age);
  diagnostic('info', 'CACHE', 'Checking stored keyframe', { age, key });
  const db = await openFrameDb().catch((error) => {
    diagnostic('error', 'CACHE', 'IndexedDB read setup failed', { key, error: error?.message || String(error) });
    return null;
  });
  if (!db) return null;

  return new Promise((resolve) => {
    const transaction = db.transaction(CACHE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(CACHE_STORE_NAME).get(key);
    request.onsuccess = async () => {
      const record = request.result;
      if (!record) {
        diagnostic('info', 'CACHE', 'Keyframe miss', { key });
        resolve(null);
        return;
      }
      diagnostic('info', 'CACHE', 'Keyframe record found', {
        key,
        encoding: record.encoding,
        bytes: typeof record.data === 'string' ? record.data.length : record.data?.byteLength || 0,
      });
      try {
        let json;
        if (record.encoding === 'gzip') {
          if (typeof DecompressionStream !== 'function') {
            diagnostic('warn', 'CACHE', 'Cached frame is gzip-compressed but this browser cannot decompress it', { key });
            resolve(null);
            return;
          }
          const stream = new Blob([record.data]).stream().pipeThrough(new DecompressionStream('gzip'));
          json = await new Response(stream).text();
        } else if (typeof record.data === 'string') {
          json = record.data;
        } else {
          throw new Error('Stored frame has an unsupported data encoding');
        }

        const features = JSON.parse(json);
        if (!Array.isArray(features) || features.length === 0 || features.some((feature) => !feature?.geometry)) {
          diagnostic('warn', 'CACHE', 'Stored keyframe failed validation and will be refetched', { key, featureCount: features?.length || 0 });
          resolve(null);
          return;
        }
        resolve(features);
      } catch (error) {
        diagnostic('warn', 'CACHE', 'Could not decode cached reconstruction frame', { key, error: error?.message || String(error) });
        resolve(null);
      }
    };
    request.onerror = () => {
      diagnostic('warn', 'CACHE', 'IndexedDB key lookup failed', { key, error: request.error?.message });
      resolve(null);
    };
  });
}

async function putStoredFrame(age, features) {
  const key = frameKey(age);
  if (!Array.isArray(features) || features.length === 0 || features.some((feature) => !feature?.geometry)) {
    diagnostic('error', 'CACHE', 'Refusing to persist an empty or invalid keyframe', { age, key, featureCount: features?.length || 0 });
    return false;
  }

  const compactFeatures = features.map((feature) => ({
    type: 'Feature',
    properties: {},
    geometry: feature.geometry,
  }));
  const json = JSON.stringify(compactFeatures);
  let encoding = 'json';
  let data = json;

  if (typeof CompressionStream === 'function' && typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      data = await new Response(stream).arrayBuffer();
      encoding = 'gzip';
    } catch (error) {
      diagnostic('warn', 'CACHE', 'Frame compression failed; saving uncompressed JSON instead', { key, message: error?.message });
    }
  }

  const db = await openFrameDb().catch((error) => {
    diagnostic('error', 'CACHE', 'IndexedDB open failed before keyframe write', { key, error: error?.message || String(error) });
    return null;
  });
  if (!db) {
    diagnostic('error', 'CACHE', 'Keyframe is available only in memory because persistent browser storage is unavailable', { key });
    return false;
  }

  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      transaction.objectStore(CACHE_STORE_NAME).put({
        key,
        age,
        model: modelForAge(age),
        encoding,
        data,
        savedAt: Date.now(),
        featureCount: compactFeatures.length,
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted'));
    });

    const manifestSaved = writeFrameManifestEntry(key);
    diagnostic('info', 'CACHE', 'Keyframe persisted to browser IndexedDB', {
      key,
      age,
      model: modelForAge(age),
      features: compactFeatures.length,
      compressed: encoding === 'gzip',
      encodedBytes: typeof data === 'string' ? data.length : data.byteLength,
      localStorageManifestUpdated: manifestSaved,
    });
    return true;
  } catch (error) {
    diagnostic('error', 'CACHE', 'Keyframe write failed; fetched geometry remains in memory only', {
      key,
      name: error?.name,
      message: error?.message,
    });
    return false;
  }
}

async function getStoredCountryFrame(key) {
  const db = await openFrameDb().catch((error) => {
    diagnostic('error', 'COUNTRY', 'Could not open persistent country cache', { key, message: error?.message || String(error) });
    return null;
  });
  if (!db) return null;

  return new Promise((resolve) => {
    const transaction = db.transaction(COUNTRY_CACHE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(COUNTRY_CACHE_STORE_NAME).get(key);
    request.onsuccess = async () => {
      const record = request.result;
      if (!record) {
        diagnostic('info', 'COUNTRY', 'Persistent country cache miss', { key });
        resolve(null);
        return;
      }
      try {
        let json;
        if (record.encoding === 'gzip') {
          if (typeof DecompressionStream !== 'function') {
            diagnostic('warn', 'COUNTRY', 'Cached country geometry cannot be decompressed in this browser', { key });
            resolve(null);
            return;
          }
          const stream = new Blob([record.data]).stream().pipeThrough(new DecompressionStream('gzip'));
          json = await new Response(stream).text();
        } else if (typeof record.data === 'string') {
          json = record.data;
        } else {
          throw new Error('Stored country geometry has an unsupported encoding');
        }
        const savedFeatures = JSON.parse(json);
        if (!Array.isArray(savedFeatures) || savedFeatures.length === 0 || savedFeatures.some((feature) => !feature?.geometry)) {
          diagnostic('warn', 'COUNTRY', 'Stored country geometry failed validation and will be reconstructed again', { key, featureCount: savedFeatures?.length || 0 });
          resolve(null);
          return;
        }
        resolve(savedFeatures.map((feature) => ({ ...feature, __layer: 'tracked' })));
      } catch (error) {
        diagnostic('warn', 'COUNTRY', 'Could not decode persistent country geometry', { key, message: error?.message || String(error) });
        resolve(null);
      }
    };
    request.onerror = () => {
      diagnostic('warn', 'COUNTRY', 'Persistent country cache lookup failed', { key, message: request.error?.message });
      resolve(null);
    };
  });
}

async function putStoredCountryFrame(key, features, countryName) {
  if (!Array.isArray(features) || features.length === 0 || features.some((feature) => !feature?.geometry)) {
    diagnostic('warn', 'COUNTRY', 'Refusing to persist incomplete country reconstruction', { key, featureCount: features?.length || 0 });
    return false;
  }

  const compactFeatures = features.map((feature) => ({
    type: 'Feature',
    properties: { trackedCountry: countryName },
    geometry: feature.geometry,
  }));
  const json = JSON.stringify(compactFeatures);
  let encoding = 'json';
  let data = json;
  if (typeof CompressionStream === 'function' && typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      data = await new Response(stream).arrayBuffer();
      encoding = 'gzip';
    } catch (error) {
      diagnostic('warn', 'COUNTRY', 'Country compression failed; saving uncompressed JSON', { key, message: error?.message });
    }
  }

  const db = await openFrameDb().catch(() => null);
  if (!db) return false;
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(COUNTRY_CACHE_STORE_NAME, 'readwrite');
      transaction.objectStore(COUNTRY_CACHE_STORE_NAME).put({
        key,
        countryName,
        encoding,
        data,
        featureCount: compactFeatures.length,
        savedAt: Date.now(),
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB country-cache write failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB country-cache write aborted'));
    });
    diagnostic('info', 'COUNTRY', 'Completed country reconstruction saved to browser IndexedDB', {
      key,
      country: countryName,
      features: compactFeatures.length,
      compressed: encoding === 'gzip',
      encodedBytes: typeof data === 'string' ? data.length : data.byteLength,
    });
    return true;
  } catch (error) {
    diagnostic('error', 'COUNTRY', 'Could not persist completed country reconstruction', { key, message: error?.message || String(error) });
    return false;
  }
}

async function clearStoredFrames() {
  diagnostic('warn', 'CACHE', 'Clearing all saved keyframes and country reconstructions');
  try {
    const db = await openFrameDb().catch(() => null);
    if (db) {
      await new Promise((resolve) => {
        const stores = [CACHE_STORE_NAME, COUNTRY_CACHE_STORE_NAME].filter((name) => db.objectStoreNames.contains(name));
        const transaction = db.transaction(stores, 'readwrite');
        stores.forEach((name) => transaction.objectStore(name).clear());
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
        transaction.onabort = resolve;
      });
    }
  } finally {
    try { window.localStorage.removeItem(CACHE_MANIFEST_KEY); } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const started = performance.now();
  const timeout = window.setTimeout(() => {
    diagnostic('warn', 'NET', 'Request timeout fired', { timeoutMs: FRAME_REQUEST_TIMEOUT_MS, url });
    controller.abort();
  }, FRAME_REQUEST_TIMEOUT_MS);
  let abortHandler;

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      abortHandler = () => {
        diagnostic('info', 'NET', 'Request cancelled by app priority handoff', { url });
        controller.abort();
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    diagnostic('info', 'NET', 'HTTP response received', { status: response.status, type: response.type, ms: Math.round(performance.now() - started), url });
    return response;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      const timeoutError = new Error('Frame request timed out after ' + Math.round(FRAME_REQUEST_TIMEOUT_MS / 1000) + ' seconds');
      timeoutError.name = 'TimeoutError';
      diagnostic('error', 'NET', 'Request timed out', { ms: Math.round(performance.now() - started), url });
      throw timeoutError;
    }
    diagnostic('error', 'NET', 'Network request failed', { ms: Math.round(performance.now() - started), name: error?.name, message: error?.message, url });
    throw error;
  } finally {
    window.clearTimeout(timeout);
    if (options.signal && abortHandler) options.signal.removeEventListener('abort', abortHandler);
  }
}

async function fetchReconstructionWithRetry(age, signal) {
  let lastError;
  const attempts = Math.max(FRAME_REQUEST_RETRIES, GPLATES_COASTLINES_URLS.length);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    const endpoint = GPLATES_COASTLINES_URLS[(attempt - 1) % GPLATES_COASTLINES_URLS.length];
    diagnostic('info', 'FRAME', 'Attempt ' + attempt + '/' + attempts, {
      age,
      model: modelForAge(age),
      source: 'coastlines',
      endpoint,
    });
    try {
      return await fetchReconstructionFrame(age, signal, endpoint);
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' && signal?.aborted) throw error;
      diagnostic('warn', 'FRAME', 'Attempt failed', { age, attempt, endpoint, name: error?.name, message: error?.message });
      if (attempt < attempts) await sleep(250 * attempt);
    }
  }
  throw lastError || new Error('Frame request failed');
}

async function fetchReconstructionFrame(age, signal, endpoint = GPLATES_COASTLINES_URL) {
  const started = performance.now();
  const model = modelForAge(age);
  const url = new URL(endpoint);
  url.searchParams.set('time', String(age));
  url.searchParams.set('model', model);
  url.searchParams.set('anchor_plate_id', '0');
  url.searchParams.set('wrap', 'true');

  diagnostic('info', 'FRAME', 'REQUEST start', {
    age,
    model,
    method: 'GET',
    source: 'coastlines',
    endpoint: GPLATES_COASTLINES_URL,
  });

  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/geo+json, application/json;q=0.9, text/plain;q=0.8' },
    signal,
  });

  const responseText = await response.text();
  diagnostic(response.ok ? 'info' : 'error', 'FRAME', 'Response body received', {
    age,
    model,
    status: response.status,
    bytes: responseText.length,
    ms: Math.round(performance.now() - started),
    preview: response.ok ? undefined : responseText.slice(0, 700),
  });

  if (!response.ok) {
    throw new Error('GPlates coastline HTTP ' + response.status + ': ' + responseText.slice(0, 300));
  }

  let reconstructed;
  try {
    reconstructed = JSON.parse(responseText);
  } catch (error) {
    diagnostic('error', 'FRAME', 'Coastline response was not valid JSON', { age, model, message: error?.message });
    throw new Error('GPlates coastline endpoint returned invalid JSON');
  }

  const supportedLandGeometry = (geometry) => geometry
    && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon');

  const features = flattenFeatures(reconstructed)
    .filter((feature) => supportedLandGeometry(feature.geometry))
    .map((feature) => ({
      type: 'Feature',
      properties: feature.properties || {},
      geometry: feature.geometry,
    }));

  diagnostic('info', 'FRAME', 'REQUEST complete', {
    age,
    model,
    source: 'coastlines',
    features: features.length,
    ms: Math.round(performance.now() - started),
  });

  if (!features.length) throw new Error('No reconstructed coastline geometry returned');
  return features;
}

async function testGplatesConnectivity() {
  const started = performance.now();
  const url = new URL(GPLATES_COASTLINES_URL);
  url.searchParams.set('time', String(GPLATES_TEST_AGE));
  url.searchParams.set('model', 'MULLER2022');
  url.searchParams.set('anchor_plate_id', '0');
  url.searchParams.set('extent', '-10,10,-10,10');
  diagnostic('info', 'TEST', 'GPlates connectivity test started', {
    method: 'GET',
    endpoint: GPLATES_COASTLINES_URL,
    testAge: GPLATES_TEST_AGE,
    model: 'MULLER2022',
  });

  try {
    const response = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/geo+json, application/json;q=0.9, text/plain;q=0.8' },
    });
    const body = await response.text();
    const ms = Math.round(performance.now() - started);

    let featureCount = 0;
    try {
      featureCount = flattenFeatures(JSON.parse(body)).filter((feature) => feature.geometry).length;
    } catch {
      // The status/response body diagnostics below are still useful when parsing fails.
    }

    diagnostic(response.ok ? 'info' : 'error', 'TEST', response.ok ? 'GPlates connectivity test PASSED' : 'GPlates connectivity test returned an HTTP error', {
      status: response.status,
      ok: response.ok,
      ms,
      bytes: body.length,
      featureCount,
      cors: 'browser fetch completed',
      preview: response.ok ? undefined : body.slice(0, 500),
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    return {
      ok: true,
      status: response.status,
      ms,
      bytes: body.length,
      featureCount,
    };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    diagnostic('error', 'TEST', 'GPlates connectivity test FAILED', {
      ms,
      name: error?.name,
      message: error?.message,
      hint: error?.name === 'TypeError'
        ? 'The browser could not complete the cross-origin GET. This usually indicates connectivity or a CORS/network restriction.'
        : undefined,
    });
    return { ok: false, ms, name: error?.name, message: error?.message };
  }
}


function modelForAge(age) {
  if (age <= 410) return 'MULLER2022';
  if (age <= 1000) return 'MERDITH2021';
  return 'CAO2024';
}

function countryKey(country) {
  return String(country?.id || country?.properties?.name || 'unknown');
}

function countryCacheKey(country, age) {
  return 'country-territory-pieces-v2:' + countryKey(country) + ':' + modelForAge(age) + ':' + String(Math.round(age));
}

function featureCentroid(feature) {
  const points = [];
  const collect = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push(value);
      return;
    }
    value.forEach(collect);
  };
  collect(feature?.geometry?.coordinates);
  if (!points.length) return { lat: 0, lng: 0 };
  const lng = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const lat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return { lat, lng };
}


/*
 * Triangulate a country's exact present-day polygons, then subdivide each
 * triangle into small geographic pieces. GPlates assigns a reconstruction plate
 * to each feature; keeping these features small means one country that crosses
 * several plates no longer gets moved as one giant shape. Because the triangles
 * are built only from the country's own polygon, they cannot include the rest
 * of a continent just because it happens to share the same tectonic plate.
 */
function countryTerritoryPlatePieces(geometry, maximumEdgeDegrees = 1.15) {
  const polygons = [];
  const collectPolygons = (item) => {
    if (!item) return;
    if (item.type === 'Polygon') {
      polygons.push(item.coordinates);
    } else if (item.type === 'MultiPolygon') {
      item.coordinates.forEach((coordinates) => polygons.push(coordinates));
    } else if (item.type === 'GeometryCollection') {
      item.geometries?.forEach(collectPolygons);
    }
  };
  collectPolygons(geometry);

  const pieces = [];
  const samePoint = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

  const openRing = (ring, referenceLongitude = null) => {
    if (!Array.isArray(ring)) return [];
    let points = ring
      .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .map((point) => [point[0], point[1]]);
    if (points.length > 1 && samePoint(points[0], points[points.length - 1])) {
      points = points.slice(0, -1);
    }
    if (points.length < 3) return [];

    let firstLongitude = points[0][0];
    if (Number.isFinite(referenceLongitude)) {
      firstLongitude += 360 * Math.round((referenceLongitude - firstLongitude) / 360);
    }
    const unwrapped = [[firstLongitude, points[0][1]]];
    let previousLongitude = firstLongitude;
    for (let index = 1; index < points.length; index += 1) {
      let longitude = points[index][0];
      while (longitude - previousLongitude > 180) longitude -= 360;
      while (longitude - previousLongitude < -180) longitude += 360;
      unwrapped.push([longitude, points[index][1]]);
      previousLongitude = longitude;
    }
    return unwrapped;
  };

  const edgeLength = (a, b) => {
    const averageLatitude = ((a[1] + b[1]) / 2) * Math.PI / 180;
    const deltaLongitude = (b[0] - a[0]) * Math.cos(averageLatitude);
    const deltaLatitude = b[1] - a[1];
    return Math.hypot(deltaLongitude, deltaLatitude);
  };

  const normalizePieceLongitudes = (triangle) => {
    const averageLongitude = triangle.reduce((sum, point) => sum + point[0], 0) / triangle.length;
    const shift = 360 * Math.floor((averageLongitude + 180) / 360);
    return triangle.map((point) => [point[0] - shift, point[1]]);
  };

  const subdivideTriangle = (triangle, output, depth = 0) => {
    const edges = [
      { a: 0, b: 1, c: 2, length: edgeLength(triangle[0], triangle[1]) },
      { a: 1, b: 2, c: 0, length: edgeLength(triangle[1], triangle[2]) },
      { a: 2, b: 0, c: 1, length: edgeLength(triangle[2], triangle[0]) },
    ].sort((a, b) => b.length - a.length);
    const longest = edges[0];

    if (longest.length <= maximumEdgeDegrees || depth >= 15) {
      const normalized = normalizePieceLongitudes(triangle);
      if (Math.abs(
        (normalized[0][0] * (normalized[1][1] - normalized[2][1]) +
         normalized[1][0] * (normalized[2][1] - normalized[0][1]) +
         normalized[2][0] * (normalized[0][1] - normalized[1][1])) / 2
      ) > 1e-10) {
        output.push({
          type: 'Polygon',
          coordinates: [[normalized[0], normalized[1], normalized[2], normalized[0]]],
        });
      }
      return;
    }

    const a = triangle[longest.a];
    const b = triangle[longest.b];
    const c = triangle[longest.c];
    const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    subdivideTriangle([a, midpoint, c], output, depth + 1);
    subdivideTriangle([midpoint, b, c], output, depth + 1);
  };

  for (const polygonRings of polygons) {
    if (!Array.isArray(polygonRings) || !polygonRings.length) continue;
    const outer = openRing(polygonRings[0]);
    if (outer.length < 3) continue;
    const outerMeanLongitude = outer.reduce((sum, point) => sum + point[0], 0) / outer.length;
    const holes = polygonRings.slice(1)
      .map((ring) => openRing(ring, outerMeanLongitude))
      .filter((ring) => ring.length >= 3);

    const contourVectors = outer.map((point) => new Vector2(point[0], point[1]));
    const holeVectors = holes.map((ring) => ring.map((point) => new Vector2(point[0], point[1])));
    const flatVertices = [...contourVectors, ...holeVectors.flat()];
    const triangles = ShapeUtils.triangulateShape(contourVectors, holeVectors);

    for (const indices of triangles) {
      const triangle = indices.map((index) => [flatVertices[index].x, flatVertices[index].y]);
      if (triangle.length === 3) subdivideTriangle(triangle, pieces);
    }
  }

  return pieces;
}

async function reconstructCountryPieceBatch(country, age, pieces, batchIndex, batchCount, startIndex, signal) {
  const countryName = country?.properties?.name || countryKey(country);
  let lastError;

  for (let attempt = 1; attempt <= FRAME_REQUEST_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    try {
      const featureCollection = {
        type: 'FeatureCollection',
        features: pieces.map((piece, index) => ({
          type: 'Feature',
          id: String(country?.id || countryName) + '-territory-' + (startIndex + index),
          properties: { name: countryName, territoryPiece: startIndex + index },
          geometry: piece,
        })),
      };
      const payload = new URLSearchParams();
      payload.set('feature_collection', JSON.stringify(featureCollection));
      payload.set('time', String(age));
      payload.set('model', modelForAge(age));
      payload.set('anchor_plate_id', '0');

      diagnostic('info', 'COUNTRY', 'Reconstructing territory pieces', {
        country: countryName,
        age,
        batch: (batchIndex + 1) + '/' + batchCount,
        pieces: pieces.length,
        attempt,
      });

      const response = await fetchWithTimeout(GPLATES_COUNTRY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/geo+json, application/json;q=0.9',
        },
        body: payload,
        signal,
      });
      const textBody = await response.text();
      if (!response.ok) throw new Error('GPlates country HTTP ' + response.status + ': ' + textBody.slice(0, 250));

      const reconstructed = JSON.parse(textBody);
      const features = flattenFeatures(reconstructed)
        .filter((feature) => feature.geometry)
        .map((feature) => ({
          type: 'Feature',
          properties: {
            ...(feature.properties || {}),
            trackedCountry: countryName,
          },
          geometry: feature.geometry,
          __layer: 'tracked',
        }));

      if (!features.length) throw new Error('No reconstructed country pieces returned for batch ' + (batchIndex + 1));
      return features;
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' && signal?.aborted) throw error;
      diagnostic('warn', 'COUNTRY', 'Territory-piece batch failed', {
        country: countryName,
        age,
        batch: (batchIndex + 1) + '/' + batchCount,
        attempt,
        name: error?.name,
        message: error?.message,
      });
      if (attempt < FRAME_REQUEST_RETRIES) await sleep(250 * attempt);
    }
  }

  throw lastError || new Error('Country territory-piece reconstruction failed');
}

async function fetchCountryReconstructionWithRetry(country, age, signal, onBatch = null) {
  const countryName = country?.properties?.name || countryKey(country);
  const allPieces = countryTerritoryPlatePieces(country?.geometry);

  if (!allPieces.length) {
    throw new Error('Could not split the selected country into valid territory pieces');
  }

  // Keep POST payloads small enough for the public service, even for large countries.
  const batchSize = 300;
  const batches = [];
  for (let index = 0; index < allPieces.length; index += batchSize) {
    batches.push(allPieces.slice(index, index + batchSize));
  }

  diagnostic('info', 'COUNTRY', 'Country split into independently reconstructable territory pieces', {
    country: countryName,
    age,
    pieces: allPieces.length,
    batches: batches.length,
    maximumEdgeDegrees: 1.15,
  });

  const reconstructedBatches = new Array(batches.length);
  let nextBatch = 0;
  let failed = false;
  let firstFailure = null;

  const worker = async () => {
    while (!failed && !signal?.aborted) {
      const batchIndex = nextBatch;
      nextBatch += 1;
      if (batchIndex >= batches.length) return;
      try {
        reconstructedBatches[batchIndex] = await reconstructCountryPieceBatch(
          country, age, batches[batchIndex], batchIndex, batches.length, batchIndex * batchSize, signal
        );
        if (typeof onBatch === 'function') {
          onBatch(reconstructedBatches[batchIndex], batchIndex, batches.length);
        }
      } catch (error) {
        failed = true;
        firstFailure = error;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, () => worker()));
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
  if (firstFailure) throw firstFailure;

  const features = reconstructedBatches.flat();
  if (!features.length) throw new Error('No reconstructed country geometry returned');

  diagnostic('info', 'COUNTRY', 'Tracking reconstruction complete', {
    country: countryName,
    age,
    sourcePieces: allPieces.length,
    reconstructedFeatures: features.length,
  });
  return features;
}

function ageLabel(age) {
  if (age < 0.05) return 'Present day';
  if (age < 1000) return age.toFixed(age < 10 ? 1 : 0) + ' million years ago';
  return (age / 1000).toFixed(age < 10000 ? 1 : 0) + ' billion years ago';
}

function shortAge(age) {
  if (age < 0.05) return 'NOW';
  if (age < 1000) return Math.round(age) + ' Ma';
  return (age / 1000).toFixed(1) + ' Ga';
}

function nearestPeriod(age) {
  return PERIODS.reduce((closest, period) =>
    Math.abs(period.ma - age) < Math.abs(closest.ma - age) ? period : closest
  );
}

function flattenFeatures(collection) {
  if (!collection) return [];
  if (collection.type === 'FeatureCollection') return collection.features || [];
  if (collection.type === 'Feature') return [collection];
  return [];
}

function geometryToPaths(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') return geometry.type === 'LineString' ? [geometry.coordinates || []] : geometry.coordinates || [];
  return [];
}

function meshToPaths(mesh) {
  return geometryToPaths(mesh)
    .filter((points) => points.length > 1)
    .map((points) => ({ kind: 'country', points }));
}

// Use reconstructed polygon boundaries as line paths rather than filling raw
// coastline polygons. Some GPlates coastline rings span the ocean when treated
// as globe polygons, which paints the sea as land.
function reconstructedCoastlinePaths(features) {
  const paths = [];
  const addRing = (ring) => {
    if (Array.isArray(ring) && ring.length > 1) {
      paths.push({ kind: 'historical-coastline', points: ring });
    }
  };
  const visit = (geometry) => {
    if (!geometry) return;
    if (geometry.type === 'Polygon') {
      (geometry.coordinates || []).forEach(addRing);
    } else if (geometry.type === 'MultiPolygon') {
      (geometry.coordinates || []).forEach((polygon) => polygon.forEach(addRing));
    } else if (geometry.type === 'GeometryCollection') {
      (geometry.geometries || []).forEach(visit);
    }
  };
  (features || []).forEach((feature) => visit(feature.geometry));
  return paths;
}

function App() {
  const globeRef = useRef(null);
  const stageRef = useRef(null);
  const quakeMapSvgRef = useRef(null);
  const quakeMapDragRef = useRef(null);
  const quakeStageRef = useRef(null);
  const requestRef = useRef(0);
  const [systemSelected, setSystemSelected] = useState(() => getInitialSystemFromUrl());
  const [systemLinksCopied, setSystemLinksCopied] = useState(false);
  const [labInitialBoundaryName, setLabInitialBoundaryName] = useState(null);
  const [systemAvailability, setSystemAvailability] = useState(INITIAL_SYSTEM_AVAILABILITY);
  const [systemAvailabilityLoaded] = useState(true);
  const [systemAvailabilityError] = useState('');
  const [systemAvailabilityNotice, setSystemAvailabilityNotice] = useState('');
  const [quakeLayer, setQuakeLayer] = useState('earthquakes');
  const [quakeMapView, setQuakeMapView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [volcanoSites, setVolcanoSites] = useState([]);
  const [eruptionEvents, setEruptionEvents] = useState([]);
  const [volcanoAlerts, setVolcanoAlerts] = useState([]);
  const [volcanoLoading, setVolcanoLoading] = useState(false);
  const [volcanoError, setVolcanoError] = useState('');
  const [volcanoUpdatedAt, setVolcanoUpdatedAt] = useState(null);
  const [volcanoRefreshNonce, setVolcanoRefreshNonce] = useState(0);
  const [volcanoAutoRefresh, setVolcanoAutoRefresh] = useState(true);
  const [showAllVolcanoSites, setShowAllVolcanoSites] = useState(true);
  const [showReportedActivity, setShowReportedActivity] = useState(true);
  const [showUSGSVolcanoAlerts, setShowUSGSVolcanoAlerts] = useState(true);
  const [volcanoSelectedId, setVolcanoSelectedId] = useState(null);
  const volcanoSitesLoadedRef = useRef(false);

  const [quakeEvents, setQuakeEvents] = useState([]);
  const [quakeRange, setQuakeRange] = useState('day');
  const [quakeMinMagnitude, setQuakeMinMagnitude] = useState('0');
  const [quakeRegion, setQuakeRegion] = useState('world');
  const [quakeSort, setQuakeSort] = useState('newest');
  const [quakeSearch, setQuakeSearch] = useState('');
  const [quakeSelectedId, setQuakeSelectedId] = useState(null);
  const [quakeLoading, setQuakeLoading] = useState(false);
  const [quakeError, setQuakeError] = useState('');
  const [quakeUpdatedAt, setQuakeUpdatedAt] = useState(null);
  const [quakeRefreshNonce, setQuakeRefreshNonce] = useState(0);
  const [quakeAutoRefresh, setQuakeAutoRefresh] = useState(true);

  const [earthMass, setEarthMass] = useState('60');
  const [massPlanetIndex, setMassPlanetIndex] = useState(2);
  const [age, setAge] = useState(0);
  const [direction, setDirection] = useState('Start exploring');
  const [land, setLand] = useState([]);
  const [baseLand, setBaseLand] = useState(null);
  const [countries, setCountries] = useState([]);
  const [countryBoundaries, setCountryBoundaries] = useState([]);
  const [countrySearch, setCountrySearch] = useState('');
  const [trackedCountry, setTrackedCountry] = useState(null);
  const [trackedCountryLand, setTrackedCountryLand] = useState([]);
  const [trackedCountryStatus, setTrackedCountryStatus] = useState('idle');
  const [trackedCountryProgress, setTrackedCountryProgress] = useState({ completed: 0, total: 0 });
  const [status, setStatus] = useState('loading');
  const [statusText, setStatusText] = useState('Preparing Earth…');
  const [selected, setSelected] = useState({
    kind: 'welcome',
    title: 'Meet the changing Earth',
    summary: 'Drag the Earth, zoom in, then move through geological time. Every position is a reconstruction rather than a modern map placed on a globe.',
    body: 'Start with Present day, then move the timeline slowly backward. Watch the continents separate, converge, and reorganise around the planet.',
  });
  const [search, setSearch] = useState('');
  const [plateMode, setPlateMode] = useState(false);
  const [eventMode, setEventMode] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ cached: 0, total: KEYFRAME_AGES.length });
  const frameCacheRef = useRef(new Map());
  const preloadControllersRef = useRef(new Set());
  const playbackPreloadControllerRef = useRef(null);
  const trackedCountryCacheRef = useRef(new Map());
  const trackedCountryRequestRef = useRef(0);
  const foregroundRequestRef = useRef(0);
  const foregroundLoadingRef = useRef(false);
  const cacheGenerationRef = useRef(0);
  const [cacheGeneration, setCacheGeneration] = useState(0);
  const [isResettingCache, setIsResettingCache] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalTargetSystem, setTerminalTargetSystem] = useState('past-globe');
  const [terminalUnlocked, setTerminalUnlocked] = useState(false);
  const [terminalSessionToken, setTerminalSessionToken] = useState(null);
  const [terminalPasswordInput, setTerminalPasswordInput] = useState('');
  const [terminalPasswordError, setTerminalPasswordError] = useState('');
  const [terminalAuthenticating, setTerminalAuthenticating] = useState(false);
  const [terminalCommandInput, setTerminalCommandInput] = useState('');
  const [terminalLines, setTerminalLines] = useState([
    { kind: 'system', text: 'Earth Systems restricted console initialized.' },
  ]);
  const terminalCommandInputRef = useRef(null);
  const terminalBodyRef = useRef(null);
  const [diagnosticLines, setDiagnosticLines] = useState([
    '--- intheglobe diagnostics boot ---',
    'INFO  [SYSTEM] Terminal ready. Detailed runtime logging is enabled.',
  ]);
  const [gplatesTestState, setGplatesTestState] = useState('idle');
  const [reducedMotion, setReducedMotion] = useState(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  useEffect(() => {
    if (!systemAvailabilityLoaded) return;
    if (SYSTEM_CONTROL_IDS.includes(systemSelected) && systemAvailability[systemSelected] === false) {
      setSystemAvailabilityNotice(SYSTEM_CATALOG[systemSelected].name + ' has been marked NOT CURRENTLY AVAILABLE by an administrator.');
      setLabInitialBoundaryName(null);
      setSystemSelected('landing');
    }
  }, [systemAvailability, systemAvailabilityLoaded, systemSelected]);

  useEffect(() => {
    setDiagnosticSink((line) => {
      setDiagnosticLines((previous) => [...previous, line].slice(-MAX_DIAGNOSTIC_LINES));
    });
    diagnostic('info', 'SYSTEM', 'Diagnostic terminal connected');
    return () => setDiagnosticSink(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const inspectBrowserStorage = async () => {
      try {
        const storage = navigator.storage;
        if (!storage) {
          diagnostic('warn', 'CACHE', 'StorageManager API unavailable; browser persistence cannot be requested');
          return;
        }

        let persisted = typeof storage.persisted === 'function' ? await storage.persisted() : null;
        if (persisted === false && typeof storage.persist === 'function') {
          const granted = await storage.persist();
          if (cancelled) return;
          persisted = granted;
        }

        const estimate = typeof storage.estimate === 'function' ? await storage.estimate() : null;
        if (cancelled) return;
        diagnostic('info', 'CACHE', 'Browser-local storage capability checked', {
          persistentStorageGranted: persisted,
          usageMiB: Number.isFinite(estimate?.usage) ? Number((estimate.usage / 1048576).toFixed(2)) : null,
          quotaMiB: Number.isFinite(estimate?.quota) ? Number((estimate.quota / 1048576).toFixed(2)) : null,
          framePayloadStore: 'IndexedDB (compressed)',
          localStorageRole: 'small frame-key manifest only; not the large geometry payloads',
        });
      } catch (error) {
        diagnostic('warn', 'CACHE', 'Could not check/request durable browser storage', { message: error?.message || String(error) });
      }
    };
    inspectBrowserStorage();
    return () => { cancelled = true; };
  }, []);


  useEffect(() => {
    if (!terminalOpen) return;
    const element = terminalBodyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [diagnosticLines, terminalLines, terminalOpen]);

  useEffect(() => {
    const onError = (event) => diagnostic('error', 'WINDOW', 'Unhandled browser error', { message: event.error?.message || event.message, source: event.filename, line: event.lineno, column: event.colno });
    const onRejection = (event) => diagnostic('error', 'WINDOW', 'Unhandled promise rejection', { reason: event.reason?.message || String(event.reason) });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const period = useMemo(() => nearestPeriod(age), [age]);
  const keyframeAge = useMemo(() => keyframeAgeFor(age), [age]);

  const quakeFilteredEvents = useMemo(() => {
    const minimumMagnitude = Number(quakeMinMagnitude);
    return quakeEvents.filter((event) => {
      const magnitude = Number(event?.properties?.mag);
      if (Number.isFinite(minimumMagnitude) && Number.isFinite(magnitude) && magnitude < minimumMagnitude) return false;
      if (quakeRegion !== 'world' && earthquakeRegionForEvent(event) !== quakeRegion) return false;
      const text = quakeSearch.trim().toLowerCase();
      if (text && !String(event?.properties?.place || '').toLowerCase().includes(text)) return false;
      return true;
    });
  }, [quakeEvents, quakeMinMagnitude, quakeRegion, quakeSearch]);

  const quakeSortedEvents = useMemo(() => {
    const sorted = [...quakeFilteredEvents];
    sorted.sort((a, b) => {
      if (quakeSort === 'largest') {
        const magnitudeDifference = Number(b?.properties?.mag ?? -Infinity) - Number(a?.properties?.mag ?? -Infinity);
        if (magnitudeDifference) return magnitudeDifference;
      }
      return Number(b?.properties?.time || 0) - Number(a?.properties?.time || 0);
    });
    return sorted;
  }, [quakeFilteredEvents, quakeSort]);


  const quakeMapEvents = quakeSortedEvents.slice(0, 5000);
  const quakeListEvents = quakeSortedEvents.slice(0, 100);

  const quakeWorldMapPaths = useMemo(() => countries
    .map((country) => ({
      id: countryKey(country),
      name: country.properties?.name || countryKey(country),
      d: geoGeometryToEquirectangularPath(country.geometry),
    }))
    .filter((country) => country.d), [countries]);

  const volcanoSitesWithAlerts = useMemo(() => volcanoSites.map((site) => {
    const alert = volcanoAlerts.find((item) =>
      (site.number && String(item.vnum) === String(site.number))
      || (item.volcano_name && site.name && String(item.volcano_name).trim().toLowerCase() === site.name.trim().toLowerCase())
    ) || null;
    return { ...site, alert };
  }), [volcanoSites, volcanoAlerts]);

  const volcanoAlertRows = useMemo(() => volcanoAlerts.map((alert) => {
    const site = volcanoSitesWithAlerts.find((item) =>
      (item.number && String(item.number) === String(alert.vnum))
      || (item.name && alert.volcano_name && item.name.toLowerCase() === String(alert.volcano_name).toLowerCase())
    ) || null;
    return {
      id: 'usgs-alert-' + String(alert.notice_identifier || alert.vnum || alert.volcano_name),
      type: 'alert',
      name: alert.volcano_name || site?.name || 'USGS monitored volcano',
      country: site?.country || alert.obs_fullname || 'United States monitoring network',
      longitude: site?.longitude,
      latitude: site?.latitude,
      date: Number(alert.sent_unixtime) * 1000 || Date.parse(alert.sent_utc) || Date.now(),
      alertLevel: alert.alert_level || 'Alert level unavailable',
      colorCode: alert.color_code || '',
      source: 'USGS Volcano Hazards Program',
      url: alert.notice_url || 'https://volcanoes.usgs.gov/hans-public/',
      site,
    };
  }), [volcanoAlerts, volcanoSitesWithAlerts]);

  const volcanoActivityRows = useMemo(() => [
    ...eruptionEvents.map((event) => ({ ...event, type: 'activity' })),
    ...volcanoAlertRows,
  ].filter((event) => {
    const query = quakeSearch.trim().toLowerCase();
    if (!query) return true;
    return (event.name + ' ' + (event.country || '') + ' ' + (event.description || '') + ' ' + (event.alertLevel || '')).toLowerCase().includes(query);
  }).sort((a, b) => Number(b.date || 0) - Number(a.date || 0)), [eruptionEvents, volcanoAlertRows, quakeSearch]);

  const volcanoMapPoints = useMemo(() => {
    const points = [];
    const query = quakeSearch.trim().toLowerCase();
    const matchesQuery = (item) => !query || (item.name + ' ' + (item.country || '') + ' ' + (item.region || '')).toLowerCase().includes(query);

    if (showAllVolcanoSites) {
      volcanoSitesWithAlerts.filter(matchesQuery).forEach((site) => {
        points.push({ ...site, id: 'volcano-site-' + site.id, type: 'site' });
      });
    }
    if (showUSGSVolcanoAlerts && !showAllVolcanoSites) {
      volcanoAlertRows.filter((alert) => Number.isFinite(alert.longitude) && Number.isFinite(alert.latitude)).filter(matchesQuery).forEach((alert) => {
        points.push({ ...alert, id: 'volcano-alert-point-' + alert.id, type: 'alert' });
      });
    }
    if (showReportedActivity) {
      eruptionEvents.filter(matchesQuery).forEach((event) => {
        points.push({ ...event, id: 'volcano-activity-' + event.id, type: 'activity' });
      });
    }
    return points.filter((point) => Number.isFinite(Number(point.longitude)) && Number.isFinite(Number(point.latitude)));
  }, [volcanoSitesWithAlerts, volcanoAlertRows, eruptionEvents, showAllVolcanoSites, showUSGSVolcanoAlerts, showReportedActivity, quakeSearch]);


  const visibleEvents = useMemo(() => EVENTS.filter((event) => Math.abs(event.ma - age) < 95), [age]);
  const historicalCoastlinePaths = useMemo(
    () => age >= 0.1 ? reconstructedCoastlinePaths(land) : [],
    [age, land]
  );
  const globePaths = useMemo(() => [
    ...countryBoundaries.map((path) => ({ ...path, age })),
    ...historicalCoastlinePaths,
    ...(plateMode ? PLATE_BOUNDARIES.map((path) => ({ kind: 'plate', ...path })) : []),
  ], [age, countryBoundaries, historicalCoastlinePaths, plateMode]);

  const countryResults = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    if (!query) return [];
    return countries
      .filter((country) => (country.properties?.name || '').toLowerCase().includes(query))
      .slice(0, 8);
  }, [countrySearch, countries]);

  const globePolygons = useMemo(() => [
    ...land.map((feature) => ({ ...feature, __layer: 'land' })),
    ...trackedCountryLand.map((feature) => ({ ...feature, __layer: 'tracked' })),
  ], [land, trackedCountryLand]);

  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const periodResults = PERIODS.filter((item) => (item.label + ' ' + item.era).toLowerCase().includes(query)).slice(0, 4).map((item) => ({ type: 'period', ...item }));
    const eventResults = EVENTS.filter((item) => (item.name + ' ' + item.tag + ' ' + item.summary).toLowerCase().includes(query)).slice(0, 4).map((item) => ({ type: 'event', ...item }));
    const plateResults = PLATES.filter((item) => (item.name + ' ' + item.code + ' ' + item.summary).toLowerCase().includes(query)).slice(0, 4).map((item) => ({ type: 'plate', ...item }));
    return [...periodResults, ...eventResults, ...plateResults].slice(0, 8);
  }, [search]);


  useEffect(() => {
    if (systemSelected !== 'phivolcs') return;
    let cancelled = false;
    let controller = null;
    let refreshTimer = null;

    const fetchEarthquakes = async (isInitial = false) => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      if (isInitial || quakeEvents.length === 0) setQuakeLoading(true);

      try {
        const response = await fetch(USGS_EARTHQUAKE_FEEDS[quakeRange] || USGS_EARTHQUAKE_FEEDS.day, {
          cache: 'no-store',
          signal: requestController.signal,
          headers: { Accept: 'application/geo+json, application/json;q=0.9' },
        });
        if (!response.ok) throw new Error('USGS earthquake feed returned HTTP ' + response.status);
        const collection = await response.json();
        const received = Array.isArray(collection?.features) ? collection.features : [];
        const validEvents = received.filter((event) => {
          const coordinates = event?.geometry?.coordinates;
          return Array.isArray(coordinates)
            && coordinates.length >= 3
            && Number.isFinite(Number(coordinates[0]))
            && Number.isFinite(Number(coordinates[1]))
            && Number.isFinite(Number(event?.properties?.time))
            && Number.isFinite(Number(event?.properties?.mag));
        });

        if (cancelled || requestController.signal.aborted) return;
        setQuakeEvents(validEvents);
        setQuakeUpdatedAt(Date.now());
        setQuakeError('');
        diagnostic('info', 'QUAKES', 'Global earthquake feed refreshed', {
          range: quakeRange,
          received: received.length,
          validEvents: validEvents.length,
          feedGeneratedAt: collection?.metadata?.generated || null,
          source: 'USGS GeoJSON summary feed',
        });
      } catch (error) {
        if (cancelled || requestController.signal.aborted || error?.name === 'AbortError') return;
        setQuakeError(error?.message || 'Unable to load the global earthquake feed.');
        diagnostic('error', 'QUAKES', 'Global earthquake feed refresh failed', {
          range: quakeRange,
          message: error?.message || String(error),
        });
      } finally {
        if (!cancelled && !requestController.signal.aborted) setQuakeLoading(false);
      }
    };

    fetchEarthquakes(true);
    if (quakeAutoRefresh) {
      refreshTimer = window.setInterval(() => fetchEarthquakes(false), QUAKE_REFRESH_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      controller?.abort();
      if (refreshTimer) window.clearInterval(refreshTimer);
    };
  }, [systemSelected, quakeRange, quakeAutoRefresh, quakeRefreshNonce]);


  useEffect(() => {
    if (systemSelected !== 'phivolcs' || volcanoSitesLoadedRef.current || volcanoSites.length > 0) return;
    let cancelled = false;
    const controller = new AbortController();

    const loadVolcanoCatalogue = async () => {
      setVolcanoLoading(true);
      try {
        const url = new URL(SMITHSONIAN_VOLCANO_WFS_URL);
        url.searchParams.set('service', 'WFS');
        url.searchParams.set('version', '2.0.0');
        url.searchParams.set('request', 'GetFeature');
        url.searchParams.set('typeNames', 'GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes');
        url.searchParams.set('outputFormat', 'application/json');
        url.searchParams.set('count', '2000');

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/json, application/geo+json;q=0.9' },
        });
        if (!response.ok) throw new Error('Smithsonian volcano catalogue returned HTTP ' + response.status);
        const collection = await response.json();
        const features = Array.isArray(collection?.features) ? collection.features : [];
        const sites = features.map((feature, index) => {
          const properties = feature.properties || {};
          const coordinates = feature.geometry?.coordinates || [];
          const longitude = Number(coordinates[0]);
          const latitude = Number(coordinates[1]);
          const number = getVolcanoProperty(properties, ['volcano_nu', 'volcano_number', 'vnum']);
          const name = getVolcanoProperty(properties, ['volcano_na', 'volcano_name', 'primary_vo', 'name']);
          const country = getVolcanoProperty(properties, ['country']);
          const region = getVolcanoProperty(properties, ['region']);
          const lastEruption = getVolcanoProperty(properties, ['last_erupt', 'last_eruption_year']);
          const volcanoType = getVolcanoProperty(properties, ['primary_volcano_type', 'volcano_type', 'type']);
          return {
            id: String(number || feature.id || index),
            number: number == null ? '' : String(number),
            name: String(name || 'Unnamed volcano'),
            country: String(country || ''),
            region: String(region || ''),
            lastEruption: lastEruption == null ? 'Unknown' : String(lastEruption),
            volcanoType: volcanoType == null ? 'Type not specified' : String(volcanoType),
            longitude,
            latitude,
            url: number ? 'https://volcano.si.edu/volcano.cfm?vn=' + encodeURIComponent(String(number)) : 'https://volcano.si.edu/',
          };
        }).filter((site) =>
          site.name !== 'Unnamed volcano'
          && Number.isFinite(site.longitude) && Number.isFinite(site.latitude)
          && Math.abs(site.longitude) <= 180 && Math.abs(site.latitude) <= 90
        );

        if (cancelled || controller.signal.aborted) return;
        setVolcanoSites(sites);
        volcanoSitesLoadedRef.current = sites.length > 0;
        diagnostic('info', 'VOLCANO', 'Smithsonian Global Volcanism Program catalogue loaded', {
          source: 'Smithsonian Global Volcanism Program WFS',
          returnedFeatures: features.length,
          usableVolcanoes: sites.length,
        });
        if (!sites.length) throw new Error('The Smithsonian service returned no usable volcano coordinates.');
      } catch (error) {
        if (cancelled || controller.signal.aborted || error?.name === 'AbortError') return;
        setVolcanoError((existing) => existing || ('Volcano catalogue unavailable: ' + (error?.message || String(error))));
        diagnostic('error', 'VOLCANO', 'Could not load the Smithsonian volcano catalogue', { message: error?.message || String(error) });
      } finally {
        if (!cancelled && !controller.signal.aborted) setVolcanoLoading(false);
      }
    };

    loadVolcanoCatalogue();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [systemSelected, volcanoSites.length]);

  useEffect(() => {
    if (systemSelected !== 'phivolcs') return;
    let cancelled = false;
    let activeController = null;
    let refreshTimer = null;

    const refreshVolcanicReports = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      setVolcanoLoading(true);
      const errors = [];

      const fetchEonet = async () => {
        const response = await fetch(NASA_EONET_VOLCANO_URL, {
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error('NASA EONET returned HTTP ' + response.status);
        const payload = await response.json();
        const events = Array.isArray(payload?.events) ? payload.events : [];
        return events.map((event) => {
          const geometries = [...(event.geometry || [])].sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));
          const latestGeometry = geometries[geometries.length - 1];
          const point = eonetGeometryPoint(latestGeometry);
          if (!point) return null;
          const source = event.sources?.find((item) => item.url) || null;
          return {
            id: String(event.id),
            name: event.title || 'Reported volcanic activity',
            description: event.description || '',
            longitude: point.longitude,
            latitude: point.latitude,
            date: Date.parse(latestGeometry?.date || 0) || null,
            status: event.closed ? 'Closed' : 'Open',
            source: 'NASA Earth Observatory Natural Event Tracker (EONET)',
            url: source?.url || event.link || 'https://eonet.gsfc.nasa.gov/',
            eonetUrl: event.link || '',
            country: '',
          };
        }).filter(Boolean);
      };

      const fetchUSGSAlerts = async () => {
        const response = await fetch(USGS_VOLCANO_ALERTS_URL, {
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error('USGS volcano alert API returned HTTP ' + response.status);
        const payload = await response.json();
        if (!Array.isArray(payload)) throw new Error('USGS volcano alert API returned an unexpected format');
        return payload;
      };

      const [eonetResult, alertResult] = await Promise.allSettled([fetchEonet(), fetchUSGSAlerts()]);
      if (cancelled || controller.signal.aborted) return;

      if (eonetResult.status === 'fulfilled') {
        setEruptionEvents(eonetResult.value);
        diagnostic('info', 'VOLCANO', 'NASA EONET volcanic activity refreshed', {
          source: 'NASA EONET open volcano events',
          events: eonetResult.value.length,
        });
      } else {
        errors.push('NASA eruption/activity feed: ' + (eonetResult.reason?.message || String(eonetResult.reason)));
        diagnostic('error', 'VOLCANO', 'NASA EONET volcanic activity refresh failed', { message: eonetResult.reason?.message || String(eonetResult.reason) });
      }

      if (alertResult.status === 'fulfilled') {
        setVolcanoAlerts(alertResult.value);
        diagnostic('info', 'VOLCANO', 'USGS elevated volcano-alert feed refreshed', {
          source: 'USGS Volcano Hazards Program',
          elevatedAlerts: alertResult.value.length,
          coverage: 'USGS-monitored US volcanoes only',
        });
      } else {
        errors.push('USGS volcano alerts: ' + (alertResult.reason?.message || String(alertResult.reason)));
        diagnostic('error', 'VOLCANO', 'USGS volcano-alert refresh failed', { message: alertResult.reason?.message || String(alertResult.reason) });
      }

      setVolcanoUpdatedAt(Date.now());
      setVolcanoError(errors.join(' · '));
      setVolcanoLoading(false);
    };

    refreshVolcanicReports();
    if (volcanoAutoRefresh) {
      refreshTimer = window.setInterval(refreshVolcanicReports, VOLCANO_REFRESH_INTERVAL_MS);
    }
    return () => {
      cancelled = true;
      activeController?.abort();
      if (refreshTimer) window.clearInterval(refreshTimer);
    };
  }, [systemSelected, volcanoAutoRefresh, volcanoRefreshNonce]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onChange = (event) => setReducedMotion(event.matches);
    media?.addEventListener?.('change', onChange);
    return () => media?.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setStatus('loading');
        diagnostic('info', 'WORLD', 'Loading world atlas', { url: WORLD_URL });
        setStatusText('Loading the land surface…');
        const response = await fetch(WORLD_URL);
        if (!response.ok) throw new Error('World data unavailable');
        const topology = await response.json();
        const feature = topojson.feature(topology, topology.objects.land);
        const countryFeatures = topology.objects.countries
          ? flattenFeatures(topojson.feature(topology, topology.objects.countries))
          : [];
        const countryMesh = topology.objects.countries
          ? topojson.mesh(topology, topology.objects.countries, (a, b) => a !== b)
          : null;
        if (cancelled) return;
        setBaseLand(feature);
        setLand(flattenFeatures(feature));
        setCountries(countryFeatures);
        const boundaries = meshToPaths(countryMesh);
        setCountryBoundaries(boundaries);
        diagnostic('info', 'WORLD', 'World atlas loaded', {
          geometryType: flattenFeatures(feature)[0]?.geometry?.type,
          featureCount: flattenFeatures(feature).length,
          countryFeatureCount: countryFeatures.length,
          countryBoundaryPathCount: boundaries.length,
        });
        setStatus('ready');
        setStatusText('Ready to explore');
      } catch (error) {
        diagnostic('error', 'WORLD', 'World atlas load failed', { name: error?.name, message: error?.message });
        setStatus('error');
        setStatusText('Earth data could not be loaded');
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!baseLand) return;
    let cancelled = false;
    const generation = cacheGenerationRef.current;

    const warm = async () => {
      // Inventory the local cache before testing the remote service. A failed health
      // check must never leave the UI stuck at 0/73 or prevent existing frames loading.
      const manifestKeys = readFrameManifest();
      const storedKeys = await getStoredFrameKeys();
      if (cancelled || generation !== cacheGenerationRef.current) return;
      const manifestOnlyKeys = Array.from(manifestKeys).filter((key) => !storedKeys.has(key));
      const indexOnlyKeys = Array.from(storedKeys).filter((key) => !manifestKeys.has(key));
      indexOnlyKeys.forEach((key) => writeFrameManifestEntry(key));
      if (manifestOnlyKeys.length) {
        diagnostic('warn', 'CACHE', 'LocalStorage manifest contained keys without saved IndexedDB frames; those frames will be rebuilt', {
          missingRecords: manifestOnlyKeys.length,
          examples: manifestOnlyKeys.slice(0, 8),
        });
      }
      let cached = KEYFRAME_AGES.filter((frameAge) => storedKeys.has(frameKey(frameAge))).length;
      setCacheProgress({ cached, total: KEYFRAME_AGES.length });
      diagnostic('info', 'CACHE', 'Local cache inventory checked', {
        indexedDbFrames: storedKeys.size,
        localStorageManifestKeys: manifestKeys.size,
        manifestRepaired: indexOnlyKeys.length,
        cachedKeyframes: cached,
        totalKeyframes: KEYFRAME_AGES.length,
        missing: KEYFRAME_AGES.length - cached,
      });

      const health = await testGplatesConnectivity();
      if (!health.ok) {
        diagnostic('warn', 'CACHE', 'GPlates health check failed; attempting actual keyframe requests anyway', {
          message: health.message,
          retryAfterMs: PRELOAD_FAILURE_PAUSE_MS,
        });
        if (!cancelled && generation === cacheGenerationRef.current) {
          setStatus('warning');
          setStatusText('GPlates check failed · trying keyframe requests');
        }
      } else if (!cancelled && generation === cacheGenerationRef.current) {
        setStatus('ready');
        setStatusText('GPlates connected · building keyframe cache');
      }

      diagnostic('info', 'CACHE', 'Background keyframe preload started', {
        total: KEYFRAME_AGES.length,
        workers: PRELOAD_WORKERS,
        startDelayMs: PRELOAD_START_DELAY_MS,
        strategy: 'two-worker throttled coastline requests',
      });
      const missing = KEYFRAME_AGES.filter((frameAge) => !storedKeys.has(frameKey(frameAge)));
      let cursor = 0;
      let consecutiveFailures = 0;
      const retryQueue = [];
      const retryCounts = new Map();
      const ordered = [...missing].sort((a, b) => {
        const aPriority = a <= PRIORITY_KEYFRAMES * KEYFRAME_STEP ? 0 : 1;
        const bPriority = b <= PRIORITY_KEYFRAMES * KEYFRAME_STEP ? 0 : 1;
        return aPriority - bPriority || a - b;
      });

      const worker = async () => {
        while (!cancelled && generation === cacheGenerationRef.current) {
          if (consecutiveFailures >= PRELOAD_WORKERS) {
            diagnostic('warn', 'CACHE', 'Background preload paused after repeated network failures', { pauseMs: PRELOAD_FAILURE_PAUSE_MS, consecutiveFailures });
            await sleep(PRELOAD_FAILURE_PAUSE_MS);
            consecutiveFailures = 0;
          }
          let frameAge = retryQueue.shift();
          if (frameAge === undefined) {
            frameAge = ordered[cursor++];
          }
          if (frameAge === undefined) return;

          while (!cancelled && generation === cacheGenerationRef.current && foregroundLoadingRef.current) {
            await sleep(40);
          }
          if (cancelled || generation !== cacheGenerationRef.current) return;

          const key = frameKey(frameAge);
          const preloadController = new AbortController();
          preloadControllersRef.current.add(preloadController);

          try {
            let features = frameCacheRef.current.get(key);
            let loadedFromPersistentStore = false;
            if (!features) {
              features = await getStoredFrame(frameAge);
              loadedFromPersistentStore = Boolean(features);
            }

            if (!features) {
              features = await fetchReconstructionWithRetry(frameAge, preloadController.signal);
              if (cancelled || generation !== cacheGenerationRef.current) return;
            }

            let persistedFrame = loadedFromPersistentStore;
            if (!loadedFromPersistentStore) {
              // Retry the IndexedDB write without refetching the potentially expensive frame.
              for (let saveAttempt = 1; saveAttempt <= 3 && !persistedFrame; saveAttempt += 1) {
                persistedFrame = await putStoredFrame(frameAge, features);
                if (!persistedFrame && saveAttempt < 3) await sleep(180 * saveAttempt);
              }
            }

            if (cancelled || generation !== cacheGenerationRef.current) return;
            frameCacheRef.current.set(key, features);
            consecutiveFailures = 0;
            if (persistedFrame) {
              cached += 1;
              diagnostic('info', 'CACHE', 'Background keyframe ready and durably saved', {
                age: frameAge,
                source: loadedFromPersistentStore ? 'IndexedDB' : 'network then IndexedDB',
                progress: Math.min(cached, KEYFRAME_AGES.length) + '/' + KEYFRAME_AGES.length,
              });
              setCacheProgress({ cached: Math.min(cached, KEYFRAME_AGES.length), total: KEYFRAME_AGES.length });
            } else {
              diagnostic('error', 'CACHE', 'Keyframe loaded for this session but could not be persisted after three write attempts', {
                age: frameAge,
                key,
                features: features.length,
              });
              setStatus('warning');
              setStatusText('Some keyframes are memory-only · local cache write failed');
            }
          } catch (error) {
            if (!cancelled && generation === cacheGenerationRef.current) {
              if (error?.name !== 'AbortError') consecutiveFailures += 1;
              const attempts = (retryCounts.get(frameAge) || 0) + 1;
              retryCounts.set(frameAge, attempts);
              if (attempts <= FRAME_REQUEST_RETRIES) {
                retryQueue.push(frameAge);
              } else {
                diagnostic('error', 'CACHE', 'Skipping keyframe after retries', { age: frameAge, attempts, message: error?.message });
              }
            }
          } finally {
            preloadControllersRef.current.delete(preloadController);
          }
        }
      };

      await Promise.all(Array.from({ length: PRELOAD_WORKERS }, () => worker()));
    };

    // Start immediately; the app no longer waits for an idle callback.
    const start = window.setTimeout(() => warm(), PRELOAD_START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [baseLand, cacheGeneration]);

  useEffect(() => {
    if (!baseLand || status === 'error') return;
    const currentRequest = ++requestRef.current;
    const controller = new AbortController();
    const targetAge = keyframeAge; 
    const delay = isPlaying ? 0 : reducedMotion ? 20 : 0;

    const timer = window.setTimeout(async () => {
      diagnostic('info', 'UI', 'Foreground keyframe requested', { age, keyframeAge: targetAge, playing: isPlaying });
      foregroundLoadingRef.current = true;
      const foregroundRequestId = ++foregroundRequestRef.current;
      for (const controller of preloadControllersRef.current) controller.abort();
      preloadControllersRef.current.clear();

      if (age < 0.05) {
        frameCacheRef.current.set(frameKey(0), flattenFeatures(baseLand));
        setLand(flattenFeatures(baseLand));
        setStatus('ready');
        setStatusText('Present day reference · local frame · cache resumed');
        if (foregroundRequestRef.current === foregroundRequestId) foregroundLoadingRef.current = false;
        return;
      }

      const key = frameKey(targetAge);
      try {
        setStatus('loading');
        setStatusText('Loading ' + shortAge(targetAge) + ' keyframe…');

        let features = frameCacheRef.current.get(key);
        if (!features) {
          features = await getStoredFrame(targetAge);
          if (features) {
            frameCacheRef.current.set(key, features);
            diagnostic('info', 'CACHE', 'Foreground keyframe cache hit', { age: targetAge });
          }
        }

        let persistenceFailed = false;
        if (!features) {
          const cachedEntries = Array.from(frameCacheRef.current.entries())
            .map(([cacheKey, cachedFeatures]) => ({ age: Number(String(cacheKey).split(':').at(-1)), features: cachedFeatures }))
            .filter((entry) => Number.isFinite(entry.age) && entry.features?.length);
          const nearestCached = cachedEntries.length
            ? cachedEntries.reduce((nearest, entry) => Math.abs(entry.age - targetAge) < Math.abs(nearest.age - targetAge) ? entry : nearest, cachedEntries[0])
            : null;
          if (nearestCached) {
            setLand(nearestCached.features);
            diagnostic('info', 'FRAME', 'Nearest cached geometry shown while target loads', { targetAge, fallbackAge: nearestCached.age });
          }
          setStatusText('Loading ' + shortAge(targetAge) + ' reconstruction…');
          features = await fetchReconstructionWithRetry(targetAge, controller.signal);
          if (currentRequest !== requestRef.current) return;
          frameCacheRef.current.set(key, features);
          const persisted = await putStoredFrame(targetAge, features);
          persistenceFailed = !persisted;
        }

        if (currentRequest !== requestRef.current) return;
        setLand(features);
        if (persistenceFailed) {
          setStatus('warning');
          setStatusText(shortAge(targetAge) + ' loaded · browser could not save keyframe');
        } else {
          setStatus('ready');
          setStatusText(shortAge(targetAge) + ' keyframe · local cache resumed');
        }
      } catch (error) {
        if (currentRequest !== requestRef.current || error?.name === 'AbortError') return;
        console.warn('Reconstruction unavailable after retries; keeping last valid geometry.', error);
        setStatus('warning');
        setStatusText(shortAge(targetAge) + ' keyframe could not be loaded — retry by scrubbing again');
      } finally {
        if (foregroundRequestRef.current === foregroundRequestId) {
          foregroundLoadingRef.current = false;
        }
      }
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyframeAge, baseLand, isPlaying, reducedMotion]);

  useEffect(() => {
    trackedCountryRequestRef.current += 1;
    const requestId = trackedCountryRequestRef.current;
    const controller = new AbortController();

    if (!trackedCountry) {
      setTrackedCountryLand([]);
      setTrackedCountryStatus('idle');
      setTrackedCountryProgress({ completed: 0, total: 0 });
      return () => controller.abort();
    }

    const targetAge = keyframeAge;
    const name = trackedCountry.properties?.name || countryKey(trackedCountry);
    const cacheKey = countryCacheKey(trackedCountry, targetAge);
    const partialBatches = new Map();

    // Clear the old frame immediately. Never leave a present-day USA (or a prior-age
    // reconstruction) painted at the wrong coordinates while the new age loads.
    setTrackedCountryLand([]);
    setTrackedCountryStatus('loading');
    setTrackedCountryProgress({ completed: 0, total: 0 });
    diagnostic('info', 'COUNTRY', 'Tracking country selected for this keyframe', {
      country: name,
      id: countryKey(trackedCountry),
      displayedAge: age,
      reconstructionKeyframe: targetAge,
    });

    const publishBatch = (batchFeatures, batchIndex, totalBatches) => {
      if (controller.signal.aborted || requestId !== trackedCountryRequestRef.current) return;
      partialBatches.set(batchIndex, batchFeatures);
      const visibleFeatures = Array.from(partialBatches.entries())
        .sort((a, b) => a[0] - b[0])
        .flatMap((entry) => entry[1]);
      setTrackedCountryLand(visibleFeatures);
      setTrackedCountryProgress({ completed: partialBatches.size, total: totalBatches });
      diagnostic('info', 'COUNTRY', 'Ancestral territory batch displayed', {
        country: name,
        age: targetAge,
        batch: (batchIndex + 1) + '/' + totalBatches,
        highlightedPieces: visibleFeatures.length,
      });
    };

    const load = async () => {
      try {
        if (targetAge < 0.1) {
          setTrackedCountryLand([{
            ...trackedCountry,
            properties: { ...(trackedCountry.properties || {}), trackedCountry: name },
            __layer: 'tracked',
          }]);
          setTrackedCountryStatus('ready');
          setTrackedCountryProgress({ completed: 1, total: 1 });
          diagnostic('info', 'COUNTRY', 'Using exact present-day country geometry', { country: name });
          return;
        }

        let features = trackedCountryCacheRef.current.get(cacheKey);
        let source = 'memory';
        if (!features) {
          features = await getStoredCountryFrame(cacheKey);
          source = 'IndexedDB';
        }

        if (controller.signal.aborted || requestId !== trackedCountryRequestRef.current) return;

        if (features?.length) {
          trackedCountryCacheRef.current.set(cacheKey, features);
          setTrackedCountryLand(features);
          setTrackedCountryStatus('ready');
          setTrackedCountryProgress({ completed: 1, total: 1 });
          diagnostic('info', 'COUNTRY', 'Tracked ancestral territory restored from local cache', {
            country: name,
            age: targetAge,
            source,
            features: features.length,
          });
          return;
        }

        features = await fetchCountryReconstructionWithRetry(
          trackedCountry,
          targetAge,
          controller.signal,
          publishBatch
        );

        if (controller.signal.aborted || requestId !== trackedCountryRequestRef.current) return;
        trackedCountryCacheRef.current.set(cacheKey, features);
        setTrackedCountryLand(features);
        setTrackedCountryProgress((previous) => ({
          completed: previous.total || 1,
          total: previous.total || 1,
        }));
        setTrackedCountryStatus('ready');

        const persisted = await putStoredCountryFrame(cacheKey, features, name);
        if (!persisted) {
          diagnostic('warn', 'COUNTRY', 'Reconstruction is visible but could not be saved to the browser-local country cache', {
            country: name,
            age: targetAge,
            features: features.length,
          });
        }
        diagnostic('info', 'COUNTRY', 'Tracked country geometry displayed', {
          country: name,
          age: targetAge,
          features: features.length,
          persisted,
        });
      } catch (error) {
        if (requestId !== trackedCountryRequestRef.current || error?.name === 'AbortError') return;
        const partialCount = Array.from(partialBatches.values()).reduce((total, batch) => total + batch.length, 0);
        setTrackedCountryStatus(partialCount > 0 ? 'partial' : 'error');
        diagnostic('error', 'COUNTRY', partialCount > 0
          ? 'Some ancestral territory pieces loaded, but one or more reconstruction batches failed'
          : 'Country reconstruction failed; no stale geometry will be shown', {
          country: name,
          age: targetAge,
          partialFeatures: partialCount,
          message: error?.message,
        });
      }
    };

    load();
    return () => controller.abort();
  }, [trackedCountry, keyframeAge]);

  useEffect(() => {
    if (!globeRef.current) return;
    const controls = globeRef.current.controls();
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.38;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 155;
    controls.maxDistance = 340;
    controls.enablePan = false;
  }, [autoRotate]);

  useEffect(() => {
    if (!isPlaying) return;

    const startAge = age;
    if (startAge <= 0) {
      setIsPlaying(false);
      setDirection('Present day');
      return;
    }

    playbackPreloadControllerRef.current?.abort();
    const controller = new AbortController();
    playbackPreloadControllerRef.current = controller;

    const upcoming = KEYFRAME_AGES
      .filter((frameAge) => frameAge < keyframeAge && frameAge >= 0)
      .sort((a, b) => b - a)
      .slice(0, 10);

    (async () => {
      diagnostic('info', 'PLAY', 'Forward playback preload started', {
        fromAge: startAge,
        direction: 'toward present',
        keyframes: upcoming,
      });

      for (const frameAge of upcoming) {
        if (controller.signal.aborted) return;
        const key = frameKey(frameAge);
        let features = frameCacheRef.current.get(key);
        if (!features) features = await getStoredFrame(frameAge);

        if (!features) {
          try {
            features = await fetchReconstructionWithRetry(frameAge, controller.signal);
            if (controller.signal.aborted) return;
            await putStoredFrame(frameAge, features);
          } catch (error) {
            if (error?.name === 'AbortError') return;
            diagnostic('warn', 'PLAY', 'Playback prefetch failed', { age: frameAge, message: error?.message });
            continue;
          }
        }

        frameCacheRef.current.set(key, features);
        diagnostic('info', 'PLAY', 'Playback frame ready', { age: frameAge });
      }
    })();

    const interval = window.setInterval(() => {
      setAge((previous) => {
        const next = Math.max(0, previous - PLAYBACK_STEP);
        setDirection(next < previous ? 'Toward the present' : 'Present day');
        if (next <= 0) setIsPlaying(false);
        return next;
      });
    }, reducedMotion ? 320 : 180);

    return () => {
      window.clearInterval(interval);
      controller.abort();
      if (playbackPreloadControllerRef.current === controller) playbackPreloadControllerRef.current = null;
    };
  }, [isPlaying, reducedMotion]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  }, [reducedMotion]);

  useEffect(() => {
    if (systemSelected !== 'mass-space') return;
    const onKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setMassPlanetIndex((index) => Math.max(0, index - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setMassPlanetIndex((index) => Math.min(SOLAR_SYSTEM_PLANETS.length, index + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [systemSelected]);

  const resetFrames = async () => {
    if (isResettingCache) return;
    diagnostic('warn', 'UI', 'User requested cache reset');
    setIsResettingCache(true);
    setIsPlaying(false);
    cacheGenerationRef.current += 1;
    setCacheProgress({ cached: 1, total: KEYFRAME_AGES.length });
    frameCacheRef.current.clear();
    for (const controller of preloadControllersRef.current) controller.abort();
    preloadControllersRef.current.clear();

    try {
      await clearStoredFrames();
      setStatus('loading');
      setStatusText('Keyframe cache reset · rebuilding in the background…');
    } finally {
      setIsResettingCache(false);
      setCacheGeneration((value) => value + 1);
      setLand(flattenFeatures(baseLand));
      setTrackedCountryLand(trackedCountry ? [{
        ...trackedCountry,
        properties: { ...(trackedCountry.properties || {}), trackedCountry: trackedCountry.properties?.name || countryKey(trackedCountry) },
        __layer: 'tracked',
      }] : []);
      setTrackedCountryStatus(trackedCountry ? 'ready' : 'idle');
      setTrackedCountryProgress(trackedCountry ? { completed: 1, total: 1 } : { completed: 0, total: 0 });
      setAge(0);
    }
  };

  const focus = (lat, lng, altitude = 1.7) => {
    globeRef.current?.pointOfView({ lat, lng, altitude }, reducedMotion ? 0 : 850);
  };

  const selectResult = (result) => {
    setSearch('');
    if (result.type === 'period') {
      setDirection(result.ma > age ? 'Into the past' : 'Toward the present');
      setAge(result.ma);
      setSelected({ kind: 'period', title: result.label, kicker: result.era + ' · ' + shortAge(result.ma), summary: result.description, body: 'Geological time is measured in millions of years before present. Use this point as a visual anchor, then move a little earlier or later to watch the surrounding reconstruction change.' });
      return;
    }
    if (result.type === 'event') {
      setDirection(result.ma > age ? 'Into the past' : 'Toward the present');
      setAge(result.ma);
      focus(result.lat, result.lng, 1.8);
      setSelected({ kind: 'event', title: result.name, kicker: result.tag + ' · ' + shortAge(result.ma), summary: result.summary, body: 'The marker is a navigation aid, not a claim that the event occurred at one exact point. Geological reconstructions are model-dependent and increasingly approximate further back in time.' });
      return;
    }
    setSelected({ kind: 'plate', title: result.name, kicker: 'Tectonic plate · ' + result.code, summary: result.summary, body: 'Plate boundaries are shown as a simplified educational overlay. The network is designed to be readable rather than a complete GIS dataset.' });
    focus(result.lat, result.lng, 1.65);
    setPlateMode(true);
  };

  const jumpToEvent = (event) => {
    setDirection(event.ma > age ? 'Into the past' : 'Toward the present');
    setAge(event.ma);
    focus(event.lat, event.lng, 1.75);
    setSelected({ kind: 'event', title: event.name, kicker: event.tag + ' · ' + shortAge(event.ma), summary: event.summary, body: 'This marker is intended as a discovery prompt. The model and age are approximate where the underlying geology is uncertain.' });
  };

  const selectCountry = (country) => {
    const name = country.properties?.name || countryKey(country);
    const centroid = featureCentroid(country);
    setTrackedCountry(country);
    setCountrySearch('');
    setSelected({
      kind: 'country',
      title: name,
      kicker: 'Tracking · ancestral land',
      summary: 'The pink land follows the separate polygon fragments that make up this country today as GPlates reconstructs their movement through geological time.',
      body: 'Modern political borders did not exist in deep time. This feature tracks the underlying land fragments, assigning each polygon separately so fragments that sit on different tectonic plates can move independently. Results depend on the reconstruction model and its data coverage.',
    });
    focus(centroid.lat, centroid.lng, 1.55);
    diagnostic('info', 'COUNTRY', 'Country tracking enabled', { country: name, id: countryKey(country) });
  };

  const clearTrackedCountry = () => {
    if (trackedCountry) {
      diagnostic('info', 'COUNTRY', 'Country tracking disabled', { country: trackedCountry.properties?.name || countryKey(trackedCountry) });
    }
    setTrackedCountry(null);
    setTrackedCountryLand([]);
  };

  const handleAge = (value) => {
    const next = Number(value);
    setDirection(next > age ? 'Into the past' : 'Toward the present');
    setAge(next);
    setIsPlaying(false);
  };

  const openSystemTerminal = (systemId) => {
    const target = SYSTEM_CATALOG[systemId] ? systemId : 'past-globe';
    setTerminalTargetSystem(target);
    setTerminalOpen(true);
    setTerminalUnlocked(true);
    setTerminalSessionToken(null);
    setTerminalPasswordInput('');
    setTerminalPasswordError('');
    setTerminalAuthenticating(false);
    setTerminalCommandInput('');
    setTerminalLines([
      { kind: 'system', text: '--- EARTH SYSTEMS DIAGNOSTIC CONSOLE ---' },
      { kind: 'system', text: 'Target: ' + SYSTEM_CATALOG[target].name },
      { kind: 'system', text: 'Read-only diagnostic console ready. No administrative commands are available.' },
      { kind: 'system', text: 'This is a diagnostic simulator console, not an operating-system shell.' },
    ]);
    setGplatesTestState('idle');
  };

  const openSystem = (systemId) => {
    const target = SYSTEM_CATALOG[systemId] ? systemId : 'past-globe';
    if (!systemAvailability[target]) {
      setSystemAvailabilityNotice(SYSTEM_CATALOG[target].name + ' is NOT CURRENTLY AVAILABLE.');
      return;
    }
    setSystemAvailabilityNotice('');
    setSystemSelected(target);
    if (target === 'plate-lab') setLabInitialBoundaryName(null);
  };
  const copySystemLink = async (systemId) => {
    const query = Object.entries(DIRECT_SYSTEM_LINKS).find(([, id]) => id === systemId)?.[0];
    if (!query || !systemAvailability[systemId]) return;
    const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
    const link = window.location.origin + cleanPath + '?' + query;
    try {
      await navigator.clipboard.writeText(link);
      setSystemLinksCopied(true);
      window.setTimeout(() => setSystemLinksCopied(false), 2200);
    } catch {
      setSystemAvailabilityNotice('Clipboard access was blocked by the browser. Try copying the link from a secure browser context.');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const directQuery = Object.keys(DIRECT_SYSTEM_LINKS).find((query) => params.has(query));
    if (directQuery) {
      // Remove the one-time launch parameter after choosing the system. Refreshing
      // the clean URL therefore returns to the system chooser.
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }
  }, []);


  const submitTerminalPassword = (event) => {
    event.preventDefault();
    terminalWrite('This terminal is a local diagnostic console. System availability is configured in SYSTEM_CATALOG in src/main.jsx.', 'system');
  };

  const terminalWrite = (text, kind = 'output') => {
    setTerminalLines((previous) => [...previous, { kind, text: String(text) }].slice(-180));
  };

  const resolveSystemAlias = (rawAlias) => {
    const alias = String(rawAlias || '').trim().toLowerCase();
    if (!alias) return terminalTargetSystem;
    const normalised = alias.replaceAll('_', '-').replaceAll(' ', '-');
    const entry = Object.entries(SYSTEM_CATALOG).find(([id, details]) =>
      id === normalised || details.name.toLowerCase() === alias
      || (id === 'phivolcs' && ['monitor', 'volcano-monitor', 'seismic-monitor'].includes(normalised))
      || (id === 'plate-lab' && ['tectonics', 'plate-tectonics', 'lab'].includes(normalised))
      || (id === 'mass-space' && ['mass', 'space'].includes(normalised))
      || (id === 'past-globe' && ['globe', 'pastglobe'].includes(normalised))
    );
    return entry?.[0] || null;
  };

  const submitTerminalCommand = async (event) => {
    event.preventDefault();
    if (!terminalUnlocked) return;
    const command = terminalCommandInput.trim();
    if (!command) return;
    setTerminalCommandInput('');
    setTerminalLines((previous) => [...previous, { kind: 'command', text: 'charlie@earthsystems:~$ ' + command }].slice(-180));
    const lower = command.toLowerCase();

    if (lower === 'help' || lower === 'help sudo') {
      terminalWrite([
        'SUPPORTED COMMANDS',
        '  help                 Show this command list',
        '  status               Show whether each system is available',
        '  ls                   List system identifiers',
        '  whoami               Show the console user',
        '  clear                Clear console output',
        '  exit                 Close the terminal',
        '  snapshot             Show a read-only runtime summary',
        '  testgplates          Test GPlates service connectivity',
        '  logs                 Show recent diagnostic log entries',
        '',
        'This console is read-only. Administrative and system-control commands are disabled.',
      ].join('\n'));
      return;
    }
    if (lower === 'whoami') {
      terminalWrite('charlie · authenticated console session');
      return;
    }
    if (lower === 'ls' || lower === 'systems') {
      terminalWrite(Object.entries(SYSTEM_CATALOG).map(([id, item]) =>
        id + (systemAvailability[id] ? '  [AVAILABLE]' : '  [NOT CURRENTLY AVAILABLE]') + '  — ' + item.name
      ).join('\n'));
      return;
    }
    if (lower === 'status') {
      terminalWrite(Object.entries(SYSTEM_CATALOG).map(([id, item]) =>
        item.name + ': ' + (systemAvailability[id] ? 'AVAILABLE' : 'NOT CURRENTLY AVAILABLE')
      ).join('\n'));
      return;
    }
    if (lower === 'clear' || lower === 'cls') {
      setTerminalLines([{ kind: 'system', text: 'Console cleared.' }]);
      return;
    }
    if (lower === 'exit' || lower === 'logout') {
      setTerminalOpen(false);
      setTerminalUnlocked(false);
      setTerminalSessionToken(null);
      return;
    }

    if (lower === 'snapshot') {
      const snapshot = {
        target: terminalTargetSystem,
        availability: systemAvailability,
        age,
        keyframeAge,
        model: modelForAge(keyframeAge),
        cache: cacheProgress.cached + '/' + cacheProgress.total,
        online: navigator.onLine,
        indexedDB: 'indexedDB' in window,
        viewport: window.innerWidth + 'x' + window.innerHeight,
      };
      diagnostic('info', 'SYSTEM', 'Runtime snapshot', snapshot);
      terminalWrite(JSON.stringify(snapshot, null, 2));
      return;
    }
    if (lower === 'testgplates') {
      terminalWrite('Testing GPlates connectivity…');
      const result = await testGplatesConnectivity();
      terminalWrite('GPlates connectivity: ' + (result.ok ? 'PASSED' : 'FAILED') + (result.message ? ' — ' + result.message : ''), result.ok ? 'success' : 'error');
      return;
    }
    if (lower === 'logs') {
      terminalWrite(diagnosticLines.slice(-80).join('\\n') || 'No diagnostic log entries yet.');
      return;
    }
    if (lower.startsWith('sudo ')) {
      terminalWrite('READ ONLY: administrative commands are disabled. Use status, snapshot, testgplates, or logs for diagnostics.', 'error');
      return;
    }
    if (lower === 'pwd') {
      terminalWrite('/earth-systems/' + terminalTargetSystem);
      return;
    }
    if (lower === 'date') {
      terminalWrite(new Date().toString());
      return;
    }
    terminalWrite('command not found: ' + command + '. This restricted console only supports commands shown by help.', 'error');
  };

  const renderTerminal = () => terminalOpen ? (
    <div
      className="diagnostics-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setTerminalOpen(false);
          setTerminalUnlocked(false);
          setTerminalSessionToken(null);
        }
      }}
    >
      <section
        id="diagnostics-terminal"
        className="diagnostics-terminal"
        role="dialog"
        aria-modal="true"
        aria-label="Earth Systems diagnostic console"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="terminal-windowbar">
          <div className="terminal-window-title">
            <span className="terminal-dot terminal-dot-red" />
            <span className="terminal-dot terminal-dot-amber" />
            <span className="terminal-dot terminal-dot-green" />
            <strong>Earth Systems — diagnostics</strong>
          </div>
          <div className="terminal-window-meta">{SYSTEM_CATALOG[terminalTargetSystem]?.name || 'System console'}</div>
          <button className="terminal-close" type="button" onClick={() => {
            setTerminalOpen(false);
            setTerminalUnlocked(false);
            setTerminalSessionToken(null);
          }} aria-label="Close terminal">×</button>
        </div>

        {!terminalUnlocked ? (
          <div className="terminal-auth-panel">
            <span className="terminal-auth-mark" aria-hidden="true">⌘</span>
            <p className="terminal-auth-eyebrow">PRIVILEGED ACCESS REQUIRED</p>
            <h2>Authenticate console</h2>
            <p>Target system: <strong>{SYSTEM_CATALOG[terminalTargetSystem]?.name || 'Earth Systems'}</strong></p>
            <form className="terminal-auth-form" onSubmit={submitTerminalPassword}>
              <label htmlFor="terminal-password">Password</label>
              <input
                id="terminal-password"
                type="password"
                value={terminalPasswordInput}
                onChange={(event) => setTerminalPasswordInput(event.target.value)}
                placeholder="Enter terminal password"
                autoComplete="current-password"
                autoFocus
                required
                disabled={terminalAuthenticating}
              />
              {terminalPasswordError && <p className="terminal-auth-error" role="alert">{terminalPasswordError}</p>}
              <button type="submit" disabled={terminalAuthenticating || !terminalPasswordInput}>
                {terminalAuthenticating ? 'VERIFYING…' : 'AUTHENTICATE'}
              </button>
            </form>
            <p className="terminal-auth-foot">Local diagnostic console · Availability is set in source code</p>
          </div>
        ) : (
          <div className="terminal-session">
            <div className="terminal-head">
              <div>
                <strong>LOCAL CONSOLE · {SYSTEM_CATALOG[terminalTargetSystem]?.name || 'SYSTEM'}</strong>
                <span>Read-only diagnostic tools · type help for commands</span>
              </div>
              <div className="terminal-tools">
                <button
                  type="button"
                  className="terminal-test-button"
                  onClick={async () => {
                    setGplatesTestState('testing');
                    const result = await testGplatesConnectivity();
                    setGplatesTestState(result.ok ? 'passed' : 'failed');
                    terminalWrite('GPlates connectivity: ' + (result.ok ? 'PASSED' : 'FAILED'), result.ok ? 'success' : 'error');
                  }}
                  disabled={gplatesTestState === 'testing'}
                >{gplatesTestState === 'testing' ? 'TESTING…' : gplatesTestState === 'passed' ? 'GPlates OK' : gplatesTestState === 'failed' ? 'GPlates FAIL' : 'TEST GPlATES'}</button>
                <button type="button" onClick={async () => {
                  try {
                    if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
                    await navigator.clipboard.writeText(terminalLines.map((line) => line.text).join('\n'));
                    terminalWrite('Console history copied.');
                  } catch (error) {
                    terminalWrite('Could not copy console history: ' + (error?.message || String(error)), 'error');
                  }
                }}>COPY LOG</button>
                <button type="button" onClick={() => {
                  setTerminalLines([{ kind: 'system', text: 'Console cleared.' }]);
                  setDiagnosticLines(['--- LOG CLEARED ---', new Date().toISOString().slice(11, 23) + ' INFO  [SYSTEM] Log cleared by user.']);
                }}>CLEAR</button>
                <button type="button" onClick={() => {
                  const snapshot = {
                    target: terminalTargetSystem,
                    availability: systemAvailability,
                    age,
                    keyframeAge,
                    model: modelForAge(keyframeAge),
                    cache: cacheProgress.cached + '/' + cacheProgress.total,
                    online: navigator.onLine,
                    indexedDB: 'indexedDB' in window,
                    viewport: window.innerWidth + 'x' + window.innerHeight,
                  };
                  diagnostic('info', 'SYSTEM', 'Runtime snapshot', snapshot);
                  terminalWrite(JSON.stringify(snapshot, null, 2));
                }}>SNAPSHOT</button>
              </div>
            </div>

            <pre ref={terminalBodyRef} className="terminal-body" aria-live="polite">{terminalLines.map((line) => line.text).join('\n')}</pre>
            <form className="terminal-command-form" onSubmit={submitTerminalCommand}>
              <label htmlFor="terminal-command-input">charlie@earthsystems:~$</label>
              <input
                ref={terminalCommandInputRef}
                id="terminal-command-input"
                value={terminalCommandInput}
                onChange={(event) => setTerminalCommandInput(event.target.value)}
                autoComplete="off"
                spellCheck="false"
                placeholder="Type help…"
                aria-label="Terminal command"
              />
              <button type="submit" disabled={!terminalCommandInput.trim()}>RUN</button>
            </form>
            <details className="terminal-diagnostics-details">
              <summary>Runtime diagnostics log ({diagnosticLines.length} lines)</summary>
              <pre className="terminal-diagnostics-log">{diagnosticLines.join('\n')}</pre>
            </details>
            <div className="terminal-foot">
              <span>RESTRICTED COMMANDS · LOCAL AVAILABILITY STATE</span>
              <span>{systemAvailability[terminalTargetSystem] ? 'TARGET AVAILABLE' : 'TARGET CLOSED'}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  ) : null;



  if (systemSelected === 'earth-sandbox') {
    return (
      <EarthSandboxSimulator
        onHome={() => setSystemSelected('landing')}
        onOpenTerminal={() => openSystemTerminal('earth-sandbox')}
        terminal={renderTerminal()}
      />
    );
  }

  if (systemSelected === 'plate-lab') {
    return (
      <PlateTectonicsLab
        countries={countries}
        initialBoundaryName={labInitialBoundaryName}
        terminal={renderTerminal()}
        onOpenTerminal={() => openSystemTerminal('plate-lab')}
        onHome={() => {
          setSystemSelected('landing');
          setLabInitialBoundaryName(null);
        }}
      />
    );
  }

  if (systemSelected === 'phivolcs') {
    const selectedQuake = quakeEvents.find((event) => event.id === quakeSelectedId) || null;
    const selectedProperties = selectedQuake?.properties || null;
    const selectedCoordinates = selectedQuake?.geometry?.coordinates || [];
    const selectedVolcanoPoint = [
      ...volcanoMapPoints,
      ...volcanoActivityRows.map((item) => item.type === 'activity' ? { ...item, id: 'volcano-activity-' + item.id } : item),
      ...volcanoSitesWithAlerts.map((site) => ({ ...site, id: 'volcano-site-' + site.id, type: 'site' })),
    ].find((item) => item.id === volcanoSelectedId) || null;
    const visibleVolcanoCount = volcanoMapPoints.length;
    const displayCount = quakeLayer === 'earthquakes' ? quakeFilteredEvents.length : visibleVolcanoCount;

    const chooseQuakeLayer = (layer) => {
      setQuakeLayer(layer);
      setQuakeSelectedId(null);
      setVolcanoSelectedId(null);
      setQuakeSearch('');
      setQuakeMapView({ zoom: 1, panX: 0, panY: 0 });
    };

    const selectMapPoint = (point) => {
      if (!point) return;
      if (quakeLayer === 'earthquakes') {
        setQuakeSelectedId(point.id);
      } else {
        setVolcanoSelectedId(point.id);
      }

      const coordinates = point.geometry?.coordinates || [];
      const longitude = Number(point.longitude ?? coordinates[0]);
      const latitude = Number(point.latitude ?? coordinates[1]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        const target = equirectangularPoint(longitude, latitude);
        setQuakeMapView((view) => {
          const zoom = Math.max(view.zoom, 1.65);
          return {
            zoom,
            panX: (GLOBAL_MAP_WIDTH / 2 - target.x) * zoom,
            panY: (GLOBAL_MAP_HEIGHT / 2 - target.y) * zoom,
          };
        });
      }
    };

    const handleWorldMapPointerDown = (event) => {
      if (event.button !== 0) return;
      const rectangle = event.currentTarget.getBoundingClientRect();
      quakeMapDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: rectangle.width || GLOBAL_MAP_WIDTH,
        height: rectangle.height || GLOBAL_MAP_HEIGHT,
        view: quakeMapView,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const handleWorldMapPointerMove = (event) => {
      const drag = quakeMapDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const movedX = event.clientX - drag.startX;
      const movedY = event.clientY - drag.startY;
      setQuakeMapView({
        ...drag.view,
        panX: drag.view.panX + movedX * GLOBAL_MAP_WIDTH / drag.width,
        panY: drag.view.panY + movedY * GLOBAL_MAP_HEIGHT / drag.height,
      });
    };

    const handleWorldMapPointerEnd = (event) => {
      if (quakeMapDragRef.current?.pointerId === event.pointerId) quakeMapDragRef.current = null;
    };

    const handleWorldMapWheel = (event) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      setQuakeMapView((view) => {
        const zoom = Math.max(1, Math.min(6, view.zoom * (direction > 0 ? 1.18 : 1 / 1.18)));
        const ratio = zoom / view.zoom;
        return { zoom, panX: view.panX * ratio, panY: view.panY * ratio };
      });
    };

    const zoomWorldMap = (direction) => setQuakeMapView((view) => {
      const zoom = Math.max(1, Math.min(6, view.zoom * (direction > 0 ? 1.35 : 1 / 1.35)));
      const ratio = zoom / view.zoom;
      return { zoom, panX: view.panX * ratio, panY: view.panY * ratio };
    });

    const resetWorldMap = () => setQuakeMapView({ zoom: 1, panX: 0, panY: 0 });

    return (
      <main className="phivolcs-app">
        <header className="phivolcs-header">
          <div className="phivolcs-brand">
            <button
              className="brand-mark"
              type="button"
              onClick={() => {
                diagnostic('info', 'UI', 'Returned to the system chooser from the Earth icon', { program: 'Global Seismic & Volcanic Monitor' });
                setTerminalOpen(false);
                setSystemSelected('landing');
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                diagnostic('info', 'UI', 'Diagnostics terminal opened from the Earth icon context menu', { program: 'Global Seismic & Volcanic Monitor' });
                openSystemTerminal('phivolcs');
              }}
              aria-expanded={terminalOpen}
              aria-controls="diagnostics-terminal"
              aria-label="Return to home"
            >
              <span /><span /><span />
            </button>
            <div>
              <div className="phivolcs-brand-title">GLOBAL GEOHAZARDS <span>SEISMIC &amp; VOLCANIC MONITOR</span></div>
              <div className="phivolcs-brand-sub">Worldwide earthquake reports, volcano locations and eruption activity</div>
            </div>
          </div>
          <div className="phivolcs-header-actions">
            <button className="copy-system-link-button" type="button" onClick={() => copySystemLink('phivolcs')} title="Copy a direct link to this monitor">
              <span aria-hidden="true">⧉</span> {systemLinksCopied ? 'Copied' : 'Copy link'}
            </button>
            <span className={(quakeLoading || (quakeLayer === 'volcanoes' && volcanoLoading)) ? 'quake-live-state is-loading' : 'quake-live-state'}>
              <span className="quake-live-dot" />
              {(quakeLoading || (quakeLayer === 'volcanoes' && volcanoLoading))
                ? 'UPDATING'
                : ((quakeLayer === 'earthquakes' ? quakeError : volcanoError) ? 'FEED ISSUE' : 'LIVE FEED')}
            </span>
            <button className="quake-refresh-button" type="button" onClick={() => { setQuakeRefreshNonce((value) => value + 1); setVolcanoRefreshNonce((value) => value + 1); }} disabled={quakeLoading || volcanoLoading} title="Fetch the latest feeds">↻ <span>Refresh</span></button>
          </div>
        </header>

        {renderTerminal()}

        <div className="quake-dashboard">
          <section className="quake-map-panel">
            <div className="quake-layer-tabs" role="tablist" aria-label="Choose global hazard layer">
              <button type="button" role="tab" aria-selected={quakeLayer === 'earthquakes'} className={quakeLayer === 'earthquakes' ? 'is-active' : ''} onClick={() => chooseQuakeLayer('earthquakes')}>
                <span className="quake-tab-earthquake-icon">●</span> Earthquakes
                <small>{quakeFilteredEvents.length.toLocaleString()}</small>
              </button>
              <button type="button" role="tab" aria-selected={quakeLayer === 'volcanoes'} className={quakeLayer === 'volcanoes' ? 'is-active' : ''} onClick={() => chooseQuakeLayer('volcanoes')}>
                <span className="quake-tab-volcano-icon">▲</span> Volcanoes &amp; eruptions
                <small>{volcanoActivityRows.length.toLocaleString()}</small>
              </button>
            </div>

            <div className="quake-heading">
              <div>
                <p className="quake-eyebrow">{quakeLayer === 'earthquakes' ? 'GLOBAL SEISMICITY' : 'GLOBAL VOLCANIC ACTIVITY'}</p>
                <h1>{quakeLayer === 'earthquakes' ? 'Earthquake activity' : 'Volcanoes & eruption reports'}</h1>
                <p>{quakeLayer === 'earthquakes'
                  ? 'Recorded earthquakes around the world on a 2D map. Marker size and colour represent earthquake magnitude; select any marker for details.'
                  : 'Explore the world’s Holocene volcanoes, NASA-curated volcanic activity reports and elevated USGS alerts. A marker identifies a volcano or reported event; it does not imply an eruption is occurring unless the source says so.'}</p>
              </div>
              <div className="quake-stats">
                <strong>{displayCount.toLocaleString()}</strong>
                <span>{quakeLayer === 'earthquakes' ? 'matching earthquakes' : 'visible map markers'}</span>
                <small>{quakeLayer === 'earthquakes'
                  ? (quakeUpdatedAt ? 'Updated ' + new Date(quakeUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Waiting for feed')
                  : (volcanoUpdatedAt ? 'Reports checked ' + new Date(volcanoUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Waiting for volcano feeds')}</small>
              </div>
            </div>

            <div className="quake-map-wrap" ref={quakeStageRef}>
              <div className="quake-map-badges">
                <span>{quakeLayer === 'earthquakes'
                  ? (quakeRange === 'hour' ? 'PAST HOUR' : quakeRange === 'day' ? 'PAST 24 HOURS' : quakeRange === 'week' ? 'PAST 7 DAYS' : 'PAST 30 DAYS')
                  : 'GLOBAL VOLCANO CATALOGUE'}</span>
                <span>{quakeLayer === 'earthquakes'
                  ? (quakeRegion === 'world' ? 'WORLDWIDE' : (EARTHQUAKE_REGION_LABELS[quakeRegion] || 'REGION').toUpperCase() + ' REGION')
                  : 'SITES · ACTIVITY · ALERTS'}</span>
              </div>

              <div className="quake-map-controls" aria-label="Map controls">
                <button type="button" onClick={() => zoomWorldMap(1)} aria-label="Zoom in" title="Zoom in">+</button>
                <button type="button" onClick={() => zoomWorldMap(-1)} aria-label="Zoom out" title="Zoom out">−</button>
                <button type="button" onClick={resetWorldMap} aria-label="Reset map view" title="Reset map view">⌖</button>
              </div>

              <svg
                ref={quakeMapSvgRef}
                className="quake-world-map"
                viewBox={'0 0 ' + GLOBAL_MAP_WIDTH + ' ' + GLOBAL_MAP_HEIGHT}
                preserveAspectRatio="xMidYMid meet"
                role="application"
                aria-label="Interactive two-dimensional world map of earthquake epicentres and volcanoes"
                onPointerDown={handleWorldMapPointerDown}
                onPointerMove={handleWorldMapPointerMove}
                onPointerUp={handleWorldMapPointerEnd}
                onPointerCancel={handleWorldMapPointerEnd}
                onWheel={handleWorldMapWheel}
              >
                <defs>
                  <linearGradient id="quake-ocean-gradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#0d2340" />
                    <stop offset="52%" stopColor="#09192e" />
                    <stop offset="100%" stopColor="#061121" />
                  </linearGradient>
                  <radialGradient id="quake-ocean-glow">
                    <stop offset="0%" stopColor="#1b4262" stopOpacity=".5" />
                    <stop offset="100%" stopColor="#081425" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <rect x="0" y="0" width={GLOBAL_MAP_WIDTH} height={GLOBAL_MAP_HEIGHT} fill="url(#quake-ocean-gradient)" />
                <ellipse cx="500" cy="250" rx="430" ry="260" fill="url(#quake-ocean-glow)" pointerEvents="none" />
                <g className="quake-map-graticule" pointerEvents="none">
                  {[-60, -30, 0, 30, 60].map((latitude) => {
                    const point = equirectangularPoint(0, latitude);
                    return <path key={'lat-' + latitude} d={'M0,' + point.y + 'H' + GLOBAL_MAP_WIDTH} />;
                  })}
                  {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((longitude) => {
                    const point = equirectangularPoint(longitude, 0);
                    return <path key={'lon-' + longitude} d={'M' + point.x + ',0V' + GLOBAL_MAP_HEIGHT} />;
                  })}
                </g>
                <g className="quake-map-viewport" transform={'translate(' + quakeMapView.panX + ' ' + quakeMapView.panY + ') translate(500 250) scale(' + quakeMapView.zoom + ') translate(-500 -250)'}>
                  <g className="quake-map-country-layer" pointerEvents="none">
                    {quakeWorldMapPaths.map((country) => (
                      <path key={country.id} d={country.d} className="quake-country-shape" fillRule="evenodd">
                        <title>{country.name}</title>
                      </path>
                    ))}
                  </g>

                  {quakeLayer === 'earthquakes' && quakeMapEvents.map((event) => {
                    const coordinates = event.geometry?.coordinates || [];
                    const longitude = Number(coordinates[0]);
                    const latitude = Number(coordinates[1]);
                    const projected = equirectangularPoint(longitude, latitude);
                    const magnitude = Number(event.properties?.mag);
                    const radius = Math.max(2.1, Math.min(8, 1.8 + Math.max(0, magnitude) * .82));
                    const selected = event.id === quakeSelectedId;
                    return (
                      <circle
                        key={event.id}
                        className={selected ? 'quake-map-marker quake-map-earthquake is-selected' : 'quake-map-marker quake-map-earthquake'}
                        cx={projected.x}
                        cy={projected.y}
                        r={radius * (selected ? 1.25 : 1)}
                        fill={selected ? '#ffffff' : earthquakeMagnitudeColor(magnitude)}
                        stroke={selected ? '#ffffff' : 'rgba(4,9,17,.82)'}
                        strokeWidth={selected ? 2 : 1}
                        role="button"
                        tabIndex={0}
                        aria-label={'Magnitude ' + magnitude.toFixed(1) + ' earthquake: ' + (event.properties?.place || 'location unavailable')}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => selectMapPoint(event)}
                        onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') { keyboardEvent.preventDefault(); selectMapPoint(event); } }}
                      >
                        <title>{'M' + magnitude.toFixed(1) + ' · ' + (event.properties?.place || 'Location unavailable') + ' · depth ' + Number(coordinates[2]).toFixed(1) + ' km'}</title>
                      </circle>
                    );
                  })}

                  {quakeLayer === 'volcanoes' && volcanoMapPoints.map((point) => {
                    const projected = equirectangularPoint(point.longitude, point.latitude);
                    const selected = point.id === volcanoSelectedId || (point.type === 'alert' && volcanoSelectedId && point.id.endsWith(volcanoSelectedId));
                    const colour = point.type === 'activity'
                      ? '#ff795c'
                      : point.type === 'alert'
                        ? volcanoAlertColour(point)
                        : (showUSGSVolcanoAlerts && point.alert ? volcanoAlertColour(point.alert) : '#86add4');
                    const radius = point.type === 'activity' ? 5.1 : point.type === 'alert' ? 4.7 : 2.2;
                    return (
                      <circle
                        key={point.id}
                        className={selected ? 'quake-map-marker quake-map-volcano is-selected' : 'quake-map-marker quake-map-volcano'}
                        cx={projected.x}
                        cy={projected.y}
                        r={radius * (selected ? 1.35 : 1)}
                        fill={colour}
                        stroke={selected ? '#ffffff' : 'rgba(4,9,17,.82)'}
                        strokeWidth={selected ? 2 : 0.8}
                        role="button"
                        tabIndex={0}
                        aria-label={point.type === 'activity'
                          ? 'Reported volcanic activity: ' + point.name
                          : point.type === 'alert'
                            ? point.name + ', USGS alert ' + point.alertLevel
                            : point.name + ', volcano location'}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => selectMapPoint(point)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectMapPoint(point); } }}
                      >
                        <title>{point.name + (point.type === 'activity' ? ' · reported volcanic activity' : point.type === 'alert' ? ' · USGS ' + point.alertLevel : (showUSGSVolcanoAlerts && point.alert) ? ' · USGS ' + point.alert.alert_level : ' · Holocene volcano catalogue')}</title>
                      </circle>
                    );
                  })}
                </g>
              </svg>

              <div className="quake-map-footer">
                {quakeLayer === 'earthquakes' ? (
                  <>
                    <span><i className="quake-legend-dot quake-mag-small" /> M 0–2.4</span>
                    <span><i className="quake-legend-dot quake-mag-mid" /> M 2.5–4.4</span>
                    <span><i className="quake-legend-dot quake-mag-high" /> M 4.5–5.9</span>
                    <span><i className="quake-legend-dot quake-mag-major" /> M 6.0+</span>
                  </>
                ) : (
                  <>
                    <span><i className="quake-legend-dot quake-mag-small" /> Volcano location</span>
                    <span><i className="quake-legend-dot quake-mag-high" /> Reported activity (NASA)</span>
                    <span><i className="quake-legend-dot quake-mag-major" /> Elevated USGS alert (US only)</span>
                  </>
                )}
              </div>

              {quakeLayer === 'earthquakes' && quakeLoading && quakeEvents.length === 0 && (
                <div className="quake-map-message"><span className="quake-spinner" /> Loading global earthquake feed…</div>
              )}
              {quakeLayer === 'earthquakes' && quakeError && (
                <div className="quake-map-message quake-map-error">
                  <strong>Earthquake feed unavailable</strong>
                  <span>{quakeError}</span>
                  <button type="button" onClick={() => setQuakeRefreshNonce((value) => value + 1)}>Retry feed</button>
                </div>
              )}
              {quakeLayer === 'volcanoes' && volcanoLoading && volcanoMapPoints.length === 0 && (
                <div className="quake-map-message"><span className="quake-spinner" /> Loading global volcano locations and activity reports…</div>
              )}
              {quakeLayer === 'volcanoes' && volcanoError && volcanoMapPoints.length === 0 && !volcanoLoading && (
                <div className="quake-map-message quake-map-error">
                  <strong>Volcano data unavailable</strong>
                  <span>{volcanoError}</span>
                  <button type="button" onClick={() => setVolcanoRefreshNonce((value) => value + 1)}>Retry volcano feeds</button>
                </div>
              )}
            </div>

            {quakeLayer === 'earthquakes' ? (
              <div className="quake-magnitude-note">
                <span className="quake-info-icon">i</span>
                <p><strong>How to read the scale:</strong> magnitude measures an earthquake at its source, not how strongly every location shakes. Each whole magnitude step represents about 10× the measured wave amplitude and roughly 32× the released energy. Local shaking also depends on distance, depth and ground conditions.</p>
                <a href="https://www.usgs.gov/programs/earthquake-hazards/earthquake-magnitude-energy-release-and-shaking-intensity" target="_blank" rel="noreferrer">Magnitude guide ↗</a>
              </div>
            ) : (
              <div className="quake-magnitude-note">
                <span className="quake-info-icon">i</span>
                <p><strong>Important:</strong> the Smithsonian catalogue marks known Holocene volcano locations; it does not mean all are currently erupting. NASA EONET reports curated active events, while the USGS alert feed covers volcanoes monitored by the United States. Feed coverage is not globally uniform.</p>
                <a href="https://volcano.si.edu/database/webservices.cfm" target="_blank" rel="noreferrer">Smithsonian data documentation ↗</a>
              </div>
            )}
          </section>

          <aside className="quake-sidebar">
            <section className="quake-side-section quake-filter-panel">
              <div className="quake-section-top">
                <div>
                  <p className="quake-eyebrow">{quakeLayer === 'earthquakes' ? 'MONITOR CONTROLS' : 'VOLCANO LAYERS'}</p>
                  <h2>{quakeLayer === 'earthquakes' ? 'Filter earthquakes' : 'Choose map layers'}</h2>
                </div>
                <span className="quake-count-pill">{displayCount.toLocaleString()}</span>
              </div>

              {quakeLayer === 'earthquakes' ? (
                <>
                  <div className="quake-filter-grid">
                    <label>
                      <span>Time window</span>
                      <select value={quakeRange} onChange={(event) => setQuakeRange(event.target.value)}>
                        <option value="hour">Past hour</option>
                        <option value="day">Past 24 hours</option>
                        <option value="week">Past 7 days</option>
                        <option value="month">Past 30 days</option>
                      </select>
                    </label>
                    <label>
                      <span>Minimum magnitude</span>
                      <select value={quakeMinMagnitude} onChange={(event) => setQuakeMinMagnitude(event.target.value)}>
                        <option value="0">All reported magnitudes</option>
                        <option value="2.5">M 2.5 and above</option>
                        <option value="4.5">M 4.5 and above</option>
                        <option value="6">M 6.0 and above</option>
                      </select>
                    </label>
                    <label>
                      <span>Region</span>
                      <select value={quakeRegion} onChange={(event) => setQuakeRegion(event.target.value)}>
                        <option value="world">Worldwide</option>
                        <option value="asia">Asia</option>
                        <option value="africa">Africa</option>
                        <option value="europe">Europe</option>
                        <option value="north-america">N. America</option>
                        <option value="south-america">S. America</option>
                        <option value="oceania">Oceania</option>
                      </select>
                    </label>
                    <label>
                      <span>Sort events</span>
                      <select value={quakeSort} onChange={(event) => setQuakeSort(event.target.value)}>
                        <option value="newest">Newest first</option>
                        <option value="largest">Largest magnitude</option>
                      </select>
                    </label>
                  </div>
                  <label className="quake-search-label">
                    <span>Search location</span>
                    <input value={quakeSearch} onChange={(event) => setQuakeSearch(event.target.value)} placeholder="e.g. Philippines, Japan, Alaska…" />
                  </label>
                  <label className="quake-auto-refresh">
                    <input type="checkbox" checked={quakeAutoRefresh} onChange={(event) => setQuakeAutoRefresh(event.target.checked)} />
                    <span><strong>Auto-refresh earthquakes</strong><small>Check for new seismic data every 60 seconds</small></span>
                  </label>
                </>
              ) : (
                <>
                  <label className="quake-layer-option">
                    <input type="checkbox" checked={showAllVolcanoSites} onChange={(event) => setShowAllVolcanoSites(event.target.checked)} />
                    <span><strong>Volcano locations</strong><small>Smithsonian catalogue of known Holocene volcanoes</small></span>
                    <b>{volcanoSites.length.toLocaleString()}</b>
                  </label>
                  <label className="quake-layer-option">
                    <input type="checkbox" checked={showReportedActivity} onChange={(event) => setShowReportedActivity(event.target.checked)} />
                    <span><strong>Reported volcanic activity</strong><small>NASA EONET open events, not a complete global eruption log</small></span>
                    <b>{eruptionEvents.length.toLocaleString()}</b>
                  </label>
                  <label className="quake-layer-option">
                    <input type="checkbox" checked={showUSGSVolcanoAlerts} onChange={(event) => setShowUSGSVolcanoAlerts(event.target.checked)} />
                    <span><strong>Elevated volcano alerts</strong><small>USGS-monitored US volcanoes only</small></span>
                    <b>{volcanoAlerts.length.toLocaleString()}</b>
                  </label>
                  <label className="quake-search-label">
                    <span>Search volcano or region</span>
                    <input value={quakeSearch} onChange={(event) => setQuakeSearch(event.target.value)} placeholder="e.g. Kīlauea, Japan, Indonesia…" />
                  </label>
                  <label className="quake-auto-refresh">
                    <input type="checkbox" checked={volcanoAutoRefresh} onChange={(event) => setVolcanoAutoRefresh(event.target.checked)} />
                    <span><strong>Auto-refresh activity and alerts</strong><small>Check the live event sources every 5 minutes</small></span>
                  </label>
                </>
              )}
            </section>

            {quakeLayer === 'earthquakes' && selectedQuake && selectedProperties && (
              <section className="quake-selected-card">
                <div className="quake-selected-top">
                  <span>SELECTED EARTHQUAKE</span>
                  <button type="button" onClick={() => setQuakeSelectedId(null)} aria-label="Clear selected earthquake">×</button>
                </div>
                <div className="quake-selected-body">
                  <div className="quake-selected-magnitude" style={{ '--quake-color': earthquakeMagnitudeColor(Number(selectedProperties.mag)) }}>
                    <strong>{Number(selectedProperties.mag).toFixed(1)}</strong><small>MAGNITUDE</small>
                  </div>
                  <div className="quake-selected-location">
                    <h3>{selectedProperties.place || 'Location unavailable'}</h3>
                    <p>{formatEarthquakeTime(selectedProperties.time)}</p>
                    <p>Depth <strong>{Number(selectedCoordinates[2]).toFixed(1)} km</strong> · {selectedProperties.magType || 'Magnitude type unavailable'}</p>
                  </div>
                </div>
                <div className="quake-selected-metrics">
                  <span><small>LATITUDE</small><strong>{Number(selectedCoordinates[1]).toFixed(3)}°</strong></span>
                  <span><small>LONGITUDE</small><strong>{Number(selectedCoordinates[0]).toFixed(3)}°</strong></span>
                  <span><small>STATUS</small><strong>{selectedProperties.status || 'Reported'}</strong></span>
                </div>
                <a className="quake-event-source-link" href={selectedProperties.url || USGS_EARTHQUAKE_MAP_URL} target="_blank" rel="noreferrer">Open official event details ↗</a>
              </section>
            )}

            {quakeLayer === 'volcanoes' && selectedVolcanoPoint && (
              <section className="quake-selected-card">
                <div className="quake-selected-top">
                  <span>{selectedVolcanoPoint.type === 'alert' ? 'USGS VOLCANO ALERT' : selectedVolcanoPoint.type === 'activity' ? 'REPORTED VOLCANIC ACTIVITY' : 'VOLCANO LOCATION'}</span>
                  <button type="button" onClick={() => setVolcanoSelectedId(null)} aria-label="Clear selected volcano">×</button>
                </div>
                <div className="quake-selected-body">
                  <div className="quake-selected-magnitude" style={{ '--quake-color': selectedVolcanoPoint.type === 'alert' ? volcanoAlertColour(selectedVolcanoPoint) : selectedVolcanoPoint.type === 'activity' ? '#ff795c' : '#8bb6e2' }}>
                    <strong>{selectedVolcanoPoint.type === 'alert' ? String(selectedVolcanoPoint.alertLevel || 'ALERT').toUpperCase().replace('ADVISORY', 'ADV').replace('WARNING', 'WARN') : selectedVolcanoPoint.type === 'activity' ? 'LIVE' : 'VOL'}</strong>
                    <small>{selectedVolcanoPoint.type === 'alert' ? selectedVolcanoPoint.colorCode || 'USGS LEVEL' : selectedVolcanoPoint.type === 'activity' ? 'NASA EONET' : 'SMITHSONIAN'}</small>
                  </div>
                  <div className="quake-selected-location">
                    <h3>{selectedVolcanoPoint.name || 'Volcano'}</h3>
                    {selectedVolcanoPoint.country && <p>{selectedVolcanoPoint.country}{selectedVolcanoPoint.region ? ' · ' + selectedVolcanoPoint.region : ''}</p>}
                    {selectedVolcanoPoint.type === 'alert' && <p>USGS alert level <strong>{selectedVolcanoPoint.alertLevel}</strong> · {selectedVolcanoPoint.colorCode || 'colour not reported'}</p>}
                    {selectedVolcanoPoint.type === 'activity' && <p>{selectedVolcanoPoint.description || 'Curated open volcanic activity event.'}</p>}
                    {selectedVolcanoPoint.type === 'site' && <p>{selectedVolcanoPoint.volcanoType} · last recorded eruption: <strong>{selectedVolcanoPoint.lastEruption}</strong></p>}
                    {selectedVolcanoPoint.date && <p>{formatEarthquakeTime(selectedVolcanoPoint.date)}</p>}
                  </div>
                </div>
                {Number.isFinite(Number(selectedVolcanoPoint.latitude)) && Number.isFinite(Number(selectedVolcanoPoint.longitude)) && (
                  <div className="quake-selected-metrics">
                    <span><small>LATITUDE</small><strong>{Number(selectedVolcanoPoint.latitude).toFixed(3)}°</strong></span>
                    <span><small>LONGITUDE</small><strong>{Number(selectedVolcanoPoint.longitude).toFixed(3)}°</strong></span>
                    <span><small>SOURCE</small><strong>{selectedVolcanoPoint.type === 'alert' ? 'USGS' : selectedVolcanoPoint.type === 'activity' ? 'NASA' : 'GVP'}</strong></span>
                  </div>
                )}
                <a className="quake-event-source-link" href={selectedVolcanoPoint.url || 'https://volcano.si.edu/'} target="_blank" rel="noreferrer">Open source details ↗</a>
              </section>
            )}

            {quakeLayer === 'earthquakes' ? (
              <section className="quake-side-section quake-event-panel">
                <div className="quake-section-top quake-event-heading">
                  <div>
                    <p className="quake-eyebrow">RECENT EVENTS</p>
                    <h2>{quakeSort === 'largest' ? 'Largest earthquakes' : 'Latest earthquakes'}</h2>
                  </div>
                  {quakeLoading && quakeEvents.length > 0 && <span className="quake-mini-spinner" title="Updating feed" />}
                </div>

                {quakeError && quakeEvents.length > 0 && <p className="quake-stale-notice">Showing the last successful update. {quakeError}</p>}
                {quakeFilteredEvents.length === 0 && !quakeLoading && !quakeError && (
                  <div className="quake-empty">No recorded events match these filters. Try a wider time window or a lower magnitude threshold.</div>
                )}
                {quakeFilteredEvents.length === 0 && quakeLoading && (
                  <div className="quake-empty">Loading events…</div>
                )}
                <div className="quake-event-list">
                  {quakeListEvents.map((event) => {
                    const properties = event.properties || {};
                    const coordinates = event.geometry?.coordinates || [];
                    const isSelected = event.id === quakeSelectedId;
                    const magnitude = Number(properties.mag);
                    return (
                      <button key={event.id} type="button" className={isSelected ? 'quake-event-row is-selected' : 'quake-event-row'} onClick={() => selectMapPoint(event)} aria-pressed={isSelected}>
                        <span className="quake-event-mag" style={{ '--quake-color': earthquakeMagnitudeColor(magnitude), '--quake-radius': (Math.max(7, earthquakeMagnitudeRadius(magnitude) * 18)) + 'px' }}>
                          <strong>{magnitude.toFixed(1)}</strong>
                        </span>
                        <span className="quake-event-copy">
                          <strong>{properties.place || 'Location unavailable'}</strong>
                          <small>{formatEarthquakeTime(properties.time)}</small>
                          <small>Depth {Number(coordinates[2]).toFixed(1)} km</small>
                        </span>
                        <span className="quake-event-arrow" aria-hidden="true">↗</span>
                      </button>
                    );
                  })}
                </div>
                {quakeFilteredEvents.length > quakeListEvents.length && <p className="quake-list-limit">Showing the first {quakeListEvents.length} of {quakeFilteredEvents.length} matching events.</p>}
              </section>
            ) : (
              <section className="quake-side-section quake-event-panel">
                <div className="quake-section-top quake-event-heading">
                  <div>
                    <p className="quake-eyebrow">CURRENT REPORTS</p>
                    <h2>Activity &amp; alert reports</h2>
                  </div>
                  {volcanoLoading && <span className="quake-mini-spinner" title="Updating volcano feeds" />}
                </div>
                {volcanoError && <p className="quake-stale-notice">{volcanoError}</p>}
                {volcanoActivityRows.length === 0 && !volcanoLoading && (
                  <div className="quake-empty">No open volcanic activity reports or elevated USGS alerts were returned by the connected feeds. The volcano-location catalogue can still be explored on the map.</div>
                )}
                <div className="quake-event-list">
                  {volcanoActivityRows.slice(0, 100).map((item) => {
                    const isSelected = item.id === volcanoSelectedId;
                    const itemColour = item.type === 'alert' ? volcanoAlertColour(item) : '#ff795c';
                    const label = item.type === 'alert' ? String(item.alertLevel || 'ALERT').toUpperCase().replace('ADVISORY', 'ADV').replace('WARNING', 'WARN') : 'ACT';
                    const selectable = item.type === 'activity'
                      ? { ...item, id: 'volcano-activity-' + item.id, type: 'activity' }
                      : item;
                    return (
                      <button key={item.id} type="button" className={isSelected ? 'quake-event-row is-selected' : 'quake-event-row'} onClick={() => selectMapPoint(selectable)} aria-pressed={isSelected}>
                        <span className="quake-event-mag quake-volcano-event-badge" style={{ '--quake-color': itemColour }}>
                          <strong>{label}</strong>
                        </span>
                        <span className="quake-event-copy">
                          <strong>{item.name}</strong>
                          <small>{item.type === 'alert' ? 'USGS ' + item.colorCode + ' · ' + item.alertLevel : 'NASA EONET · reported volcanic activity'}</small>
                          <small>{item.date ? formatEarthquakeTime(item.date) : (item.country || 'Location not specified')}</small>
                        </span>
                        <span className="quake-event-arrow" aria-hidden="true">↗</span>
                      </button>
                    );
                  })}
                </div>
                {volcanoActivityRows.length > 100 && <p className="quake-list-limit">Showing the latest 100 activity/alert reports.</p>}
                <p className="quake-list-limit">The global eruption/activity feed is curated and not exhaustive. USGS alert levels apply only to volcanoes covered by US monitoring.</p>
              </section>
            )}

            <section className="quake-source-panel">
              <div className="quake-source-title"><span className="quake-source-status" /> DATA SOURCES</div>
              {quakeLayer === 'earthquakes' ? (
                <>
                  <p><strong>Earthquakes:</strong> USGS global GeoJSON summary feeds, checked approximately once a minute.</p>
                  <a href={USGS_EARTHQUAKE_MAP_URL} target="_blank" rel="noreferrer">USGS Latest Earthquakes ↗</a>
                </>
              ) : (
                <>
                  <p><strong>Volcano locations:</strong> Smithsonian Global Volcanism Program's Holocene volcano catalogue.</p>
                  <a href="https://volcano.si.edu/database/webservices.cfm" target="_blank" rel="noreferrer">Smithsonian GVP web services ↗</a>
                  <p><strong>Reported volcanic activity:</strong> NASA's open EONET events. Elevated alert levels are supplied separately by the USGS and only cover volcanoes monitored by that agency.</p>
                  <a href="https://eonet.gsfc.nasa.gov/docs/v3" target="_blank" rel="noreferrer">NASA EONET API documentation ↗</a>
                  <a href="https://volcanoes.usgs.gov/hans-public/api/volcano/default" target="_blank" rel="noreferrer">USGS Volcano API documentation ↗</a>
                </>
              )}
              <a href={PHIVOLCS_EARTHQUAKE_BULLETINS_URL} target="_blank" rel="noreferrer">Philippine PHIVOLCS bulletins ↗</a>
              <small>This is an informational viewer, not an early-warning service. Feeds may be delayed, incomplete or revised. Check the originating agency for official warnings.</small>
            </section>
          </aside>
        </div>
        <footer className="phivolcs-footer">
          <span>GLOBAL GEOHAZARDS <span className="footer-separator">/</span> SEISMIC &amp; VOLCANIC MONITOR</span>
          <span>Click the Earth to return home</span>
        </footer>
      </main>
    );
  }

  if (systemSelected === 'mass-space') {
    const massSlides = [...SOLAR_SYSTEM_PLANETS, { name: 'Solar System', overview: true, fact: 'All eight planets in order from the Sun: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune.' }];
    const selectedSlide = massSlides[massPlanetIndex];
    const massValue = Number(earthMass);
    const displayMass = Number.isFinite(massValue) && massValue >= 0 ? massValue : 0;
    const apparentWeight = selectedSlide.overview ? null : displayMass * selectedSlide.gravity;
    const trackStep = 100 / massSlides.length;
    return (
      <main className="mass-space">
        <header className="mass-space-header">
          <div className="mass-header-left">
            <button
              className="brand-mark mass-earth-home"
              type="button"
              onClick={() => {
                diagnostic('info', 'UI', 'Returned to the system chooser from the Earth icon', { program: 'Mass in Space' });
                setTerminalOpen(false);
                setSystemSelected('landing');
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                diagnostic('info', 'UI', 'Diagnostics terminal opened from the Earth icon context menu', { program: 'Mass in Space' });
                openSystemTerminal('mass-space');
              }}
              aria-expanded={terminalOpen}
              aria-controls="diagnostics-terminal"
              aria-label="Return to home"
            >
              <span /><span /><span />
            </button>

          </div>
          <div className="mass-brand"><span className="mass-brand-orb">✦</span><span>EARTH &amp; SPACE</span></div>
          <div className="mass-header-actions">
            <span className="mass-header-tag">GRAVITY EXPLORER</span>
            <button className="copy-system-link-button" type="button" onClick={() => copySystemLink('mass-space')} title="Copy a direct link to Mass in Space">
              <span aria-hidden="true">⧉</span> {systemLinksCopied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </header>
        <section className="mass-space-main">
          <p className="mass-eyebrow">YOUR MASS, ELSEWHERE</p>
          <h1>How much would you <span>weigh?</span></h1>
          <p className="mass-intro">Enter your mass on Earth in kilograms, then compare your weight on each planet in newtons (N). Start on Earth, or use the arrows to explore.</p>
          <label className="mass-input-label" htmlFor="earth-mass-input">Your mass on Earth <span>kg</span></label>
          <div className="mass-input-wrap">
            <input id="earth-mass-input" type="number" min="0" max="1000000" step="0.1" value={earthMass} onChange={(event) => setEarthMass(event.target.value)} />
            <span>kg</span>
          </div>
          <div className="mass-stage">
            <button className="mass-arrow mass-arrow-left" type="button" onClick={() => setMassPlanetIndex((index) => Math.max(0, index - 1))} disabled={massPlanetIndex === 0} aria-label="Previous planet">←</button>
            <div className="mass-planet-window">
              <div className="mass-planet-track" style={{ transform: 'translateX(-' + (massPlanetIndex * trackStep) + '%)' }}>
                {massSlides.map((item, index) => (
                  <div className={index === massPlanetIndex ? 'mass-planet-slide active' : 'mass-planet-slide'} key={item.name} aria-hidden={index !== massPlanetIndex}>
                    {item.overview ? (
                      <div className="mass-overview">
                        <p className="mass-overview-kicker">THE SOLAR SYSTEM</p>
                        <h2>All eight planets, in order</h2>
                        <div className="mass-solar-system-art" role="img" aria-label="The eight planets in order from the Sun: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune">
                          <span className="mass-sun" />
                          {SOLAR_SYSTEM_PLANETS.map((planetItem) => (
                            <span key={planetItem.name} className={'mass-mini-planet mass-mini-' + planetItem.name.toLowerCase()} title={planetItem.name} style={{ '--planet-texture': 'url("' + planetItem.texture + '")' }} />
                          ))}
                        </div>
                        <div className="mass-solar-labels">{SOLAR_SYSTEM_PLANETS.map((planetItem) => <span key={planetItem.name}>{planetItem.name}</span>)}</div>
                        <p className="mass-planet-fact">{item.fact}</p>
                        <div className="mass-overview-weights">
                          {SOLAR_SYSTEM_PLANETS.map((planetItem) => (
                            <div key={planetItem.name}><span>{planetItem.name}</span><strong>{(displayMass * planetItem.gravity).toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>N</small></strong></div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mass-planet-scene">
                          <div className={'mass-planet-ball' + (item.name === 'Saturn' ? ' has-rings' : '')} style={{ width: item.diameter + 'px', height: item.diameter + 'px', '--planet-texture': 'url("' + item.texture + '")' }} role="img" aria-label={item.name + ' planet image'}>
                            <div className="mass-person-cutout" style={{ transform: 'translateX(-50%) scale(' + (item.diameter / 160) + ')' }} aria-hidden="true"><span className="person-head" /><span className="person-body" /><span className="person-leg left" /><span className="person-leg right" /><span className="person-arm left" /><span className="person-arm right" /></div>
                          </div>
                      </div>
                      <div className="mass-planet-title">{item.name}</div>
                      <div className="mass-planet-fact">{item.fact}</div>
                      <div className="mass-slide-weight"><span>YOUR WEIGHT ON {item.name.toUpperCase()}</span><strong>{(displayMass * item.gravity).toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>N</small></strong></div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <button className="mass-arrow mass-arrow-right" type="button" onClick={() => setMassPlanetIndex((index) => Math.min(massSlides.length - 1, index + 1))} disabled={massPlanetIndex === massSlides.length - 1} aria-label="Next planet or solar system overview">→</button>
          </div>
          <div className="mass-planet-picker" aria-label="Jump to a planet">
            {SOLAR_SYSTEM_PLANETS.map((item, index) => (
              <button key={item.name} type="button" className={index === massPlanetIndex ? 'mass-planet-chip active' : 'mass-planet-chip'} onClick={() => setMassPlanetIndex(index)} aria-pressed={index === massPlanetIndex}>
                {item.name}
              </button>
            ))}
            <button type="button" className={massPlanetIndex === SOLAR_SYSTEM_PLANETS.length ? 'mass-planet-chip active' : 'mass-planet-chip'} onClick={() => setMassPlanetIndex(SOLAR_SYSTEM_PLANETS.length)} aria-pressed={massPlanetIndex === SOLAR_SYSTEM_PLANETS.length}>Solar System</button>
          </div>
          {!selectedSlide.overview && <div className="mass-result" aria-live="polite">
            <div><span>APPARENT WEIGHT ON {selectedSlide.name.toUpperCase()}</span><strong>{apparentWeight.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>N</small></strong></div>
            <div className="mass-result-divider" />
            <div><span>GRAVITY VS EARTH</span><strong>{selectedSlide.gravity.toFixed(3)}×</strong></div>
          </div>}
          <p className="mass-science-note"><strong>Science note:</strong> your mass stays the same wherever you go. Weight is calculated using W = m × g, where mass is in kilograms and gravitational field strength is in m/s². The gravitational field strengths use NASA/JPL equatorial values in m/s². For Jupiter, Saturn, Uranus and Neptune, the values are defined at conventional atmospheric reference levels because these planets have no solid surface. Weight is calculated directly as W = m × g and displayed in newtons (N).</p>
          <div className="mass-keyboard-hint"><kbd>←</kbd><kbd>→</kbd> Slide through the planets, then the solar-system overview</div>
        </section>
        {renderTerminal()}
      </main>
    );
  }

  if (systemSelected === 'landing') {
    return (
      <main className="system-landing">
        <div className="system-landing-glow" aria-hidden="true" />
        <header className="system-landing-brand">
          <div className="system-landing-brand-lockup">
            <span className="system-brand-orb" aria-hidden="true"><span /></span>
            <span>EARTH SYSTEMS</span>
          </div>
        </header>
        <section className="system-landing-content">
          <p className="system-eyebrow">A window into our planet</p>
          <h1>Where Was<br /><span>the Earth?</span></h1>
          <p className="system-intro">Choose a system to continue. </p>
          {systemAvailabilityError && <p className="system-availability-notice system-availability-warning" role="status">{systemAvailabilityError}</p>}
          {systemAvailabilityNotice && <p className="system-availability-notice" role="status">{systemAvailabilityNotice}</p>}
          <div className="system-choice-grid">
            <button className={'system-choice system-choice-primary' + (!systemAvailability['past-globe'] ? ' system-choice-closed' : '')} type="button" onClick={() => openSystem('past-globe')} onContextMenu={(event) => { event.preventDefault(); openSystemTerminal('past-globe'); }} title={!systemAvailability['past-globe'] ? 'Not currently available' : ''}>
              <span className="system-choice-icon" aria-hidden="true">◉</span>
              <span className="system-choice-copy">
                <strong>Past Globe</strong>
                <span>Explore the movement of continents through geological time.</span>
                {!systemAvailability['past-globe'] && <small className="system-choice-badge unavailable">NOT CURRENTLY AVAILABLE</small>}
              </span>
              <span className="system-choice-arrow" aria-hidden="true">↗</span>
            </button>
            <button className={'system-choice system-choice-primary' + (!systemAvailability['mass-space'] ? ' system-choice-closed' : '')} type="button" onClick={() => openSystem('mass-space')} onContextMenu={(event) => { event.preventDefault(); openSystemTerminal('mass-space'); }} title={!systemAvailability['mass-space'] ? 'Not currently available' : ''}>
              <span className="system-choice-icon" aria-hidden="true">◌</span>
              <span className="system-choice-copy">
                <strong>Mass in Space</strong>
                <span>Compare how gravity changes your weight across the Solar System.</span>
                {!systemAvailability['mass-space'] && <small className="system-choice-badge unavailable">NOT CURRENTLY AVAILABLE</small>}
              </span>
              <span className="system-choice-arrow" aria-hidden="true">↗</span>
            </button>
            <button className={'system-choice system-choice-primary' + (!systemAvailability.phivolcs ? ' system-choice-closed' : '')} type="button" onClick={() => openSystem('phivolcs')} onContextMenu={(event) => { event.preventDefault(); openSystemTerminal('phivolcs'); }} title={!systemAvailability.phivolcs ? 'Not currently available' : ''}>
              <span className="system-choice-icon" aria-hidden="true">⌁</span>
              <span className="system-choice-copy">
                <strong>Global Seismic &amp; Volcanic Monitor</strong>
                <span>Explore global earthquakes, volcanoes and reported eruptions.</span>
                {!systemAvailability.phivolcs && <small className="system-choice-badge unavailable">NOT CURRENTLY AVAILABLE</small>}
              </span>
              <span className="system-choice-arrow" aria-hidden="true">↗</span>
            </button>
            <button className={'system-choice system-choice-primary system-choice-lab' + (!systemAvailability['plate-lab'] ? ' system-choice-closed' : '')} type="button" onClick={() => openSystem('plate-lab')} onContextMenu={(event) => { event.preventDefault(); openSystemTerminal('plate-lab'); }} title={!systemAvailability['plate-lab'] ? 'Not currently available' : ''}>
              <span className="system-choice-icon" aria-hidden="true">⌁</span>
              <span className="system-choice-copy">
                <strong>Plate Tectonics Laboratory</strong>
                <span>Explore boundary types, experiment with plate movement and see what happens beneath the crust.</span>
                <small className="system-choice-badge beta">BETA</small>
                {!systemAvailability['plate-lab'] && <small className="system-choice-badge unavailable">NOT CURRENTLY AVAILABLE</small>}
              </span>
              <span className="system-choice-arrow" aria-hidden="true">↗</span>
            </button>
            <button className={'system-choice system-choice-primary' + (!systemAvailability['earth-sandbox'] ? ' system-choice-closed' : '')} type="button" onClick={() => openSystem('earth-sandbox')} onContextMenu={(event) => { event.preventDefault(); openSystemTerminal('earth-sandbox'); }} title={!systemAvailability['earth-sandbox'] ? 'Not currently available' : ''}>
              <span className="system-choice-icon" aria-hidden="true">◇</span>
              <span className="system-choice-copy">
                <strong>Earth Sandbox Simulator</strong>
                <span>Build your own Earth and experiment with gravity, air resistance, motion and impacts.</span>
                {!systemAvailability['earth-sandbox'] && <small className="system-choice-badge unavailable">NOT CURRENTLY AVAILABLE</small>}
              </span>
              <span className="system-choice-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
          <p className="system-landing-note">More Earth systems will be added here over time.</p>
        </section>
        {renderTerminal()}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button
            className="brand-mark"
            type="button"
            onClick={() => {
              diagnostic('info', 'UI', 'Returned to the system chooser from the Earth icon');
              setTerminalOpen(false);
              setSystemSelected('landing');
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              diagnostic('info', 'UI', 'Diagnostics terminal opened from the Earth icon context menu', {
                program: 'Past Globe',
                age,
                keyframe: keyframeAge,
                cache: cacheProgress.cached + '/' + cacheProgress.total,
              });
              openSystemTerminal('past-globe');
            }}
            aria-expanded={terminalOpen}
            aria-controls="diagnostics-terminal"
            aria-label="Return to home"
          >
            <span /><span /><span />
          </button>
          <div><div className="brand-name">intheglobe</div><div className="brand-sub">where was the Earth?</div></div>
        </div>
        <div className="header-status">
          <div className="status-dot" data-status={status} /><span>{statusText}</span><span className="status-divider">·</span><span>model {modelForAge(age)}</span><span className="status-divider">·</span><span>keyframes {cacheProgress.cached}/{cacheProgress.total}</span>
        </div>
        <div className="header-actions">
          <button className="copy-system-link-button" type="button" onClick={() => copySystemLink('past-globe')} title="Copy a direct link to Past Globe">
            <span aria-hidden="true">⧉</span> {systemLinksCopied ? 'Copied' : 'Copy link'}
          </button>
          <button className="present-button" onClick={() => handleAge(0)}><span aria-hidden="true">↻</span> Present day</button>
        </div>
      </header>

      {renderTerminal()}

      <main className="experience">
        <section className="globe-stage" ref={stageRef} aria-label="Interactive Earth">
          <div className="stage-grid" aria-hidden="true" />
          <Globe
            ref={globeRef}
            width={stageRef.current?.clientWidth || window.innerWidth}
            height={Math.max(420, (stageRef.current?.clientHeight || window.innerHeight) - 88)}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl={DAY_TEXTURE}
            bumpImageUrl={BUMP_TEXTURE}
            backgroundImageUrl={STAR_TEXTURE}
            showAtmosphere
            atmosphereColor="#6fd3a8"
            atmosphereAltitude={0.17}
            polygonsData={globePolygons}
            polygonGeoJsonGeometry={(feature) => feature.geometry}
            polygonAltitude={(feature) => feature.__layer === 'tracked' ? 0.016 : 0.01}
            polygonCapColor={(feature) => {
              if (feature.__layer === 'tracked') return '#ff5caf';
              // Keep historical coastline polygons unfilled; the GPlates rings can
              // include ocean-spanning exteriors and otherwise colour the sea green.
              return 'rgba(0,0,0,0)';
            }}
            polygonSideColor={(feature) => feature.__layer === 'tracked' ? '#d43f8e' : 'rgba(0,0,0,0)'}
            polygonStrokeColor={(feature) => feature.__layer === 'tracked' ? '#ffd1ea' : 'rgba(0,0,0,0)'}
            polygonLabel={(feature) => feature.__layer === 'tracked'
              ? '<div class="globe-tooltip"><strong>' + (feature.properties?.trackedCountry || 'Tracked country') + '</strong><br/><span>Tracked territory · ' + ageLabel(age) + '</span></div>'
              : '<div class="globe-tooltip"><strong>Reconstructed landmass</strong><br/><span>' + ageLabel(age) + '</span></div>'}
            polygonTransitionDuration={reducedMotion ? 0 : isPlaying ? 850 : 500}
            pathsData={globePaths}
            pathPoints={(path) => path.points}
            pathPointLat={(point) => point[1]}
            pathPointLng={(point) => point[0]}
            pathColor={(path) => path.kind === 'historical-coastline'
              ? '#8ebd72'
              : path.kind === 'country'
                ? (path.age < 0.1 ? 'rgba(255,255,255,0.78)' : 'rgba(231,247,239,0.28)')
                : path.type === 'Divergent' ? '#78ddb5' : path.type === 'Convergent' ? '#f0ad75' : '#9ac8ff'}
            pathStroke={(path) => path.kind === 'historical-coastline' ? 0.9 : path.kind === 'country' ? (path.age < 0.1 ? 0.95 : 0.65) : 2.1}
            pathAltitude={(path) => path.kind === 'country' ? 0.025 : 0.03}
            pathResolution={3}
            pathDashLength={(path) => path.kind === 'country' ? 1 : path.kind === 'historical-coastline' ? 1 : (plateMode ? 0.62 : 0)}
            pathDashGap={(path) => path.kind === 'country' || path.kind === 'historical-coastline' ? 0 : (plateMode ? 0.28 : 0)}
            pathDashAnimateTime={2600}
            pathLabel={(path) => path.kind === 'plate'
              ? '<div class="globe-tooltip"><strong>' + path.name + '</strong><br/><span>' + path.type + ' boundary · Click to explore</span></div>'
              : ''}
            onPathClick={(path) => {
              if (path?.kind !== 'plate') return;
              if (!systemAvailability['plate-lab']) {
                setSystemAvailabilityNotice('Plate Tectonics Laboratory is NOT CURRENTLY AVAILABLE.');
                setSystemSelected('landing');
                return;
              }
              setSystemAvailabilityNotice('');
              setLabInitialBoundaryName(path.name);
              setSystemSelected('plate-lab');
              setTerminalOpen(false);
              diagnostic('info', 'UI', 'Opened the Plate Tectonics Laboratory from a boundary overlay', {
                boundary: path.name,
                type: path.type,
              });
            }}
            showPointerCursor={(objectType, objectData) => objectType === 'path' && objectData?.kind === 'plate'}
            lineHoverPrecision={2}
            pointsData={eventMode ? visibleEvents : []}
            pointLat={(point) => point.lat}
            pointLng={(point) => point.lng}
            pointColor={(point) => point.tag === 'Supercontinent' ? '#f2c56c' : '#d4f0cd'}
            pointRadius={0.42}
            pointAltitude={0.027}
            pointResolution={16}
            onPointClick={jumpToEvent}
            pointLabel={(point) => '<div class="globe-tooltip"><strong>' + point.name + '</strong><br/><span>' + shortAge(point.ma) + ' · ' + point.tag + '</span></div>'}
            enablePointerInteraction
            showGraticules
          />

          <div className="stage-vignette" aria-hidden="true" />
          <div className="hero-overlay">
            <div className="age-badge">
              <span className="age-badge-kicker">You are here in time</span>
              <strong>{ageLabel(age)}</strong>
              <small>{period.label} · {period.era}</small>
            </div>
            <div className="explore-hint"><span className="hint-icon">✦</span><span>Drag to rotate · scroll to zoom · scrub to travel through time</span></div>
          </div>

          {status === 'loading' && <div className="loading-chip"><span className="spinner" /><span>{statusText}</span></div>}

          {status === 'error' && (
            <div className="error-card">
              <strong>Earth data unavailable</strong>
              <span>The globe needs the public world geometry feed to render. Reload the page to retry.</span>
              <button onClick={() => window.location.reload()}>Reload</button>
            </div>
          )}

          <div className="stage-controls">
            <button className={autoRotate ? 'control active' : 'control'} onClick={() => setAutoRotate((value) => !value)} aria-pressed={autoRotate}>↻<span>Spin</span></button>
            <button className={plateMode ? 'control active' : 'control'} onClick={() => setPlateMode((value) => !value)} aria-pressed={plateMode}>◈<span>Plates</span></button>
            <button className={eventMode ? 'control active' : 'control'} onClick={() => setEventMode((value) => !value)} aria-pressed={eventMode}>✦<span>Events</span></button>
          </div>
        </section>

        <aside className="right-rail">
          <div className="rail-panel search-panel">
            <div className="panel-eyebrow">Explore</div>
            <div className="search-box">
              <span aria-hidden="true">⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a period, event, or plate…" aria-label="Search geological periods, events, and tectonic plates" />
              {search && <button onClick={() => setSearch('')} aria-label="Clear search">×</button>}
            </div>
            {results.length > 0 && (
              <div className="search-results">
                {results.map((result) => (
                  <button key={result.type + '-' + (result.key || result.id || result.code)} className="result" onClick={() => selectResult(result)}>
                    <span className="result-type">{result.type}</span>
                    <span className="result-copy">
                      <strong>{result.label || result.name}</strong>
                      <small>{result.type === 'period' ? shortAge(result.ma) : result.type === 'event' ? shortAge(result.ma) + ' · ' + result.tag : result.code}</small>
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rail-panel country-panel">
            <div className="panel-eyebrow">Track my country</div>
            <div className="country-search-box">
              <span aria-hidden="true">⌕</span>
              <input
                value={countrySearch}
                onChange={(event) => setCountrySearch(event.target.value)}
                placeholder={trackedCountry ? (trackedCountry.properties?.name || 'Tracked country') : 'Search for a country…'}
                aria-label="Search for a country to track through geological time"
              />
              {(countrySearch || trackedCountry) && (
                <button type="button" onClick={() => {
                  setCountrySearch('');
                  if (trackedCountry) clearTrackedCountry();
                }} aria-label="Clear country tracking">×</button>
              )}
            </div>
            {countryResults.length > 0 && (
              <div className="country-results">
                {countryResults.map((country) => (
                  <button key={countryKey(country)} className="country-result" type="button" onClick={() => selectCountry(country)}>
                    <span className="country-flag" aria-hidden="true">●</span>
                    <span>
                      <strong>{country.properties?.name || countryKey(country)}</strong>
                      <small>Track this territory through time</small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            )}
            {trackedCountry && (
              <div className="tracked-country-status">
                <span className="tracked-country-swatch" aria-hidden="true" />
                <div>
                  <small>TRACKING</small>
                  <strong>{trackedCountry.properties?.name || countryKey(trackedCountry)}</strong>
                  <span>{
                    age < 0.1
                      ? 'Present-day territory highlighted'
                      : trackedCountryStatus === 'loading'
                        ? (trackedCountryProgress.total > 0
                          ? 'Reconstructing ancestral pieces · ' + trackedCountryProgress.completed + '/' + trackedCountryProgress.total + ' batches'
                          : 'Reconstructing ancestral pieces…')
                        : trackedCountryStatus === 'ready'
                          ? 'Pink = reconstructed territory at this keyframe'
                          : trackedCountryStatus === 'partial'
                            ? 'Partial highlight · ' + trackedCountryProgress.completed + '/' + trackedCountryProgress.total + ' batches loaded'
                            : 'Reconstruction unavailable; check diagnostics'
                  }</span>
                </div>
              </div>
            )}
          </div>

          <div className="rail-panel story-panel">
            <div className="panel-eyebrow">Right now</div>
            <div className="story-kicker">{selected.kicker || period.label}</div>
            <h2>{selected.title}</h2>
            <p className="story-summary">{selected.summary}</p>
            {selected.body && <p className="story-body">{selected.body}</p>}
            <div className="fact-strip">
              <div><span>Model</span><strong>{modelForAge(age)}</strong></div>
              <div><span>Position</span><strong>{shortAge(age)}</strong></div>
            </div>
          </div>

          <div className="rail-panel facts-panel">
            <div className="panel-eyebrow">Build intuition</div>
            {GEOLOGIC_FACTS.map((fact) => (
              <details key={fact.label}>
                <summary>{fact.label}<span>+</span></summary>
                <p>{fact.text}</p>
              </details>
            ))}
          </div>
        </aside>
      </main>

      <section className="timeline" aria-label="Geological timeline">
        <div className="timeline-header">
          <div><div className="panel-eyebrow">Geological time</div><strong>{direction}</strong></div>
          <div className="timeline-readout"><span>{shortAge(age)}</span><small>1.8 Ga ← · NOW →</small></div>
        </div>

        <div className="slider-wrap">
          <input type="range" min="0" max={MAX_AGE} step="1" value={age} onChange={(event) => handleAge(event.target.value)} aria-label="Travel through geological time" />
          <div className="timeline-track" aria-hidden="true">
            {EVENTS.map((event) => (
              <button key={event.id} className="timeline-event" style={{ left: ((1 - event.ma / MAX_AGE) * 100) + '%' }} onClick={() => jumpToEvent(event)} title={event.name + ' — ' + shortAge(event.ma)} aria-label={'Jump to ' + event.name} />
            ))}
          </div>
          <div className="timeline-labels" aria-hidden="true"><span>1.8 Ga</span><span>1.5 Ga</span><span>1 Ga</span><span>500 Ma</span><span>250 Ma</span><span>NOW</span></div>
        </div>

        <div className="timeline-actions">
          <button className="play-button" onClick={() => age > 0 && setIsPlaying((value) => !value)} disabled={age <= 0} aria-label={isPlaying ? 'Pause geological time playback' : age > 0 ? 'Play geological time forward toward the present' : 'At present day'}><span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>{isPlaying ? 'Pause journey' : age > 0 ? 'Play forward' : 'At present'}</button>
          <button className="reset-button" onClick={resetFrames} disabled={isResettingCache} aria-label="Reset all locally cached geological frames"><span aria-hidden="true">↺</span>{isResettingCache ? 'Resetting…' : 'Reset frames'}</button>
          <label className="toggle">
            <input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} />
            <span className="toggle-track" /><span>Reduce motion</span>
          </label>
        </div>
      </section>

      <footer className="footer-bar">
        <span>intheglobe · an exploratory educational reconstruction</span>
        <span>Historical positions are model-dependent approximations, especially in deep time.</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
