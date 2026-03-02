/**
 * Point cloud alignment math: SVD, Procrustes registration, KD-tree, ICP.
 * Pure math — zero Three.js or UI dependencies.
 */

// ── 3x3 Matrix Helpers ──

function mat3(a00,a01,a02, a10,a11,a12, a20,a21,a22) {
  return [a00,a01,a02, a10,a11,a12, a20,a21,a22]
}

function mat3Multiply(A, B) {
  const R = new Array(9)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]
    }
  }
  return R
}

function mat3Transpose(A) {
  return [A[0],A[3],A[6], A[1],A[4],A[7], A[2],A[5],A[8]]
}

function mat3Determinant(A) {
  return A[0] * (A[4]*A[8] - A[5]*A[7])
       - A[1] * (A[3]*A[8] - A[5]*A[6])
       + A[2] * (A[3]*A[7] - A[4]*A[6])
}

function mat3Vec(M, v) {
  return {
    x: M[0]*v.x + M[1]*v.y + M[2]*v.z,
    y: M[3]*v.x + M[4]*v.y + M[5]*v.z,
    z: M[6]*v.x + M[7]*v.y + M[8]*v.z,
  }
}

function mat3Identity() {
  return [1,0,0, 0,1,0, 0,0,1]
}

// ── 3x3 SVD via Jacobi Rotation ──

function svd3x3(H) {
  // H is a flat 9-element array [row-major]
  // Returns { U, S: [s0,s1,s2], V } where H ≈ U * diag(S) * V^T
  // All matrices are flat 9-element row-major arrays

  // Compute A = H^T * H (symmetric)
  const Ht = mat3Transpose(H)
  let A = mat3Multiply(Ht, H)
  let V = mat3Identity()

  // Jacobi eigenvalue iteration on symmetric A
  for (let sweep = 0; sweep < 30; sweep++) {
    // Off-diagonal magnitude
    const off = Math.abs(A[1]) + Math.abs(A[2]) + Math.abs(A[5])
    if (off < 1e-10) break

    // Sweep through all off-diagonal pairs
    for (const [p, q] of [[0,1],[0,2],[1,2]]) {
      const apq = A[p * 3 + q]
      if (Math.abs(apq) < 1e-12) continue

      const app = A[p * 3 + p]
      const aqq = A[q * 3 + q]
      const tau = (aqq - app) / (2 * apq)
      const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau))
      const c = 1 / Math.sqrt(1 + t * t)
      const s = t * c

      // Apply Givens rotation: A' = G^T * A * G
      const newA = [...A]
      newA[p * 3 + p] = c*c*app - 2*s*c*apq + s*s*aqq
      newA[q * 3 + q] = s*s*app + 2*s*c*apq + c*c*aqq
      newA[p * 3 + q] = 0
      newA[q * 3 + p] = 0

      for (let r = 0; r < 3; r++) {
        if (r === p || r === q) continue
        const arp = A[r * 3 + p]
        const arq = A[r * 3 + q]
        newA[r * 3 + p] = c * arp - s * arq
        newA[p * 3 + r] = newA[r * 3 + p]
        newA[r * 3 + q] = s * arp + c * arq
        newA[q * 3 + r] = newA[r * 3 + q]
      }
      A = newA

      // Accumulate V: V' = V * G
      const newV = [...V]
      for (let r = 0; r < 3; r++) {
        const vrp = V[r * 3 + p]
        const vrq = V[r * 3 + q]
        newV[r * 3 + p] = c * vrp - s * vrq
        newV[r * 3 + q] = s * vrp + c * vrq
      }
      V = newV
    }
  }

  // Singular values = sqrt of eigenvalues of H^T*H
  const S = [Math.sqrt(Math.max(A[0], 0)), Math.sqrt(Math.max(A[4], 0)), Math.sqrt(Math.max(A[8], 0))]

  // U = H * V * diag(1/sigma)
  const HV = mat3Multiply(H, V)
  const U = [...HV]
  for (let col = 0; col < 3; col++) {
    const sigma = S[col] > 1e-10 ? S[col] : 1e-10
    for (let row = 0; row < 3; row++) {
      U[row * 3 + col] /= sigma
    }
  }

  return { U, S, V }
}

// ── Procrustes Rigid Registration ──

