/**
 * Shared geographic utility functions.
 * Extracted from SurveyMapModal.jsx + new helpers for map tools.
 */

const R = 6_371_000 // Earth radius in meters
const toRad = d => d * Math.PI / 180
const toDeg = r => r * 180 / Math.PI

/** Haversine distance in meters between two GPS points. */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Bearing in radians (CW from north) between two GPS points. */
export function gpsBearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1)
  const y = Math.sin(dLon) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon)
  return Math.atan2(y, x)
}

/** Bearing in degrees (0-360). */
export function bearingDegrees(lat1, lon1, lat2, lon2) {
  return ((toDeg(gpsBearing(lat1, lon1, lat2, lon2)) % 360) + 360) % 360
}

/** Spherical polygon area in square meters (Shoelace on sphere). */
export function polygonAreaSqMeters(vertices) {
  if (!vertices || vertices.length < 3) return 0
  let total = 0
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const lat1 = toRad(vertices[i].lat ?? vertices[i][0])
    const lon1 = toRad(vertices[i].lon ?? vertices[i][1])
    const lat2 = toRad(vertices[j].lat ?? vertices[j][0])
    const lon2 = toRad(vertices[j].lon ?? vertices[j][1])
    total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2))
  }
  return Math.abs(total * R * R / 2)
}

/** Convert square meters to acres. */
export function sqMetersToAcres(sqm) {
  return sqm / 4046.8564224
}

/** Format distance with auto unit (m/km or ft/mi). */
export function formatDistance(meters, preferFeet = false) {
  if (preferFeet) {
    const feet = meters * 3.28084
    return feet >= 5280
      ? `${(feet / 5280).toFixed(2)} mi`
      : `${Math.round(feet)} ft`
  }
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${meters.toFixed(1)} m`
}

/** Interpolate N points along a great circle between two GPS points. */
export function interpolatePoints(lat1, lon1, lat2, lon2, count) {
  const points = []
  const phi1 = toRad(lat1), lam1 = toRad(lon1)
  const phi2 = toRad(lat2), lam2 = toRad(lon2)
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((phi2 - phi1) / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
  ))
  if (d < 1e-10) return [{ lat: lat1, lon: lon1 }]
  for (let i = 0; i <= count; i++) {
    const f = i / count
    const A = Math.sin((1 - f) * d) / Math.sin(d)
    const B = Math.sin(f * d) / Math.sin(d)
    const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2)
    const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2)
    const z = A * Math.sin(phi1) + B * Math.sin(phi2)
    points.push({
      lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
      lon: toDeg(Math.atan2(y, x)),
    })
  }
  return points
}
