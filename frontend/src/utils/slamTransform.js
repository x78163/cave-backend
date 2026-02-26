/**
 * Multi-point SLAM-to-LatLng registration.
 *
 * When 2+ entrance POIs have both SLAM coordinates (slam_x, slam_y) and
 * GPS coordinates (latitude, longitude), we solve for a 2D similarity
 * transformation (scale + rotation + translation) that maps SLAM frame
 * meters to geographic coordinates. This replaces the simpler single-point
 * heading-based conversion with a best-fit transform.
 *
 * With 0-1 control points, falls back to the original slamToLatLng behavior.
 */

const DEG_TO_M = 111320 // meters per degree of latitude

/**
 * Convert SLAM coordinates to lat/lon using a flat-earth approximation.
 * Backward-compatible single-point conversion.
 */
export function slamToLatLng(slamX, slamY, anchorLat, anchorLon, headingDeg) {
  const h = (headingDeg || 0) * Math.PI / 180
  const eastM  =  slamX * Math.cos(h) + slamY * Math.sin(h)
  const northM = -slamX * Math.sin(h) + slamY * Math.cos(h)
  const lat = anchorLat + northM / DEG_TO_M
  const lon = anchorLon + eastM / (DEG_TO_M * Math.cos(anchorLat * Math.PI / 180))
  return [lat, lon]
}

/**
 * Compute a 2D similarity transform from SLAM control points to meters.
 *
 * The transform maps SLAM (sx, sy) → local meters (mx, my) relative to anchor:
 *   mx = a*sx - b*sy + tx
 *   my = b*sx + a*sy + ty
 *
 * where a = scale*cos(θ), b = scale*sin(θ).
 *
 * @param {Array<{slamX: number, slamY: number, lat: number, lon: number}>} controlPoints
 * @param {number} anchorLat - Primary entrance latitude (reference point)
 * @param {number} anchorLon - Primary entrance longitude (reference point)
 * @param {number} fallbackHeadingDeg - SLAM heading used when < 2 control points
 * @returns {{ a: number, b: number, tx: number, ty: number }}
 */
export function computeSimilarityTransform(controlPoints, anchorLat, anchorLon, fallbackHeadingDeg) {
  const cosLat = Math.cos(anchorLat * Math.PI / 180)

  // Convert GPS to meters relative to anchor
  const pairs = controlPoints.map(cp => ({
    sx: cp.slamX,
    sy: cp.slamY,
    mx: (cp.lon - anchorLon) * DEG_TO_M * cosLat,
    my: (cp.lat - anchorLat) * DEG_TO_M,
  }))

  if (pairs.length === 0) {
    // No control points — use fallback heading, scale=1, no translation
    const h = (fallbackHeadingDeg || 0) * Math.PI / 180
    return { a: Math.cos(h), b: -Math.sin(h), tx: 0, ty: 0 }
  }

  if (pairs.length === 1) {
    // Single point — use fallback heading for rotation, compute translation
    const h = (fallbackHeadingDeg || 0) * Math.PI / 180
    const a = Math.cos(h), b = -Math.sin(h)
    const p = pairs[0]
    const tx = p.mx - (a * p.sx - b * p.sy)
    const ty = p.my - (b * p.sx + a * p.sy)
    return { a, b, tx, ty }
  }

  // N >= 2: Least-squares similarity transform
  // Solve: [mx_i] = [sx_i  -sy_i  1  0] [a ]
  //        [my_i]   [sy_i   sx_i  0  1] [b ]
  //                                      [tx]
  //                                      [ty]
  //
  // Normal equations: (A^T A) x = A^T b
  let sumSx2Sy2 = 0, sumSxMx = 0, sumSyMx = 0, sumSxMy = 0, sumSyMy = 0
  let sumSx = 0, sumSy = 0, sumMx = 0, sumMy = 0
  const n = pairs.length

  for (const p of pairs) {
    sumSx2Sy2 += p.sx * p.sx + p.sy * p.sy
    sumSxMx += p.sx * p.mx
    sumSyMx += p.sy * p.mx
    sumSxMy += p.sx * p.my
    sumSyMy += p.sy * p.my
    sumSx += p.sx
    sumSy += p.sy
    sumMx += p.mx
    sumMy += p.my
  }

  // System: [S  0  Σsx -Σsy] [a ]   [ΣsxMx + ΣsyMy]
  //         [0  S  Σsy  Σsx] [b ] = [ΣsxMy - ΣsyMx]
  //         [Σsx Σsy n  0  ] [tx]   [ΣMx          ]
  //         [-Σsy Σsx 0 n  ] [ty]   [ΣMy          ]
  //
  // Where S = Σ(sx² + sy²)
  // Solve via direct formula for 4x4 block structure
  const S = sumSx2Sy2
  const rhs1 = sumSxMx + sumSyMy
  const rhs2 = sumSxMy - sumSyMx

  // Using block elimination:
  // First solve for a, b from the reduced system, then get tx, ty
  const det = S * n - sumSx * sumSx - sumSy * sumSy
  if (Math.abs(det) < 1e-12) {
    // Degenerate — fall back to heading-based
    const h = (fallbackHeadingDeg || 0) * Math.PI / 180
    return { a: Math.cos(h), b: -Math.sin(h), tx: 0, ty: 0 }
  }

  const a = (n * rhs1 - sumSx * sumMx - sumSy * sumMy) / det
  const b = (n * rhs2 - sumSx * sumMy + sumSy * sumMx) / det
  const tx = (sumMx - a * sumSx + b * sumSy) / n
  const ty = (sumMy - b * sumSx - a * sumSy) / n

  return { a, b, tx, ty }
}

/**
 * Create a converter function from a precomputed similarity transform.
 *
 * @param {{ a: number, b: number, tx: number, ty: number }} transform
 * @param {number} anchorLat
 * @param {number} anchorLon
 * @returns {(slamX: number, slamY: number) => [number, number]}
 */
export function createSlamToLatLng(transform, anchorLat, anchorLon) {
  const { a, b, tx, ty } = transform
  const cosLat = Math.cos(anchorLat * Math.PI / 180)

  return (slamX, slamY) => {
    const mx = a * slamX - b * slamY + tx
    const my = b * slamX + a * slamY + ty
    const lat = anchorLat + my / DEG_TO_M
    const lon = anchorLon + mx / (DEG_TO_M * cosLat)
    return [lat, lon]
  }
}
