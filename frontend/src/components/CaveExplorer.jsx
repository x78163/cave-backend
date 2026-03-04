import { useRef, useEffect, useCallback, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

const PLAYER_HEIGHT = 1.6
const PLAYER_RADIUS = 0.3
const GRAVITY = 9.8
const JUMP_VELOCITY = 4.0
const SPEED = 2.0
const SPRINT_MULT = 2.5
const DAMPING = 8.0
const MAX_FALL_DISTANCE = 10
const MOUSE_SENSITIVITY = 0.002

export default function CaveExplorer({ caveId }) {
  const containerRef = useRef(null)
  const cleanupRef = useRef(null)
  const [viewMode, setViewMode] = useState('points') // 'points' or 'mesh'
  const [hasMesh, setHasMesh] = useState(false)
  const viewToggleRef = useRef(null) // called by the toggle button

  const init = useCallback((container) => {
    if (!container) return

    // ── Scene ──
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x050508)
    scene.fog = new THREE.FogExp2(0x050508, 0.08)

    const camera = new THREE.PerspectiveCamera(
      75, container.clientWidth / container.clientHeight, 0.05, 500
    )

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    container.appendChild(renderer.domElement)

    // ── Lighting ──
    const ambient = new THREE.AmbientLight(0xffffff, 0.8)
    scene.add(ambient)

    const flashlight = new THREE.SpotLight(0xffeedd, 3.0, 30, Math.PI / 5, 0.4, 1.5)
    flashlight.visible = false
    camera.add(flashlight)
    camera.add(flashlight.target)
    flashlight.position.set(0, 0, 0)
    flashlight.target.position.set(0, 0, -1)
    scene.add(camera)

    const fillLight = new THREE.PointLight(0x334455, 0.1, 15)
    fillLight.position.set(0, -2, 0)
    camera.add(fillLight)

    // ── Pointer Lock (replaces PointerLockControls for full 6DOF) ──
    let isLocked = false

    function onPointerLockChange() {
      isLocked = document.pointerLockElement === container
    }
    document.addEventListener('pointerlockchange', onPointerLockChange)

    function onMouseMove(e) {
      if (!isLocked) return

      if (noclip) {
        // 6DOF: all rotations relative to camera's own axes
        camera.rotateY(-e.movementX * MOUSE_SENSITIVITY)
        camera.rotateX(-e.movementY * MOUSE_SENSITIVITY)
      } else {
        // FPS walking: yaw around world Y, pitch around local X
        camera.rotation.order = 'YXZ'
        camera.rotation.y -= e.movementX * MOUSE_SENSITIVITY
        camera.rotation.x -= e.movementY * MOUSE_SENSITIVITY
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x))
      }
    }
    document.addEventListener('mousemove', onMouseMove)

    // ── State ──
    const moveState = { forward: false, backward: false, left: false, right: false, sprint: false, jump: false, turnLeft: false, turnRight: false }
    const velocity = new THREE.Vector3()
    const direction = new THREE.Vector3()
    let noclip = false
    let onGround = false
    let verticalVelocity = 0
    let flashlightOn = false
    let collisionMeshes = []
    let fallbackFloorY = 0

    // Layer toggle state: store all three representations
    let pointCloudObjects = []   // THREE.Points added to scene
    let meshModel = null         // THREE.Group (solid mesh scene)
    let wireframeObjects = []    // THREE.LineSegments (wireframe edges)
    let currentMode = 'points'   // 'points' | 'wireframe' | 'mesh'
    let gridHelper = null        // reference plane (points-only)

    const downRay = new THREE.Raycaster()
    const _rayOrigin = new THREE.Vector3()
    const _rayDir = new THREE.Vector3()

    // ── Floor detection ──
    function findFloor(pos) {
      if (collisionMeshes.length === 0) return fallbackFloorY
      _rayOrigin.set(pos.x, pos.y - PLAYER_HEIGHT + 0.3, pos.z)
      _rayDir.set(0, -1, 0)
      downRay.set(_rayOrigin, _rayDir)
      downRay.far = MAX_FALL_DISTANCE
      const hits = downRay.intersectObjects(collisionMeshes, false)
      if (hits.length > 0) return hits[0].point.y
      return fallbackFloorY
    }

    function checkWallCollision(pos, moveDir) {
      if (collisionMeshes.length === 0) return false
      const heights = [0.2, PLAYER_HEIGHT * 0.5, PLAYER_HEIGHT * 0.9]
      const ray = new THREE.Raycaster()
      ray.far = PLAYER_RADIUS + 0.1
      for (const h of heights) {
        _rayOrigin.set(pos.x, pos.y - PLAYER_HEIGHT + h, pos.z)
        ray.set(_rayOrigin, moveDir)
        const hits = ray.intersectObjects(collisionMeshes, false)
        if (hits.length > 0 && hits[0].distance < PLAYER_RADIUS) return true
      }
      return false
    }

    // SLAM → Three.js coordinate conversion
    function slamToThreePos(pos) {
      return new THREE.Vector3(pos[0], pos[2], -pos[1])
    }
    function slamToThreeQuat(orient) {
      const qSlam = new THREE.Quaternion(orient[0], orient[1], orient[2], orient[3])
      const coordSwap = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), -Math.PI / 2
      )
      return coordSwap.multiply(qSlam)
    }

    // ── Keyboard ──
    function onKeyDown(e) {
      if (!isLocked) return
      switch (e.code) {
        case 'KeyW': moveState.forward = true; break
        case 'KeyS': moveState.backward = true; break
        case 'KeyA': moveState.left = true; break
        case 'KeyD': moveState.right = true; break
        case 'Space': moveState.jump = true; e.preventDefault(); break
        case 'ShiftLeft': case 'ShiftRight': moveState.sprint = true; break
        case 'KeyF':
          flashlightOn = !flashlightOn
          flashlight.visible = flashlightOn
          break
        case 'KeyV':
          noclip = !noclip
          verticalVelocity = 0
          break
        case 'KeyQ': moveState.turnLeft = true; break
        case 'KeyE': moveState.turnRight = true; break
      }
    }
    function onKeyUp(e) {
      switch (e.code) {
        case 'KeyW': moveState.forward = false; break
        case 'KeyS': moveState.backward = false; break
        case 'KeyA': moveState.left = false; break
        case 'KeyD': moveState.right = false; break
        case 'Space': moveState.jump = false; break
        case 'ShiftLeft': case 'ShiftRight': moveState.sprint = false; break
        case 'KeyQ': moveState.turnLeft = false; break
        case 'KeyE': moveState.turnRight = false; break
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)

    // ── Load mesh ──
    const loader = new GLTFLoader()

    // Point cloud material — simple first, headlamp shader later
    const pointMaterial = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      sizeAttenuation: true,
    })

    async function loadAll() {
      let spawnData = null
      let pcGltf = null
      let meshGltf = null
      let wireGltf = null

      // Load spawn data (try API proxy first, then local paths)
      const spawnPaths = [
        ...(caveId ? [`/api/caves/${caveId}/media/spawn.json`] : []),
        ...(caveId
          ? [
              `/media/caves/${caveId}/spawn.json`,
              `/media/reconstruction/output/${caveId}_spawn.json`,
              '/media/reconstruction/spawn.json',
            ]
          : ['/media/reconstruction/spawn.json']),
      ]
      for (const sp of spawnPaths) {
        try {
          const resp = await fetch(sp)
          if (resp.ok) { spawnData = await resp.json(); break }
        } catch { /* try next */ }
      }

      // Helper: load GLB via fetch + parse (avoids GLTFLoader.load issues with Daphne)
      async function loadGlb(url) {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
        const buffer = await resp.arrayBuffer()
        return new Promise((resolve, reject) =>
          loader.parse(buffer, '', resolve, reject)
        )
      }

      // Cache-bust to pick up editor saves
      const cacheBust = `?t=${Date.now()}`

      // Try loading point cloud GLB
      if (caveId) {
        const pcUrls = [
          `/api/caves/${caveId}/media/cave_pointcloud.glb${cacheBust}`,
          `/media/caves/${caveId}/cave_pointcloud.glb${cacheBust}`,
        ]
        for (const pcUrl of pcUrls) {
          try { pcGltf = await loadGlb(pcUrl); break } catch { /* try next */ }
        }
      }

      // Try loading mesh + wireframe GLBs (may not exist yet if generation is in progress)
      if (caveId) {
        try {
          meshGltf = await loadGlb(`/api/caves/${caveId}/media/cave_mesh.glb${cacheBust}`)
        } catch { /* mesh not available */ }
        try {
          wireGltf = await loadGlb(`/api/caves/${caveId}/media/cave_wireframe.glb${cacheBust}`)
        } catch { /* wireframe not available */ }
      }

      // Fallback: try reconstruction API, then hardcoded path
      if (!meshGltf && caveId) {
        try {
          const res = await fetch(`/api/reconstruction/cave/${caveId}/latest/`)
          if (res.ok) {
            const job = await res.json()
            const rawUrl = job.mesh_url || job.mesh_file
            if (rawUrl) {
              const meshUrl = rawUrl.startsWith('/') ? rawUrl : new URL(rawUrl).pathname
              meshGltf = await loadGlb(meshUrl)
            }
          }
        } catch { /* no mesh */ }
      }

      // Must have at least one
      if (!pcGltf && !meshGltf) {
        try { meshGltf = await loadGlb('/media/reconstruction/textured_mesh.glb') } catch { /* nothing */ }
      }

      if (!pcGltf && !meshGltf) {
        console.error('CaveExplorer: no point cloud or mesh available')
        return
      }

      // ── Prepare point cloud objects ──
      if (pcGltf) {
        pcGltf.scene.traverse(child => {
          if (child.geometry) {
            const geo = child.geometry
            if (!geo.getAttribute('color')) {
              const count = geo.getAttribute('position').count
              const colors = new Float32Array(count * 3).fill(0.7)
              geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
            }
            const pts = new THREE.Points(geo, pointMaterial)
            pointCloudObjects.push(pts)
          }
        })
      }

      // ── Prepare mesh model (solid) ──
      if (meshGltf) {
        meshModel = meshGltf.scene
        meshModel.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true
            child.receiveShadow = true
            if (child.material) {
              child.material.vertexColors = true
              child.material.roughness = 0.85
              child.material.metalness = 0.05
              child.material.side = THREE.DoubleSide
              child.material.needsUpdate = true
            }
          }
        })
        meshModel.updateMatrixWorld(true)
        setHasMesh(true)
      }

      // ── Prepare wireframe from pre-built GLB ──
      if (wireGltf) {
        wireGltf.scene.traverse(child => {
          if (child.isLine || child.isLineSegments || child.geometry) {
            const geo = child.geometry
            if (!geo) return
            const posAttr = geo.getAttribute('position')
            if (!posAttr) return

            const positions = new Float32Array(posAttr.count * 3)
            for (let i = 0; i < posAttr.count; i++) {
              positions[i * 3] = posAttr.getX(i)
              positions[i * 3 + 1] = posAttr.getY(i)
              positions[i * 3 + 2] = posAttr.getZ(i)
            }

            const lineGeo = new LineSegmentsGeometry()
            lineGeo.setPositions(positions)

            const wireMat = new LineMaterial({
              color: 0x00e5ff,
              linewidth: 2,
              transparent: true,
              opacity: 0.85,
              resolution: new THREE.Vector2(container.clientWidth, container.clientHeight),
            })
            wireframeObjects.push(new LineSegments2(lineGeo, wireMat))
          }
        })
        if (!meshGltf) setHasMesh(true)
      }

      // ── Function to switch between modes ──
      function activateMode(mode) {
        // Remove all objects
        for (const obj of pointCloudObjects) scene.remove(obj)
        if (meshModel) scene.remove(meshModel)
        for (const obj of wireframeObjects) scene.remove(obj)
        if (gridHelper) scene.remove(gridHelper)
        collisionMeshes = []

        if (mode === 'mesh' && meshModel) {
          // Solid mesh with headlamp lighting
          scene.add(meshModel)
          meshModel.traverse(child => {
            if (child.isMesh) collisionMeshes.push(child)
          })
          noclip = true
          ambient.intensity = 0.3  // Low ambient — flashlight provides depth
          flashlight.visible = true
          flashlightOn = true
          scene.fog = new THREE.FogExp2(0x050508, 0.04)
          currentMode = 'mesh'
        } else if (mode === 'wireframe' && wireframeObjects.length > 0) {
          // Wireframe edges only
          for (const obj of wireframeObjects) scene.add(obj)
          noclip = true
          ambient.intensity = 1.0
          scene.fog = null
          currentMode = 'wireframe'
        } else {
          // Point cloud mode
          for (const obj of pointCloudObjects) scene.add(obj)
          if (gridHelper) scene.add(gridHelper)
          noclip = true
          ambient.intensity = 0.0
          scene.fog = null
          currentMode = 'points'
        }
      }

      // Expose toggle for the button
      viewToggleRef.current = (mode) => {
        activateMode(mode)
        setViewMode(mode)
      }

      // Default: show point cloud if available, otherwise mesh
      const startMode = pointCloudObjects.length > 0 ? 'points' : 'mesh'
      activateMode(startMode)
      setViewMode(startMode)

      // Compute bounds
      const boundsTarget = currentMode === 'points' ? scene : meshModel
      const box = new THREE.Box3().setFromObject(boundsTarget)
      const center = box.getCenter(new THREE.Vector3())
      fallbackFloorY = box.min.y - 0.5

      // ── Horizontal reference plane (point cloud mode) ──
      if (pointCloudObjects.length > 0) {
        const planeSize = 60
        const hasGravity = !!spawnData?.gravity_correction?.true_up
        const trueUp = hasGravity
          ? new THREE.Vector3(...spawnData.gravity_correction.true_up).normalize()
          : new THREE.Vector3(0, 1, 0)

        gridHelper = new THREE.GridHelper(planeSize, 30, 0x00ccff, 0x00ccff)
        gridHelper.material.transparent = true
        gridHelper.material.opacity = 0.15
        gridHelper.position.copy(center)
        gridHelper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), trueUp)
        if (currentMode === 'points') scene.add(gridHelper)
      }

      // ── Camera spawn ──
      if (currentMode === 'points') {
        if (spawnData) {
          const p = spawnData.spawn.position
          camera.position.set(p[0], p[1], p[2])
        } else {
          camera.position.copy(center)
        }
        camera.lookAt(center)
      } else {
        if (spawnData) {
          const spawnPos = slamToThreePos(spawnData.spawn.position)
          camera.position.copy(spawnPos)
          const spawnQuat = slamToThreeQuat(spawnData.spawn.orientation)
          const euler = new THREE.Euler().setFromQuaternion(spawnQuat, 'YXZ')
          camera.rotation.set(euler.x, euler.y, 0, 'YXZ')
        } else {
          camera.position.copy(center)
        }
        camera.rotation.order = 'YXZ'
        const floorY = findFloor(camera.position)
        camera.position.y = floorY + PLAYER_HEIGHT
      }
      onGround = currentMode !== 'points'
      verticalVelocity = 0
    }

    loadAll().catch(err => console.error('CaveExplorer load failed:', err))

    // ── Load POIs from database and render as 3D markers ──
    if (caveId) {
      const token = localStorage.getItem('access_token')
      const poiHeaders = token ? { Authorization: `Bearer ${token}` } : {}
      fetch(`/api/mapping/caves/${caveId}/pois/`, { headers: poiHeaders })
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => {
          const poiList = data.pois || data || []
          const slamPois = poiList.filter(p => p.slam_x != null && p.slam_y != null && p.slam_z != null)

          const POI_COLORS = {
            entrance: 0x4ade80, junction: 0x8b5cf6, squeeze: 0xef4444, water: 0x38bdf8,
            formation: 0xfbbf24, hazard: 0xff6b6b, biology: 0x10b981, camp: 0xf97316,
            survey_station: 0x6366f1, transition: 0xec4899, marker: 0xa1a1aa, waypoint: 0xfb923c,
          }

          for (const poi of slamPois) {
            const color = POI_COLORS[poi.poi_type] || 0xf472b6

            // Sphere marker (large enough to be visible at cave scale)
            const geo = new THREE.SphereGeometry(0.6, 16, 16)
            const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 })
            const mesh = new THREE.Mesh(geo, mat)
            mesh.position.set(poi.slam_x, poi.slam_y, poi.slam_z)
            mesh.renderOrder = 999
            scene.add(mesh)

            // Pulsing ring around sphere for visibility
            const ringGeo = new THREE.RingGeometry(0.8, 1.0, 24)
            const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.5 })
            const ring = new THREE.Mesh(ringGeo, ringMat)
            ring.position.set(poi.slam_x, poi.slam_y, poi.slam_z)
            ring.renderOrder = 999
            scene.add(ring)

            // Vertical line below marker
            const lineGeo = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(poi.slam_x, poi.slam_y, poi.slam_z),
              new THREE.Vector3(poi.slam_x, poi.slam_y - 2.0, poi.slam_z),
            ])
            const lineMat = new THREE.LineBasicMaterial({ color, depthTest: false })
            const line = new THREE.Line(lineGeo, lineMat)
            line.renderOrder = 999
            scene.add(line)

            // Text sprite label (larger)
            const label = poi.label || poi.poi_type || 'POI'
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            canvas.width = 512
            canvas.height = 128
            ctx.font = 'bold 48px Ubuntu, sans-serif'
            ctx.strokeStyle = '#000000'
            ctx.lineWidth = 4
            ctx.textAlign = 'center'
            ctx.strokeText(label, 256, 80)
            ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
            ctx.fillText(label, 256, 80)

            const texture = new THREE.CanvasTexture(canvas)
            const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
            const sprite = new THREE.Sprite(spriteMat)
            sprite.position.set(poi.slam_x, poi.slam_y + 1.5, poi.slam_z)
            sprite.scale.set(4.0, 1.0, 1)
            sprite.renderOrder = 1000
            scene.add(sprite)

            console.log(`Explorer POI: "${label}" at (${poi.slam_x.toFixed(1)}, ${poi.slam_y.toFixed(1)}, ${poi.slam_z.toFixed(1)})`)
          }
          console.log(`Explorer: loaded ${slamPois.length} POIs with SLAM coords`)
        })
        .catch(err => console.warn('Failed to load explorer POIs:', err))
    }

    // ── Click to lock ──
    const onClick = () => container.requestPointerLock()
    container.addEventListener('click', onClick)

    // ── Animation loop ──
    const clock = new THREE.Clock()
    let animId = null

    function animate() {
      animId = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), 0.1)

      if (isLocked) {
        const speed = SPEED * (moveState.sprint ? SPRINT_MULT : 1.0)

        // ── Q/E roll (camera-relative roll around forward axis) ──
        if (moveState.turnLeft || moveState.turnRight) {
          const rollSpeed = 1.5 * delta
          if (noclip) {
            if (moveState.turnLeft) camera.rotateZ(rollSpeed)
            if (moveState.turnRight) camera.rotateZ(-rollSpeed)
          } else {
            if (moveState.turnLeft) camera.rotation.y += rollSpeed
            if (moveState.turnRight) camera.rotation.y -= rollSpeed
          }
        }

        if (noclip) {
          // Noclip: fly in camera direction (full 6DOF)
          direction.set(0, 0, 0)
          if (moveState.forward) direction.z -= 1
          if (moveState.backward) direction.z += 1
          if (moveState.left) direction.x -= 1
          if (moveState.right) direction.x += 1
          if (moveState.jump) direction.y += 1

          if (direction.lengthSq() > 0) {
            direction.normalize()
            // Apply full camera rotation for fly-through movement
            direction.applyQuaternion(camera.quaternion)
            velocity.x += direction.x * speed * delta
            velocity.y += direction.y * speed * delta
            velocity.z += direction.z * speed * delta
          }

          const damp = Math.max(0, 1 - DAMPING * delta)
          velocity.x *= damp
          velocity.y *= damp
          velocity.z *= damp
          camera.position.add(velocity)
        } else {
          // Walking mode: horizontal movement with gravity
          direction.set(0, 0, 0)
          if (moveState.forward) direction.z -= 1
          if (moveState.backward) direction.z += 1
          if (moveState.left) direction.x -= 1
          if (moveState.right) direction.x += 1

          if (direction.lengthSq() > 0) {
            direction.normalize()
            const euler = new THREE.Euler(0, camera.rotation.y, 0, 'YXZ')
            direction.applyEuler(euler)
            velocity.x += direction.x * speed * delta
            velocity.z += direction.z * speed * delta
          }

          velocity.x *= Math.max(0, 1 - DAMPING * delta)
          velocity.z *= Math.max(0, 1 - DAMPING * delta)

          // Wall collision — test X and Z independently
          const newPos = camera.position.clone()
          if (Math.abs(velocity.x) > 0.001) {
            _rayDir.set(Math.sign(velocity.x), 0, 0)
            if (!checkWallCollision(camera.position, _rayDir)) {
              newPos.x += velocity.x
            } else {
              velocity.x = 0
            }
          }
          if (Math.abs(velocity.z) > 0.001) {
            _rayDir.set(0, 0, Math.sign(velocity.z))
            if (!checkWallCollision(newPos, _rayDir)) {
              newPos.z += velocity.z
            } else {
              velocity.z = 0
            }
          }
          camera.position.x = newPos.x
          camera.position.z = newPos.z

          verticalVelocity -= GRAVITY * delta
          if (moveState.jump && onGround) {
            verticalVelocity = JUMP_VELOCITY
            onGround = false
          }
          camera.position.y += verticalVelocity * delta

          const floorY = findFloor(camera.position)
          const targetY = floorY + PLAYER_HEIGHT
          if (camera.position.y <= targetY) {
            camera.position.y = targetY
            verticalVelocity = 0
            onGround = true
          } else {
            onGround = false
          }

          // Ceiling check
          _rayOrigin.copy(camera.position)
          _rayDir.set(0, 1, 0)
          downRay.set(_rayOrigin, _rayDir)
          downRay.far = 0.3
          const ceilHits = downRay.intersectObjects(collisionMeshes, false)
          if (ceilHits.length > 0) {
            camera.position.y = ceilHits[0].point.y - 0.1
            if (verticalVelocity > 0) verticalVelocity = 0
          }
        }
      }

      renderer.render(scene, camera)
    }
    animate()

    // ── Resize ──
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      // Update fat line resolution
      for (const obj of wireframeObjects) {
        if (obj.material?.resolution) obj.material.resolution.set(w, h)
      }
    })
    ro.observe(container)

    // ── Cleanup ──
    cleanupRef.current = () => {
      if (animId) cancelAnimationFrame(animId)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      container.removeEventListener('click', onClick)
      renderer.dispose()
      ro.disconnect()
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
    }
  }, [caveId])

  useEffect(() => {
    init(containerRef.current)
    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [init])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', cursor: 'pointer', position: 'relative' }}
    >
      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 1,
          color: 'var(--cyber-text-dim)', fontSize: '14px',
        }}
        className="explorer-hint"
      >
        Click to enter — WASD move, Q/E roll, Mouse look, F flashlight, V noclip
      </div>

      {/* Layer toggle: Points / Wireframe / Mesh */}
      {hasMesh && (
        <div style={{
          position: 'absolute', top: 12, right: 12, zIndex: 10,
          display: 'flex', gap: 2, background: 'rgba(0,0,0,0.7)',
          borderRadius: 6, padding: 2, border: '1px solid rgba(0,229,255,0.3)',
        }}>
          {['points', 'wireframe', 'mesh'].map(mode => (
            <button
              key={mode}
              onClick={(e) => { e.stopPropagation(); viewToggleRef.current?.(mode) }}
              style={{
                padding: '6px 14px', border: 'none', borderRadius: 4, cursor: 'pointer',
                fontSize: 13, fontFamily: 'Ubuntu, sans-serif', fontWeight: 600,
                background: viewMode === mode ? 'rgba(0,229,255,0.25)' : 'transparent',
                color: viewMode === mode ? '#00e5ff' : '#8892a4',
                transition: 'all 0.2s',
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
