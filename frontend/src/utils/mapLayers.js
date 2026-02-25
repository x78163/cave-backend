/**
 * Map tile layer configurations for SurfaceMap.
 * All layers are free and require no API keys.
 */

export const BASE_LAYERS = [
  {
    id: 'osm',
    label: 'Street',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 21, maxNativeZoom: 19, minZoom: 3 },
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    filter: 'brightness(0.6) invert(1) contrast(1.3) hue-rotate(200deg) saturate(0.3) brightness(0.8)',
  },
  {
    id: 'esri_imagery',
    label: 'Satellite',
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 21, minZoom: 3 },
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    filter: 'brightness(0.85) saturate(0.8)',
  },
  {
    id: 'usgs_topo',
    label: 'USGS Topo',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 21, maxNativeZoom: 16, minZoom: 3 },
    attribution: '&copy; <a href="https://www.usgs.gov">USGS</a> The National Map',
    filter: 'brightness(0.7) saturate(0.6) contrast(1.1)',
  },
  {
    id: 'usgs_imagery_topo',
    label: 'Hybrid',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 21, maxNativeZoom: 16, minZoom: 3 },
    attribution: '&copy; <a href="https://www.usgs.gov">USGS</a> The National Map',
    filter: 'brightness(0.85) saturate(0.8)',
  },
  {
    id: 'usgs_shaded_relief',
    label: 'Relief',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 21, maxNativeZoom: 16, minZoom: 3 },
    attribution: '&copy; <a href="https://www.usgs.gov">USGS</a> The National Map',
    filter: 'brightness(0.8) contrast(1.2) invert(1) hue-rotate(180deg) saturate(0.2)',
  },
  {
    id: 'opentopomap',
    label: 'OpenTopo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 21, maxNativeZoom: 17, minZoom: 3, subdomains: 'abc' },
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    filter: 'brightness(0.65) invert(1) contrast(1.2) hue-rotate(200deg) saturate(0.4) brightness(0.8)',
  },
]

/**
 * USGS 3DEP LiDAR Hillshade overlay — high-resolution elevation data.
 * Uses ArcGIS ImageServer exportImage endpoint with Hillshade raster function.
 * Great for spotting sinkholes, karst features, and terrain anomalies.
 */
export const HILLSHADE_OVERLAY = {
  id: '3dep_hillshade',
  label: '3DEP LiDAR',
  attribution: '&copy; <a href="https://www.usgs.gov/3d-elevation-program">USGS 3DEP</a>',
}

const STORAGE_KEY = 'surface_map_layer'
const OVERLAY_STORAGE_KEY = 'surface_map_hillshade'
export const DEFAULT_LAYER_ID = 'osm'

export function getStoredLayerId() {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    return id && BASE_LAYERS.some(l => l.id === id) ? id : DEFAULT_LAYER_ID
  } catch {
    return DEFAULT_LAYER_ID
  }
}

export function storeLayerId(id) {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
}

export function getLayerById(id) {
  return BASE_LAYERS.find(l => l.id === id) || BASE_LAYERS[0]
}

export function getStoredHillshade() {
  try { return localStorage.getItem(OVERLAY_STORAGE_KEY) === 'true' } catch { return false }
}

export function storeHillshade(on) {
  try { localStorage.setItem(OVERLAY_STORAGE_KEY, on ? 'true' : 'false') } catch { /* ignore */ }
}

/**
 * Create a Leaflet TileLayer for the USGS 3DEP hillshade.
 * Converts tile coords to Web Mercator (EPSG:3857) bounding box for the
 * ArcGIS ImageServer exportImage endpoint. Using 3857 natively avoids
 * reprojection seams that occur when sending WGS84 bboxes.
 */
const ORIGIN = 20037508.342789244 // Web Mercator half-circumference

function tileToWebMercatorBbox(x, y, z) {
  const size = 2 * ORIGIN / Math.pow(2, z)
  const xMin = -ORIGIN + x * size
  const xMax = xMin + size
  const yMax = ORIGIN - y * size
  const yMin = yMax - size
  return [xMin, yMin, xMax, yMax]
}

export function create3DEPHillshadeLayer(L) {
  const HillshadeLayer = L.TileLayer.extend({
    getTileUrl(coords) {
      const [xMin, yMin, xMax, yMax] = tileToWebMercatorBbox(coords.x, coords.y, coords.z)
      const bbox = `${xMin},${yMin},${xMax},${yMax}`
      const size = this.getTileSize()
      return `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`
        + `?bbox=${bbox}&bboxSR=3857&imageSR=3857`
        + `&size=${size.x},${size.y}`
        + `&format=png`
        + `&renderingRule=${encodeURIComponent(JSON.stringify({ rasterFunction: 'Hillshade' }))}`
        + `&f=image`
    },
  })

  return new HillshadeLayer('', {
    maxZoom: 21,
    maxNativeZoom: 17,
    minZoom: 3,
    opacity: 0.5,
    attribution: HILLSHADE_OVERLAY.attribution,
  })
}
