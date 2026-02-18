import { useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const PLAYER_HEIGHT = 1.6
const PLAYER_RADIUS = 0.3
const GRAVITY = 9.8
const JUMP_VELOCITY = 4.0
const SPEED = 2.0
const SPRINT_MULT = 2.5
const DAMPING = 8.0
const MAX_FALL_DISTANCE = 10

export default function CaveExplorer({ caveId }) {
  const containerRef = useRef(null)
  const cleanupRef = useRef(null)

  const init = useCallback((container) => {
    if (!container) return

    // ── Scene ──
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x050508)
    scene.fog = new THREE.FogExp2(0x050508, 0.08)

    const camera = new THREE.PerspectiveCamera(
      75, container.clientWidth / container.clientHeight, 0.05, 200
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

    // ── Controls ──
    const controls = new PointerLockControls(camera, container)

    // ── State ──
    const moveState = { forward: false, backward: false, left: false, right: false, sprint: false, jump: false }
    const velocity = new THREE.Vector3()
    const direction = new THREE.Vector3()
    let noclip = false
    let onGround = false
    let verticalVelocity = 0
    let flashlightOn = false
    let collisionMeshes = []
    let fallbackFloorY = 0

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
      if (!controls.isLocked) return
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
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)

    // ── Load mesh ──
    const loader = new GLTFLoader()

    async function loadAll() {
      // Fetch mesh URL from reconstruction API
      let meshUrl = null
      let spawnData = null

      if (caveId) {
        try {
          const res = await fetch(`/api/reconstruction/cave/${caveId}/latest/`)
          if (res.ok) {
            const job = await res.json()
            const rawUrl = job.mesh_url || job.mesh_file
            // Strip origin to use relative path through Vite proxy
            if (rawUrl) {
              try { meshUrl = new URL(rawUrl).pathname } catch { meshUrl = rawUrl }
            }
          }
        } catch { /* fallback below */ }
      }

      // Fallback to hardcoded path
      if (!meshUrl) meshUrl = '/media/reconstruction/textured_mesh.glb'

      // Load spawn data (try per-cave path first, then global)
      const spawnPaths = caveId
        ? [
            `/media/caves/${caveId}/spawn.json`,
            `/media/reconstruction/output/${caveId}_spawn.json`,
            '/media/reconstruction/spawn.json',
          ]
        : ['/media/reconstruction/spawn.json']
      for (const sp of spawnPaths) {
        try {
          const resp = await fetch(sp)
          if (resp.ok) { spawnData = await resp.json(); break }
        } catch { /* try next */ }
      }

      // Load mesh
      const gltf = await new Promise((resolve, reject) =>
        loader.load(meshUrl, resolve, undefined, reject)
      )

      const model = gltf.scene
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
          if (child.material) {
            child.material.roughness = 0.85
            child.material.metalness = 0.05
            child.material.side = THREE.DoubleSide
          }
        }
      })

      model.rotation.x = -Math.PI / 2
      model.updateMatrixWorld(true)
      scene.add(model)

      collisionMeshes = []
      model.traverse(child => {
        if (child.isMesh) collisionMeshes.push(child)
      })

      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3())
      fallbackFloorY = box.min.y - 0.5

      if (spawnData) {
        const spawnPos = slamToThreePos(spawnData.spawn.position)
        camera.position.copy(spawnPos)
        const spawnQuat = slamToThreeQuat(spawnData.spawn.orientation)
        const euler = new THREE.Euler().setFromQuaternion(spawnQuat, 'YXZ')
        camera.rotation.set(euler.x, euler.y, 0, 'YXZ')
      } else {
        camera.position.copy(center)
      }

      const floorY = findFloor(camera.position)
      camera.position.y = floorY + PLAYER_HEIGHT
      onGround = true
      verticalVelocity = 0
    }

    loadAll().catch(err => console.error('CaveExplorer load failed:', err))

    // ── Click to lock ──
    const onClick = () => controls.lock()
    container.addEventListener('click', onClick)

    // ── Animation loop ──
    const clock = new THREE.Clock()
    let animId = null

    function animate() {
      animId = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), 0.1)

      if (controls.isLocked) {
        const speed = SPEED * (moveState.sprint ? SPRINT_MULT : 1.0)

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

        if (noclip) {
          if (moveState.jump) velocity.y += speed * delta
          velocity.y *= Math.max(0, 1 - DAMPING * delta)
          camera.position.add(velocity)
        } else {
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
    })
    ro.observe(container)

    // ── Cleanup ──
    cleanupRef.current = () => {
      if (animId) cancelAnimationFrame(animId)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      container.removeEventListener('click', onClick)
      controls.dispose()
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
        Click to enter — WASD to move, Mouse to look, F flashlight, V noclip
      </div>
    </div>
  )
}
