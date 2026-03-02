import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import useEditorStore from '../../stores/editorStore'

const DIVIDER_SIZE = 4
const MIN_PANE_PCT = 15
const STORAGE_KEY = 'editor-viewport-split'
const GRID_COLOR = 0x1a1a3a
const GRID_CENTER_COLOR = 0x2a2a5a

const VIEW_LABELS = { top: 'Top (XZ)', free: 'Free Camera', front: 'Front (XY)', profile: 'Profile (ZY)' }

function loadSplitFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const p = JSON.parse(saved)
      if (p.colPct && p.rowPct) return p
    }
  } catch { /* ignore */ }
  return { colPct: 50, rowPct: 50 }
}

function createGrid(viewType) {
  const grid = new THREE.GridHelper(100, 100, GRID_CENTER_COLOR, GRID_COLOR)
  grid.material.transparent = true
  grid.material.opacity = 0.4
  if (viewType === 'front') grid.rotation.x = Math.PI / 2
  else if (viewType === 'profile') grid.rotation.z = Math.PI / 2
  return grid
}

function createAxisHelper(size) {
  const group = new THREE.Group()
  const m = (c) => new THREE.LineBasicMaterial({ color: c })
  const line = (a, b, mat) => {
    const g = new THREE.BufferGeometry().setFromPoints([a, b])
    return new THREE.Line(g, mat)
  }
  group.add(line(new THREE.Vector3(0,0,0), new THREE.Vector3(size,0,0), m(0xff4444)))
  group.add(line(new THREE.Vector3(0,0,0), new THREE.Vector3(0,size,0), m(0x44ff44)))
  group.add(line(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,size), m(0x4444ff)))
  return group
}

function createGroundPlaneHelper() {
  const group = new THREE.Group()

  // Semi-transparent ground plane at Y=0
  const planeGeo = new THREE.PlaneGeometry(60, 60)
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.04,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const plane = new THREE.Mesh(planeGeo, planeMat)
  plane.rotation.x = -Math.PI / 2
  group.add(plane)

  // Up arrow (green, +Y direction)
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 0),
    8, 0x44ff44, 2, 1
  )
  group.add(arrow)

  return group
}

function createOrthoCamera(viewType, aspect) {
  const frustum = 50
  const cam = new THREE.OrthographicCamera(
    -frustum * aspect, frustum * aspect, frustum, -frustum, 0.1, 1000
  )
  if (viewType === 'top')     { cam.position.set(0, 200, 0);  cam.up.set(0, 0, -1) }
  else if (viewType === 'front')   { cam.position.set(0, 0, 200);  cam.up.set(0, 1, 0) }
  else if (viewType === 'profile') { cam.position.set(200, 0, 0);  cam.up.set(0, 1, 0) }
  cam.lookAt(0, 0, 0)
  cam.updateProjectionMatrix()
  return cam
}

const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3()

