import { toPoint as mgrsToPoint } from 'mgrs'
import { toLatLon as utmToLatLon } from 'utm'

/**
 * Universal coordinate parser.
 * Accepts decimal degrees, DMS, DDM, UTM, MGRS, Google Maps/Earth URLs,
 * Apple Maps URLs, and various separators.
 *
 * @param {string} input — raw user input
 * @returns {{ lat: number, lon: number }} — decimal degrees
 * @throws {Error} — if the input cannot be parsed
 */
export default function parseCoordinates(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('No coordinate input provided')
  }

  const trimmed = input.trim()
  if (!trimmed) throw new Error('No coordinate input provided')

  // 1. Google Maps / Earth URL
  const urlResult = tryParseURL(trimmed)
  if (urlResult) return validate(urlResult)

  // 1b. Shortened map URL — needs backend resolution
  if (isUnresolvedMapUrl(trimmed)) {
    const err = new Error('Resolving shortened URL...')
    err.needsBackendResolve = true
    err.url = trimmed
    throw err
  }

  // 2. MGRS (e.g. "16SFJ9912347456" or "16S FJ 99123 47456")
  const mgrsResult = tryParseMGRS(trimmed)
  if (mgrsResult) return validate(mgrsResult)

  // 3. UTM (e.g. "16S 599123 3947456" or "16 S 599123 3947456")
  const utmResult = tryParseUTM(trimmed)
  if (utmResult) return validate(utmResult)

  // 4. DMS / DDM / Decimal degrees
  const dmsResult = tryParseDMS(trimmed)
  if (dmsResult) return validate(dmsResult)

  throw new Error('Could not parse coordinates. Try decimal degrees (e.g. 35.658, -85.588)')
}

/**
 * Detect shortened map URLs that need server-side redirect resolution.
 */
function isUnresolvedMapUrl(input) {
  const shortDomains = ['maps.app.goo.gl', 'goo.gl/maps']
  return shortDomains.some(d => input.includes(d))
}

function validate({ lat, lon }) {
  if (lat < -90 || lat > 90) throw new Error(`Latitude ${lat} out of range [-90, 90]`)
  if (lon < -180 || lon > 180) throw new Error(`Longitude ${lon} out of range [-180, 180]`)
  return { lat: round6(lat), lon: round6(lon) }
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6
}

// --- URL parsing ---

function tryParseURL(input) {
  if (!input.includes('http') && !input.includes('maps') && !input.includes('earth')) {
    return null
  }

  // Google Maps: !3d<lat>!4d<lon> — exact pin location (highest priority)
  const bangMatch = input.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/)
  if (bangMatch) return { lat: parseFloat(bangMatch[1]), lon: parseFloat(bangMatch[2]) }

  // Google Maps short link: place/lat,lon
  const placeMatch = input.match(/place\/(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (placeMatch) return { lat: parseFloat(placeMatch[1]), lon: parseFloat(placeMatch[2]) }

  // Apple Maps: ll=lat,lon or q=lat,lon
  const llMatch = input.match(/[?&](?:ll|q|sll)=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (llMatch) return { lat: parseFloat(llMatch[1]), lon: parseFloat(llMatch[2]) }

  // Google Maps/Earth: /@lat,lon — viewport center (lowest priority, less precise)
  const atMatch = input.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (atMatch) return { lat: parseFloat(atMatch[1]), lon: parseFloat(atMatch[2]) }

  return null
}

// --- MGRS parsing ---

const MGRS_RE = /^\d{1,2}\s*[C-HJ-NP-X]\s*[A-HJ-NP-Z]{2}\s*\d{2,10}$/i

function tryParseMGRS(input) {
  const compact = input.replace(/\s+/g, '')
  if (!MGRS_RE.test(compact)) return null
  // Ensure even number of digits after the 2-letter grid square ID
  const digitsPart = compact.replace(/^\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}/i, '')
  if (digitsPart.length % 2 !== 0) return null
  try {
    const [lon, lat] = mgrsToPoint(compact.toUpperCase())
    return { lat, lon }
  } catch {
    return null
  }
}

// --- UTM parsing ---

// Matches: "16S 599123 3947456" or "16 S 599123 3947456" or "Zone 16S 599123E 3947456N"
const UTM_RE = /^(?:zone\s*)?(\d{1,2})\s*([C-HJ-NP-X])\s+(\d{4,7})(?:\s*E)?\s+(\d{4,8})(?:\s*N)?$/i

function tryParseUTM(input) {
  const m = input.match(UTM_RE)
  if (!m) return null
  const zoneNum = parseInt(m[1], 10)
  const zoneLetter = m[2].toUpperCase()
  const easting = parseFloat(m[3])
  const northing = parseFloat(m[4])
  if (zoneNum < 1 || zoneNum > 60) return null
  try {
    const { latitude, longitude } = utmToLatLon(easting, northing, zoneNum, zoneLetter)
    return { lat: latitude, lon: longitude }
  } catch {
    return null
  }
}

// --- DMS / DDM / Decimal degrees parsing ---

function tryParseDMS(input) {
  // Normalize: replace degree/minute/second symbols with spaces
  let s = input
    .replace(/[°ºᵒ]/g, ' ')
    .replace(/[′'ʹ]/g, ' ')
    .replace(/[″"ʺ]/g, ' ')
    .replace(/,/g, ' ')
    .replace(/;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Extract cardinal directions
  const cardinals = s.match(/[NSEW]/gi) || []
  s = s.replace(/[NSEW]/gi, ' ').replace(/\s+/g, ' ').trim()

  // Extract all numbers (including negatives and decimals)
  const nums = s.match(/-?\d+\.?\d*/g)
  if (!nums || nums.length < 2) return null

  const values = nums.map(Number)
  let lat, lon

  if (values.length === 2) {
    // Decimal degrees: "35.658 -85.588"
    lat = values[0]
    lon = values[1]
  } else if (values.length === 4) {
    // Degrees + decimal minutes: "35 39.483 85 35.283"
    lat = dmsToDecimal(values[0], values[1], 0)
    lon = dmsToDecimal(values[2], values[3], 0)
  } else if (values.length === 6) {
    // DMS: "35 39 29 85 35 17"
    lat = dmsToDecimal(values[0], values[1], values[2])
    lon = dmsToDecimal(values[3], values[4], values[5])
  } else {
    return null
  }

  // Apply cardinal direction signs
  if (cardinals.length >= 1) {
    const c0 = cardinals[0].toUpperCase()
    if (c0 === 'S') lat = -Math.abs(lat)
    if (c0 === 'N') lat = Math.abs(lat)
    if (c0 === 'W') lon = -Math.abs(lon)
    if (c0 === 'E') lon = Math.abs(lon)
  }
  if (cardinals.length >= 2) {
    const c1 = cardinals[1].toUpperCase()
    if (c1 === 'S') lat = -Math.abs(lat)
    if (c1 === 'W') lon = -Math.abs(lon)
    if (c1 === 'E') lon = Math.abs(lon)
    if (c1 === 'N') lat = Math.abs(lat)
  }

  // Heuristic: if |lat| > 90 but |lon| <= 90, they might be swapped
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) {
    ;[lat, lon] = [lon, lat]
  }

  return { lat, lon }
}

function dmsToDecimal(degrees, minutes, seconds) {
  const sign = degrees < 0 ? -1 : 1
  return sign * (Math.abs(degrees) + Math.abs(minutes) / 60 + Math.abs(seconds) / 3600)
}