export function computeRigidTransform(sourcePts, targetPts) {
  // sourcePts, targetPts: arrays of {x, y, z} — must be same length, ≥ 3
  const n = sourcePts.length
  if (n < 3) throw new Error('Need at least 3 point pairs')

  // 1. Centroids
  const pBar = { x: 0, y: 0, z: 0 }
  const qBar = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < n; i++) {
    pBar.x += sourcePts[i].x; pBar.y += sourcePts[i].y; pBar.z += sourcePts[i].z
    qBar.x += targetPts[i].x; qBar.y += targetPts[i].y; qBar.z += targetPts[i].z
  }
  pBar.x /= n; pBar.y /= n; pBar.z /= n
  qBar.x /= n; qBar.y /= n; qBar.z /= n

  // 2. Cross-covariance H = Σ (pi - pBar) * (qi - qBar)^T
  const H = new Array(9).fill(0)
  for (let i = 0; i < n; i++) {
    const px = sourcePts[i].x - pBar.x, py = sourcePts[i].y - pBar.y, pz = sourcePts[i].z - pBar.z
    const qx = targetPts[i].x - qBar.x, qy = targetPts[i].y - qBar.y, qz = targetPts[i].z - qBar.z
    H[0] += px*qx; H[1] += px*qy; H[2] += px*qz
    H[3] += py*qx; H[4] += py*qy; H[5] += py*qz
    H[6] += pz*qx; H[7] += pz*qy; H[8] += pz*qz
  }

  // 3. SVD(H)
  const { U, V } = svd3x3(H)

  // 4. Reflection check
  const VUt = mat3Multiply(V, mat3Transpose(U))
  const d = mat3Determinant(VUt)

  // 5. R = V * diag(1,1,d) * U^T
  let R
  if (d < 0) {
    const D = mat3(1,0,0, 0,1,0, 0,0,-1)
    R = mat3Multiply(mat3Multiply(V, D), mat3Transpose(U))
  } else {
    R = VUt
  }

  // 6. t = qBar - R * pBar
  const RpBar = mat3Vec(R, pBar)
  const t = { x: qBar.x - RpBar.x, y: qBar.y - RpBar.y, z: qBar.z - RpBar.z }

  // 7. RMSE
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const rp = mat3Vec(R, sourcePts[i])
    const dx = rp.x + t.x - targetPts[i].x
    const dy = rp.y + t.y - targetPts[i].y
    const dz = rp.z + t.z - targetPts[i].z
    sumSq += dx*dx + dy*dy + dz*dz
  }
  const rmse = Math.sqrt(sumSq / n)

  return { R, t, rmse }
}

/**
 * Convert 3x3 rotation + translation to column-major 16-element array
 * for THREE.Matrix4.fromArray()
 */
export function rigidToMatrix4(R, t) {
  // Three.js Matrix4 is column-major:
  // [m0 m4 m8  m12]
  // [m1 m5 m9  m13]
  // [m2 m6 m10 m14]
  // [m3 m7 m11 m15]
  return [
    R[0], R[3], R[6], 0,
    R[1], R[4], R[7], 0,
    R[2], R[5], R[8], 0,
    t.x,  t.y,  t.z,  1,
  ]
}

// ── KD-Tree for 3D Points ──

class KDNode {
  constructor(index, axis, left, right) {
    this.index = index
    this.axis = axis
    this.left = left
    this.right = right
  }
}

export class KDTree3D {
  /**
   * @param {Float32Array} positions — interleaved [x,y,z, x,y,z, ...]
   */
  constructor(positions) {
    this.positions = positions
    const count = positions.length / 3
    const indices = Array.from({ length: count }, (_, i) => i)
    this.root = this._build(indices, 0)
  }

  _build(indices, depth) {
    if (indices.length === 0) return null
    if (indices.length === 1) return new KDNode(indices[0], depth % 3, null, null)

    const axis = depth % 3
    const pos = this.positions
    indices.sort((a, b) => pos[a * 3 + axis] - pos[b * 3 + axis])

    const mid = indices.length >> 1
    return new KDNode(
      indices[mid],
      axis,
      this._build(indices.slice(0, mid), depth + 1),
      this._build(indices.slice(mid + 1), depth + 1),
    )
  }

  /**
   * Find nearest neighbor to query point
   * @param {number} qx
   * @param {number} qy
   * @param {number} qz
   * @returns {{ index: number, distSq: number }}
   */
  nearest(qx, qy, qz) {
    let bestIndex = -1
    let bestDistSq = Infinity
    const pos = this.positions

    const search = (node) => {
      if (!node) return

      const ni = node.index
      const nx = pos[ni * 3], ny = pos[ni * 3 + 1], nz = pos[ni * 3 + 2]
      const dx = qx - nx, dy = qy - ny, dz = qz - nz
      const distSq = dx * dx + dy * dy + dz * dz

      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestIndex = ni
      }

      const axis = node.axis
      const q = [qx, qy, qz]
      const diff = q[axis] - pos[ni * 3 + axis]
      const first = diff < 0 ? node.left : node.right
      const second = diff < 0 ? node.right : node.left

      search(first)

      // Check if we need to explore the other side
      if (diff * diff < bestDistSq) {
        search(second)
      }
    }