const EditorViewportLayout = forwardRef(function EditorViewportLayout({ clouds }, ref) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef = useRef(null) // holds all Three.js state
  const splitRef = useRef(loadSplitFromStorage())
  const animIdRef = useRef(null)
  const vpDivRefs = useRef([null, null, null, null]) // DOM divs for each viewport

  const [split, setSplit] = useState(splitRef.current)
  const [activeVp, setActiveVp] = useState(null)
  const setActiveViewport = useEditorStore(s => s.setActiveViewport)
  const activeTool = useEditorStore(s => s.activeTool)
  const transformMode = useEditorStore(s => s.transformMode)
  const selectedCloudId = useEditorStore(s => s.selectedCloudId)
  const flyMode = useEditorStore(s => s.flyMode)

  // Keep splitRef in sync with state
  useEffect(() => { splitRef.current = split }, [split])

  // ── Initialize all Three.js state ──
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a12)
    scene.add(new THREE.AmbientLight(0xffffff, 1.0))

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setScissorTest(true)
    renderer.autoClear = false
    const rect = container.getBoundingClientRect()
    renderer.setSize(rect.width, rect.height)

    // Cameras — order: [top, free, front, profile]
    const aspect = 1
    const cameras = [
      createOrthoCamera('top', aspect),
      (() => {
        const c = new THREE.PerspectiveCamera(60, aspect, 0.05, 2000)
        c.position.set(30, 30, 30)
        c.lookAt(0, 0, 0)
        return c
      })(),
      createOrthoCamera('front', aspect),
      createOrthoCamera('profile', aspect),
    ]

    // Per-viewport grids and axes (added/removed per render pass)
    const grids = ['top', 'free', 'front', 'profile'].map((vt) => {
      if (vt === 'free') return null
      return createGrid(vt)
    })
    grids[1] = (() => {
      const g = new THREE.GridHelper(100, 50, GRID_CENTER_COLOR, GRID_COLOR)
      g.material.transparent = true; g.material.opacity = 0.2
      return g
    })()

    const axes = [createAxisHelper(3), createAxisHelper(3), createAxisHelper(3), createAxisHelper(3)]

    // Ground plane with up-arrow (permanent scene object for orientation reference)
    const groundPlane = createGroundPlaneHelper()
    scene.add(groundPlane)

    // OrbitControls for free camera — attach to its overlay div
    let orbitControls = null
    const freeDom = vpDivRefs.current[1]
    if (freeDom) {
      orbitControls = new OrbitControls(cameras[1], freeDom)
      orbitControls.enableDamping = true
      orbitControls.dampingFactor = 0.1
      orbitControls.screenSpacePanning = true
      orbitControls.minDistance = 0.5
      orbitControls.maxDistance = 500
    }

    // TransformControls — one per viewport so gizmo works in all views
    const transformControlsArr = []
    const tcHelpers = []
    for (let i = 0; i < 4; i++) {
      const dom = vpDivRefs.current[i]
      if (!dom) continue
      const tc = new TransformControls(cameras[i], dom)
      tc.setSize(0.8)
      const helper = tc.getHelper()
      helper.visible = false // toggled per-viewport in render loop
      scene.add(helper)

      tc.addEventListener('dragging-changed', (event) => {
        // Disable OrbitControls (free camera) during any gizmo drag
        if (orbitControls) orbitControls.enabled = !event.value
        // On drag end, commit the final transform to the store
        if (!event.value) {
          const obj = tc.object
          if (obj?.userData.cloudId) {
            const m = new THREE.Matrix4()
            m.compose(obj.position, obj.quaternion, obj.scale)
            useEditorStore.getState().updateCloudTransform(obj.userData.cloudId, m)
          }
        }
      })

      transformControlsArr.push(tc)
      tcHelpers.push(helper)
    }

    // Points in scene
    const pointObjects = []

    // Key tracking for WASD fly mode
    const keysDown = new Set()

    stateRef.current = { scene, renderer, cameras, grids, axes, orbitControls, transformControlsArr, tcHelpers, pointObjects, groundPlane, keysDown }

    // Resize observer
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) renderer.setSize(width, height)
      }
    })
    ro.observe(container)

    // ── Animation loop ──
    function animate() {
      animIdRef.current = requestAnimationFrame(animate)
      const s = stateRef.current
      if (!s || !containerRef.current) return

      const cr = containerRef.current.getBoundingClientRect()
      const totalW = cr.width
      const totalH = cr.height
      const sp = splitRef.current
      const colSplit = (sp.colPct / 100) * totalW
      const rowSplit = (sp.rowPct / 100) * totalH
      const half = DIVIDER_SIZE / 2

      s.renderer.clear()

      // Scissor rects: [top-left, top-right, bottom-left, bottom-right]
      // WebGL y=0 is bottom, CSS y=0 is top
      const rects = [
        { x: 0, y: totalH - rowSplit + half, w: colSplit - half, h: rowSplit - half },
        { x: colSplit + half, y: totalH - rowSplit + half, w: totalW - colSplit - half, h: rowSplit - half },
        { x: 0, y: 0, w: colSplit - half, h: totalH - rowSplit - half },
        { x: colSplit + half, y: 0, w: totalW - colSplit - half, h: totalH - rowSplit - half },
      ]

      for (let i = 0; i < 4; i++) {
        const r = rects[i]
        if (r.w <= 0 || r.h <= 0) continue

        s.renderer.setScissor(r.x, r.y, r.w, r.h)
        s.renderer.setViewport(r.x, r.y, r.w, r.h)

        const cam = s.cameras[i]
        if (cam.isOrthographicCamera) {
          const a = r.w / r.h
          cam.left = cam.bottom * a
          cam.right = cam.top * a
          cam.updateProjectionMatrix()
        } else {
          cam.aspect = r.w / r.h
          cam.updateProjectionMatrix()
        }

        // Show only this viewport's gizmo helper (sized for its camera)
        for (let j = 0; j < s.tcHelpers.length; j++) {
          s.tcHelpers[j].visible = (j === i)
        }

        // Add per-viewport helpers
        if (s.grids[i]) s.scene.add(s.grids[i])
        if (s.axes[i]) s.scene.add(s.axes[i])

        s.renderer.render(s.scene, cam)

        // Remove per-viewport helpers
        if (s.grids[i]) s.scene.remove(s.grids[i])
        if (s.axes[i]) s.scene.remove(s.axes[i])
      }

      // Hide all gizmo helpers after render passes
      for (const h of s.tcHelpers) h.visible = false

      // WASD fly mode — 6DOF camera movement
      if (s.keysDown.size > 0 && s.orbitControls) {
        const cam = s.cameras[1] // free camera
        const forward = new THREE.Vector3()
        cam.getWorldDirection(forward)
        const right = new THREE.Vector3()
        right.crossVectors(forward, cam.up).normalize()
        const up = cam.up.clone().normalize()

        const delta = new THREE.Vector3()
        if (s.keysDown.has('w')) delta.add(forward)
        if (s.keysDown.has('s')) delta.sub(forward)
        if (s.keysDown.has('d')) delta.add(right)
        if (s.keysDown.has('a')) delta.sub(right)
        if (s.keysDown.has(' ')) delta.add(up)
        if (s.keysDown.has('shift')) delta.sub(up)

        if (delta.lengthSq() > 0) {
          const dist = cam.position.distanceTo(s.orbitControls.target)
          const speed = Math.max(dist * 0.012, 0.02)
          delta.normalize().multiplyScalar(speed)
          cam.position.add(delta)
          s.orbitControls.target.add(delta)
        }

        // Q/E roll
        const rollSpeed = 0.02
        if (s.keysDown.has('q')) cam.rotateZ(rollSpeed)
        if (s.keysDown.has('e')) cam.rotateZ(-rollSpeed)
      }

      if (s.orbitControls && !useEditorStore.getState().flyMode) s.orbitControls.update()
    }
    animate()

    return () => {
      cancelAnimationFrame(animIdRef.current)
      ro.disconnect()
      if (orbitControls) orbitControls.dispose()
      for (const tc of transformControlsArr) {
        scene.remove(tc.getHelper())
        tc.detach()
        tc.dispose()
      }
      renderer.dispose()
      // Cleanup ground plane
      scene.remove(groundPlane)
      groundPlane.traverse(child => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
      // Cleanup point objects
      for (const p of pointObjects) {
        scene.remove(p)
        p.material.dispose()
      }
      stateRef.current = null
    }
  }, []) // mount once

  // ── Sync clouds to scene (reconcile — never destroy objects that still exist) ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    const cloudMap = new Map(clouds.map(c => [c.id, c]))
    const existingMap = new Map(s.pointObjects.map(p => [p.userData.cloudId, p]))

    // Remove clouds that no longer exist
    for (const [id, pts] of existingMap) {
      if (!cloudMap.has(id)) {
        for (const tc of (s.transformControlsArr || [])) {
          if (tc.object === pts) tc.detach()
        }
        s.scene.remove(pts)
        pts.material.dispose()
      }
    }

    // Build reconciled pointObjects array
    const newPointObjects = []
    for (const cloud of clouds) {
      if (!cloud.geometry) continue
      let pts = existingMap.get(cloud.id)
      if (pts) {
        // Update existing object in-place
        pts.visible = cloud.visible
        pts.material.color.set(cloud.color)
        // Skip transform update if this object is actively being dragged
        const isDragging = (s.transformControlsArr || []).some(tc => tc.object === pts && tc.dragging)
        if (!isDragging) {
          cloud.transform.decompose(_pos, _quat, _scale)
          pts.position.copy(_pos)
          pts.quaternion.copy(_quat)
          pts.scale.copy(_scale)
        }
      } else {
        // Create new Points object with cloud color tint
        const mat = new THREE.PointsMaterial({ size: 0.08, vertexColors: true, sizeAttenuation: true })
        mat.color.set(cloud.color)
        pts = new THREE.Points(cloud.geometry, mat)
        pts.matrixAutoUpdate = true
        cloud.transform.decompose(_pos, _quat, _scale)
        pts.position.copy(_pos)
        pts.quaternion.copy(_quat)
        pts.scale.copy(_scale)
        pts.visible = cloud.visible
        pts.userData.cloudId = cloud.id
        s.scene.add(pts)
      }
      newPointObjects.push(pts)
    }
    s.pointObjects = newPointObjects
  }, [clouds])

  // ── Sync TransformControls to selected cloud + transform mode ──
  useEffect(() => {
    const s = stateRef.current
    if (!s?.transformControlsArr?.length) return

    if (!selectedCloudId || !transformMode) {
      for (const tc of s.transformControlsArr) tc.detach()
      return
    }

    const cloud = clouds.find(c => c.id === selectedCloudId)
    if (!cloud || cloud.locked) {
      for (const tc of s.transformControlsArr) tc.detach()
      return
    }

    const pts = s.pointObjects.find(p => p.userData.cloudId === selectedCloudId)
    if (!pts) {
      for (const tc of s.transformControlsArr) tc.detach()
      return
    }

    // Attach all viewport TCs to the same object — each processes its own pointer events
    for (const tc of s.transformControlsArr) {
      tc.setMode(transformMode)
      tc.attach(pts)
    }
  }, [clouds, transformMode, selectedCloudId])

  // ── WASD fly mode key tracking ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    // Clear keys when fly mode is toggled off
    if (!flyMode) {
      s.keysDown.clear()
      return
    }

    const FLY_KEYS = new Set(['w', 'a', 's', 'd', ' ', 'shift', 'q', 'e'])

    function onKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (!useEditorStore.getState().flyMode) return
      const key = e.key.toLowerCase()
      if (FLY_KEYS.has(key)) {
        s.keysDown.add(key)
        e.preventDefault() // prevent page scroll on Space, S triggering Scale
      }
    }
    function onKeyUp(e) {
      s.keysDown.delete(e.key.toLowerCase())
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      s.keysDown.clear()
    }
  }, [flyMode])

  // ── Custom mouse look for fly mode (bypasses OrbitControls) ──
  // 6DOF: all rotations relative to camera's own axes (same as CaveExplorer noclip)
  useEffect(() => {
    const s = stateRef.current
    if (!s || !flyMode) return

    const freeDom = vpDivRefs.current[1]
    if (!freeDom) return

    let isDragging = false
    const sensitivity = 0.003

    function onMouseDown(e) {
      if (e.button === 0 || e.button === 2) {
        isDragging = true
        e.preventDefault()
      }
    }

    function onMouseMove(e) {
      if (!isDragging) return
      const cam = s.cameras[1]

      // 6DOF: rotate around camera's own axes — no clamping, full freedom
      cam.rotateY(-e.movementX * sensitivity)
      cam.rotateX(-e.movementY * sensitivity)

      // Keep orbit target in front of camera for smooth transition when exiting fly mode
      const forward = new THREE.Vector3()
      cam.getWorldDirection(forward)
      s.orbitControls.target.copy(cam.position).add(forward.multiplyScalar(10))
    }

    function onMouseUp(e) {
      if (e.button === 0 || e.button === 2) {
        isDragging = false
      }
    }

    freeDom.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      freeDom.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [flyMode])

  // ── Update OrbitControls mouse buttons based on active tool / fly mode ──
  useEffect(() => {
    const s = stateRef.current
    if (!s?.orbitControls) return
    // In fly mode, disable OrbitControls — custom mouse look handles rotation
    if (flyMode) {
      s.orbitControls.enabled = false
    } else if (activeTool === 'pan') {
      s.orbitControls.enabled = true
      s.orbitControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    } else if (activeTool === 'zoom') {
      s.orbitControls.enabled = true
      s.orbitControls.mouseButtons = { LEFT: THREE.MOUSE.DOLLY, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    } else {
      s.orbitControls.enabled = true
      s.orbitControls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    }
  }, [activeTool, flyMode])

  // ── Fit all viewports to cloud bounds ──
  const fitAllToView = useCallback(() => {
    const s = stateRef.current
    if (!s || clouds.length === 0) return

    const box = new THREE.Box3()
    for (const cloud of clouds) {
      if (!cloud.visible || !cloud.geometry) continue
      cloud.geometry.computeBoundingBox()
      const cb = cloud.geometry.boundingBox.clone()
      cb.applyMatrix4(cloud.transform)
      box.union(cb)
    }
    if (box.isEmpty()) return

    const center = new THREE.Vector3()
    const size = new THREE.Vector3()
    box.getCenter(center)
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z, 1)

    for (let i = 0; i < 4; i++) {
      const cam = s.cameras[i]
      if (cam.isOrthographicCamera) {
        const padding = 1.3
        cam.top = maxDim * padding / 2
        cam.bottom = -maxDim * padding / 2
        cam.left = cam.bottom
        cam.right = cam.top

        if (i === 0) cam.position.set(center.x, 200, center.z)       // top
        else if (i === 2) cam.position.set(center.x, center.y, 200)  // front
        else if (i === 3) cam.position.set(200, center.y, center.z)  // profile
        cam.lookAt(center)
        cam.updateProjectionMatrix()
      } else {
        // Free camera
        const dist = maxDim * 1.5
        cam.position.set(center.x + dist * 0.5, center.y + dist * 0.3, center.z + dist * 0.5)
        cam.lookAt(center)
        if (s.orbitControls) {
          s.orbitControls.target.copy(center)
          s.orbitControls.update()
        }
      }
    }
  }, [clouds])

  useImperativeHandle(ref, () => ({ fitAllToView }), [fitAllToView])

  // ── Ortho viewport mouse handlers ──
  const handleWheel = useCallback((vpIndex, e) => {
    const s = stateRef.current
    if (!s) return
    const cam = s.cameras[vpIndex]
    if (!cam.isOrthographicCamera) return
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.1 : 0.9
    cam.top *= factor
    cam.bottom *= factor
    cam.left *= factor
    cam.right *= factor
    cam.updateProjectionMatrix()
  }, [])

  const handleOrthoMouseDown = useCallback((vpIndex, viewType, e) => {
    const s = stateRef.current
    if (!s) return
    const cam = s.cameras[vpIndex]
    if (!cam.isOrthographicCamera) return

    // Don't pan/zoom if pointer is over a TransformControls gizmo handle
    const tc = s.transformControlsArr?.[vpIndex]
    if (tc?.axis) return

    const tool = useEditorStore.getState().activeTool
    let action = null
    if (e.button === 1 || e.button === 2) {
      action = 'pan' // middle/right always pan
    } else if (e.button === 0) {
      if (tool === 'pan') action = 'pan'
      else if (tool === 'zoom') action = 'zoom'
      else return // select — no action yet
    } else return

    e.preventDefault()

    if (action === 'pan') {
      const startX = e.clientX
      const startY = e.clientY
      const startPos = cam.position.clone()
      const frustumH = cam.top - cam.bottom
      const el = e.currentTarget
      const elRect = el.getBoundingClientRect()
      const scaleY = frustumH / elRect.height
      const scaleX = frustumH * (elRect.width / elRect.height) / elRect.width

      function onMove(me) {
        const dx = me.clientX - startX
        const dy = me.clientY - startY
        if (viewType === 'top') {
          cam.position.x = startPos.x - dx * scaleX
          cam.position.z = startPos.z - dy * scaleY
        } else if (viewType === 'front') {
          cam.position.x = startPos.x - dx * scaleX
          cam.position.y = startPos.y + dy * scaleY
        } else if (viewType === 'profile') {
          cam.position.z = startPos.z + dx * scaleX
          cam.position.y = startPos.y + dy * scaleY
        }
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    } else if (action === 'zoom') {
      const startY = e.clientY
      const startFrustum = { top: cam.top, bottom: cam.bottom, left: cam.left, right: cam.right }

      function onMove(me) {
        const dy = me.clientY - startY
        const factor = Math.pow(1.005, dy)
        cam.top = startFrustum.top * factor
        cam.bottom = startFrustum.bottom * factor
        cam.left = startFrustum.left * factor
        cam.right = startFrustum.right * factor
        cam.updateProjectionMatrix()
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
  }, [])

  // ── Divider drag ──
  const handleDividerDrag = useCallback((axis, e) => {
    e.preventDefault()
    const cr = containerRef.current
    if (!cr) return
    const rect = cr.getBoundingClientRect()

    function onMove(me) {
      const pct = axis === 'col'
        ? ((me.clientX - rect.left) / rect.width) * 100
        : ((me.clientY - rect.top) / rect.height) * 100
      const clamped = Math.max(MIN_PANE_PCT, Math.min(100 - MIN_PANE_PCT, pct))
      setSplit(prev => axis === 'col' ? { ...prev, colPct: clamped } : { ...prev, rowPct: clamped })
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setSplit(prev => { localStorage.setItem(STORAGE_KEY, JSON.stringify(prev)); return prev })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  function handleVpHover(vpType) {
    setActiveVp(vpType)
    setActiveViewport(vpType)
  }

  const vpStyle = (vpType) => ({
    outline: activeVp === vpType ? '2px solid var(--cyber-cyan)' : 'none',
    outlineOffset: '-2px',
  })

  const vpTypes = ['top', 'free', 'front', 'profile']

  // Bind wheel/context events to viewport divs
  useEffect(() => {
    const cleanups = []
    for (let i = 0; i < 4; i++) {
      const el = vpDivRefs.current[i]
      if (!el) continue
      const vt = vpTypes[i]
      const ctx = (e) => e.preventDefault()
      el.addEventListener('contextmenu', ctx)
      cleanups.push(() => el.removeEventListener('contextmenu', ctx))

      if (vt !== 'free') {
        const wh = (e) => handleWheel(i, e)
        const md = (e) => handleOrthoMouseDown(i, vt, e)
        el.addEventListener('wheel', wh, { passive: false })
        el.addEventListener('mousedown', md)
        cleanups.push(() => {
          el.removeEventListener('wheel', wh)
          el.removeEventListener('mousedown', md)
        })
      }
    }
    return () => cleanups.forEach(fn => fn())
  }, [handleWheel, handleOrthoMouseDown])

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden" style={{ background: '#0a0a12' }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ display: 'block' }} />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          display: 'grid',
          gridTemplateColumns: `${split.colPct}% ${DIVIDER_SIZE}px 1fr`,
          gridTemplateRows: `${split.rowPct}% ${DIVIDER_SIZE}px 1fr`,
        }}
      >
        {/* Top-left: Top */}
        <div
          ref={el => { vpDivRefs.current[0] = el }}
          className="pointer-events-auto relative"
          onMouseEnter={() => handleVpHover('top')}
          style={{ ...vpStyle('top'), borderRight: '1px solid var(--cyber-border)', borderBottom: '1px solid var(--cyber-border)' }}
        >
          <span className="absolute top-1 left-2 text-[10px] font-mono pointer-events-none" style={{ color: 'var(--cyber-text-dim)', zIndex: 1 }}>{VIEW_LABELS.top}</span>
        </div>

        {/* Vertical divider (top) */}
        <div className="pointer-events-auto cursor-col-resize" style={{ background: 'var(--cyber-border)' }} onMouseDown={(e) => handleDividerDrag('col', e)} />

        {/* Top-right: Free Camera */}
        <div
          ref={el => { vpDivRefs.current[1] = el }}
          className="pointer-events-auto relative"
          onMouseEnter={() => handleVpHover('free')}
          style={{ ...vpStyle('free'), borderBottom: '1px solid var(--cyber-border)' }}
        >
          <span className="absolute top-1 left-2 text-[10px] font-mono pointer-events-none" style={{ color: 'var(--cyber-text-dim)', zIndex: 1 }}>{VIEW_LABELS.free}</span>
        </div>

        {/* Horizontal divider (left) */}
        <div className="pointer-events-auto cursor-row-resize" style={{ background: 'var(--cyber-border)', gridColumn: '1' }} onMouseDown={(e) => handleDividerDrag('row', e)} />

        {/* Center intersection */}
        <div style={{ background: 'var(--cyber-border)' }} />

        {/* Horizontal divider (right) */}
        <div className="pointer-events-auto cursor-row-resize" style={{ background: 'var(--cyber-border)' }} onMouseDown={(e) => handleDividerDrag('row', e)} />

        {/* Bottom-left: Front */}
        <div
          ref={el => { vpDivRefs.current[2] = el }}
          className="pointer-events-auto relative"
          onMouseEnter={() => handleVpHover('front')}
          style={{ ...vpStyle('front'), borderRight: '1px solid var(--cyber-border)' }}
        >
          <span className="absolute top-1 left-2 text-[10px] font-mono pointer-events-none" style={{ color: 'var(--cyber-text-dim)', zIndex: 1 }}>{VIEW_LABELS.front}</span>
        </div>

        {/* Vertical divider (bottom) */}
        <div className="pointer-events-auto cursor-col-resize" style={{ background: 'var(--cyber-border)' }} onMouseDown={(e) => handleDividerDrag('col', e)} />

        {/* Bottom-right: Profile */}
        <div
          ref={el => { vpDivRefs.current[3] = el }}
          className="pointer-events-auto relative"
          onMouseEnter={() => handleVpHover('profile')}
          style={vpStyle('profile')}
        >
          <span className="absolute top-1 left-2 text-[10px] font-mono pointer-events-none" style={{ color: 'var(--cyber-text-dim)', zIndex: 1 }}>{VIEW_LABELS.profile}</span>
        </div>
      </div>
    </div>
  )
})

export default EditorViewportLayout
