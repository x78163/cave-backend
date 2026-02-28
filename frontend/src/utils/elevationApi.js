/**
 * USGS 3DEP elevation query API wrapper.
 * Uses the ImageServer getSamples endpoint to retrieve elevation values.
 */

const BASE_URL = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'

/**
 * Query elevation at multiple GPS points using USGS 3DEP.
 * @param {Array<{lat: number, lon: number}>} points
 * @returns {Promise<Array<{lat, lon, elevation}>>} elevation in meters
 */
export async function getElevations(points) {
  const geometry = {
    points: points.map(p => [p.lon, p.lat]), // ArcGIS: x=lon, y=lat
    spatialReference: { wkid: 4326 },
  }
  const params = new URLSearchParams({
    geometry: JSON.stringify(geometry),
    geometryType: 'esriGeometryMultipoint',
    returnFirstValueOnly: 'true',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'json',
  })

  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(`${BASE_URL}/getSamples?${params}`)
      if (resp.status === 503 || resp.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      if (!resp.ok) throw new Error(`3DEP API error: ${resp.status}`)
      const data = await resp.json()
      return (data.samples || []).map((s, i) => ({
        lat: points[i].lat,
        lon: points[i].lon,
        elevation: s.value === 'NoData' ? null : parseFloat(s.value),
      }))
    } catch (err) {
      lastErr = err
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw lastErr || new Error('3DEP API failed')
}

/**
 * Get elevation profile between two points.
 * Samples N points along the great circle path.
 */
export async function getElevationProfile(lat1, lon1, lat2, lon2, sampleCount = 50) {
  const { interpolatePoints, haversineMeters } = await import('./geoUtils')
  const points = interpolatePoints(lat1, lon1, lat2, lon2, sampleCount)
  const totalDist = haversineMeters(lat1, lon1, lat2, lon2)

  // Batch in groups of 50 for API limits
  const BATCH = 50
  const results = []
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH)
    const elevations = await getElevations(batch)
    results.push(...elevations)
  }

  return results.map((r, i) => ({
    ...r,
    distance: (i / sampleCount) * totalDist,
  }))
}