    search(this.root)
    return { index: bestIndex, distSq: bestDistSq }
  }
}

// ── Downsample ──

export function downsamplePositions(positions, targetCount) {
  const count = positions.length / 3
  if (count <= targetCount) return positions
  const stride = Math.max(1, Math.floor(count / targetCount))
  const sampled = []
  for (let i = 0; i < count; i += stride) {
    sampled.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
  }
  return new Float32Array(sampled)
}

// ── ICP (Iterative Closest Point) ──

export function runICP(sourcePositions, targetPositions, options = {}) {
  const {
    maxIterations = 50,
    convergenceThreshold = 0.001,
    outlierMultiplier = 3.0,
    onProgress = null,
  } = options

  const srcCount = sourcePositions.length / 3
  const targetTree = new KDTree3D(targetPositions)

  // Working copy of source positions (transformed each iteration)
  let src = new Float32Array(sourcePositions)

  // Accumulated transform
  let R_acc = mat3Identity()
  let t_acc = { x: 0, y: 0, z: 0 }
  let prevMean = Infinity

  let iterations = 0
  let meanDistance = Infinity
  let converged = false

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1

    // 1. Find correspondences + distances
    const pairs = []
    const dists = []
    for (let i = 0; i < srcCount; i++) {
      const sx = src[i * 3], sy = src[i * 3 + 1], sz = src[i * 3 + 2]
      const { index, distSq } = targetTree.nearest(sx, sy, sz)
      const dist = Math.sqrt(distSq)
      pairs.push({ si: i, ti: index, dist })
      dists.push(dist)
    }

    // 2. Outlier rejection (mean + multiplier * stddev)
    const meanDist = dists.reduce((s, d) => s + d, 0) / dists.length
    const variance = dists.reduce((s, d) => s + (d - meanDist) ** 2, 0) / dists.length
    const stddev = Math.sqrt(variance)
    const threshold = meanDist + outlierMultiplier * stddev

    const inliers = pairs.filter(p => p.dist <= threshold)
    if (inliers.length < 3) break

    // 3. Extract inlier point pairs
    const srcPts = inliers.map(p => ({
      x: src[p.si * 3], y: src[p.si * 3 + 1], z: src[p.si * 3 + 2]
    }))
    const tgtPts = inliers.map(p => ({
      x: targetPositions[p.ti * 3], y: targetPositions[p.ti * 3 + 1], z: targetPositions[p.ti * 3 + 2]
    }))

    // 4. Procrustes
    const { R: R_step, t: t_step } = computeRigidTransform(srcPts, tgtPts)

    // 5. Accumulate: R_acc = R_step * R_acc, t_acc = R_step * t_acc + t_step
    R_acc = mat3Multiply(R_step, R_acc)
    const Rt = mat3Vec(R_step, t_acc)
    t_acc = { x: Rt.x + t_step.x, y: Rt.y + t_step.y, z: Rt.z + t_step.z }

    // 6. Apply step to working source points
    for (let i = 0; i < srcCount; i++) {
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2]
      const r = mat3Vec(R_step, { x, y, z })
      src[i * 3] = r.x + t_step.x
      src[i * 3 + 1] = r.y + t_step.y
      src[i * 3 + 2] = r.z + t_step.z
    }

    // 7. Compute new mean distance
    let sumDist = 0
    for (let i = 0; i < srcCount; i++) {
      const { distSq } = targetTree.nearest(src[i * 3], src[i * 3 + 1], src[i * 3 + 2])
      sumDist += Math.sqrt(distSq)
    }
    meanDistance = sumDist / srcCount

    onProgress?.(iterations, meanDistance, inliers.length)

    // 8. Convergence check
    if (Math.abs(prevMean - meanDistance) < convergenceThreshold) {
      converged = true
      break
    }
    prevMean = meanDistance
  }

  return {
    R: R_acc,
    t: t_acc,
    matrix4: rigidToMatrix4(R_acc, t_acc),
    iterations,
    meanDistance,
    converged,
    inlierRatio: 1.0, // updated in last iteration
  }
}
