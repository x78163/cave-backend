import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import useEditorStore from '../../stores/editorStore'
import { KDTree3D } from '../../utils/alignmentMath'

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

function DragRectOverlay({ rect }) {
  const left = Math.min(rect.x1, rect.x2)
  const top = Math.min(rect.y1, rect.y2)
  const width = Math.abs(rect.x2 - rect.x1)
  const height = Math.abs(rect.y2 - rect.y1)
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left, top, width, height,
        border: '1px dashed #fb923c',
        background: 'rgba(251,146,60,0.08)',
        zIndex: 10,
      }}
    />
  )
}

const EditorViewportLayout = forwardRef(function EditorViewportLayout({ clouds, pickedPoints, selectedIndices, trajectory, trajectoryCloudId, pois, measurePoints }, ref) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef = useRef(null) // holds all Three.js state
  const splitRef = useRef(loadSplitFromStorage())
  const animIdRef = useRef(null)
  const vpDivRefs = useRef([null, null, null, null]) // DOM divs for each viewport

  const [split, setSplit] = useState(splitRef.current)
  const [activeVp, setActiveVp] = useState(null)
  const [dragRect, setDragRect] = useState(null) // { vpIndex, x1, y1, x2, y2 } screen coords relative to viewport
  const setActiveViewport = useEditorStore(s => s.setActiveViewport)
  const activeTool = useEditorStore(s => s.activeTool)
  const transformMode = useEditorStore(s => s.transformMode)
  const selectedCloudId = useEditorStore(s => s.selectedCloudId)
  const flyMode = useEditorStore(s => s.flyMode)
  const sourceCloudId = useEditorStore(s => s.sourceCloudId)
  const targetCloudId = useEditorStore(s => s.targetCloudId)
  const overlapVisActive = useEditorStore(s => s.overlapVisActive)
  const selectedPoiId = useEditorStore(s => s.selectedPoiId)
  const pointSize = useEditorStore(s => s.pointSize)

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
          } else if (obj?.userData.poiId) {
            // POI was dragged — convert world position back to cloud-local coords
            const state = useEditorStore.getState()
            const poi = state.pois.find(p => p.id === obj.userData.poiId)
            if (poi?.cloudId) {
              const cloud = state.clouds.find(c => c.id === poi.cloudId)
              if (cloud?.transform) {
                const inv = new THREE.Matrix4().copy(cloud.transform).invert()
                const local = obj.position.clone().applyMatrix4(inv)
                state.updatePoiPosition(poi.id, local)
              } else {
                state.updatePoiPosition(poi.id, obj.position)
              }
            } else {
              state.updatePoiPosition(poi.id, obj.position)
            }
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

    stateRef.current = { scene, renderer, cameras, grids, axes, orbitControls, transformControlsArr, tcHelpers, pointObjects, groundPlane, keysDown, pickMarkers: [], measureMarkers: [], stashedColors: null, selectionOverlay: null, trajectoryLine: null, poiMarkers: [] }

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
      // Cleanup pick markers
      const pm = stateRef.current?.pickMarkers || []
      for (const obj of pm) {
        scene.remove(obj)
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) obj.material.dispose()
      }
      // Cleanup selection overlay
      if (stateRef.current?.selectionOverlay) {
        scene.remove(stateRef.current.selectionOverlay)
        stateRef.current.selectionOverlay.geometry.dispose()
        stateRef.current.selectionOverlay.material.dispose()
      }
      // Cleanup trajectory line
      if (stateRef.current?.trajectoryLine) {
        scene.remove(stateRef.current.trajectoryLine)
        stateRef.current.trajectoryLine.geometry.dispose()
        stateRef.current.trajectoryLine.material.dispose()
      }
      // Cleanup POI markers
      for (const obj of (stateRef.current?.poiMarkers || [])) {
        scene.remove(obj)
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) obj.material.dispose()
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
        // Update geometry if it changed (e.g. after point deletion)
        if (pts.geometry !== cloud.geometry) {
          pts.geometry = cloud.geometry
        }
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
        const mat = new THREE.PointsMaterial({ size: useEditorStore.getState().pointSize, vertexColors: true, sizeAttenuation: true })
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

  // ── Sync TransformControls to selected cloud OR selected POI ──
  useEffect(() => {
    const s = stateRef.current
    if (!s?.transformControlsArr?.length) return

    // If a POI is selected and we're in poiMove tool, attach gizmo to POI marker for dragging
    if (selectedPoiId && activeTool === 'poiMove') {
      const poiMesh = s.poiMarkers.find(obj => obj.userData?.poiId === selectedPoiId)
      if (poiMesh) {
        for (const tc of s.transformControlsArr) {
          tc.setMode('translate')
          tc.attach(poiMesh)
        }
        return
      }
    }

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
  }, [clouds, transformMode, selectedCloudId, selectedPoiId, activeTool, pois])

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

  // ── Point picking via raycasting ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    if (activeTool !== 'pick') return

    const raycaster = new THREE.Raycaster()
    raycaster.params.Points.threshold = 0.3

    function handleClick(vpIndex, e) {
      const state = useEditorStore.getState()
      if (state.activeTool !== 'pick' || !state.alignmentMode) return

      const el = vpDivRefs.current[vpIndex]
      if (!el) return
      const rect = el.getBoundingClientRect()

      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )

      const cam = s.cameras[vpIndex]
      raycaster.setFromCamera(ndc, cam)

      const cloudId = state.pickPhase === 'source' ? state.sourceCloudId : state.targetCloudId
      const pts = s.pointObjects.find(p => p.userData.cloudId === cloudId)
      if (!pts) return

      const hits = raycaster.intersectObject(pts)
      if (hits.length > 0) {
        const p = hits[0].point
        state.addPickedPoint(cloudId, { x: p.x, y: p.y, z: p.z })
      }
    }

    const handlers = []
    for (let i = 0; i < 4; i++) {
      const el = vpDivRefs.current[i]
      if (!el) continue
      const idx = i
      const handler = (e) => handleClick(idx, e)
      el.addEventListener('click', handler)
      handlers.push([el, handler])
    }

    return () => {
      for (const [el, handler] of handlers) {
        el.removeEventListener('click', handler)
      }
    }
  }, [activeTool])

  // ── POI click handler (select existing or place new) ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    if (activeTool !== 'poi') return

    const raycaster = new THREE.Raycaster()
    raycaster.params.Points.threshold = 0.3

    function handlePoiClick(vpIndex, e) {
      const state = useEditorStore.getState()
      if (state.activeTool !== 'poi') return

      const el = vpDivRefs.current[vpIndex]
      if (!el) return
      const rect = el.getBoundingClientRect()

      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )

      const cam = s.cameras[vpIndex]
      raycaster.setFromCamera(ndc, cam)

      // Place a new POI — raycast against visible clouds
      let closestHit = null
      let hitCloudId = null
      for (const pts of s.pointObjects) {
        if (!pts.visible) continue
        const hits = raycaster.intersectObject(pts)
        if (hits.length > 0) {
          if (!closestHit || hits[0].distance < closestHit.distance) {
            closestHit = hits[0]
            hitCloudId = pts.userData.cloudId
          }
        }
      }

      if (closestHit && hitCloudId) {
        // Convert world hit point to cloud-local coordinates
        const cloud = state.clouds.find(c => c.id === hitCloudId)
        const invTransform = cloud?.transform
          ? new THREE.Matrix4().copy(cloud.transform).invert()
          : new THREE.Matrix4()
        const localPoint = closestHit.point.clone().applyMatrix4(invTransform)
        state.addPoi(localPoint, hitCloudId)
      }
    }

    const handlers = []
    for (let i = 0; i < 4; i++) {
      const el = vpDivRefs.current[i]
      if (!el) continue
      const idx = i
      const handler = (e) => handlePoiClick(idx, e)
      el.addEventListener('click', handler)
      handlers.push([el, handler])
    }

    return () => {
      for (const [el, handler] of handlers) {
        el.removeEventListener('click', handler)
      }
    }
  }, [activeTool])

  // ── POI Move click handler (select existing POIs only, no placement) ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    if (activeTool !== 'poiMove') return

    const raycaster = new THREE.Raycaster()
    raycaster.params.Points.threshold = 0.5

    function handlePoiMoveClick(vpIndex, e) {
      const state = useEditorStore.getState()
      if (state.activeTool !== 'poiMove') return

      const el = vpDivRefs.current[vpIndex]
      if (!el) return
      const rect = el.getBoundingClientRect()

      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )

      const cam = s.cameras[vpIndex]
      raycaster.setFromCamera(ndc, cam)

      // Only select existing POI markers
      const poiMeshes = s.poiMarkers.filter(obj => obj.userData?.poiId)
      const poiHits = raycaster.intersectObjects(poiMeshes)
      if (poiHits.length > 0) {
        state.setSelectedPoi(poiHits[0].object.userData.poiId)
      } else {
        state.setSelectedPoi(null)
      }
    }

    const handlers = []
    for (let i = 0; i < 4; i++) {
      const el = vpDivRefs.current[i]
      if (!el) continue
      const idx = i
      const handler = (e) => handlePoiMoveClick(idx, e)
      el.addEventListener('click', handler)
      handlers.push([el, handler])
    }

    return () => {
      for (const [el, handler] of handlers) {
        el.removeEventListener('click', handler)
      }
    }
  }, [activeTool])

  // ── Update point size on all cloud materials ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    for (const pts of s.pointObjects) {
      if (pts.material) pts.material.size = pointSize
    }
  }, [pointSize])

  // ── Sync pick markers to scene ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    // Clean up existing markers
    for (const obj of s.pickMarkers) {
      s.scene.remove(obj)
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    }
    s.pickMarkers = []

    if (!pickedPoints || pickedPoints.length === 0) return

    const state = useEditorStore.getState()

    // Group by pairIndex
    const pairMap = new Map()
    for (const pt of pickedPoints) {
      if (!pairMap.has(pt.pairIndex)) pairMap.set(pt.pairIndex, [])
      pairMap.get(pt.pairIndex).push(pt)
    }

    for (const [, pts] of pairMap) {
      const src = pts.find(p => p.cloudId === state.sourceCloudId)
      const tgt = pts.find(p => p.cloudId === state.targetCloudId)

      if (src) {
        const geo = new THREE.SphereGeometry(0.15, 8, 8)
        const mat = new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(src.position.x, src.position.y, src.position.z)
        mesh.renderOrder = 999
        s.scene.add(mesh)
        s.pickMarkers.push(mesh)
      }

      if (tgt) {
        const geo = new THREE.SphereGeometry(0.15, 8, 8)
        const mat = new THREE.MeshBasicMaterial({ color: 0xff6b6b, depthTest: false })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(tgt.position.x, tgt.position.y, tgt.position.z)
        mesh.renderOrder = 999
        s.scene.add(mesh)
        s.pickMarkers.push(mesh)
      }

      // Yellow connecting line for complete pairs
      if (src && tgt) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(src.position.x, src.position.y, src.position.z),
          new THREE.Vector3(tgt.position.x, tgt.position.y, tgt.position.z),
        ])
        const lineMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false })
        const line = new THREE.Line(lineGeo, lineMat)
        line.renderOrder = 999
        s.scene.add(line)
        s.pickMarkers.push(line)
      }
    }
  }, [pickedPoints, sourceCloudId, targetCloudId])

  // ── Measure tool click handler ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    if (activeTool !== 'measure') return

    const raycaster = new THREE.Raycaster()
    raycaster.params.Points.threshold = 0.3

    function handleMeasureClick(vpIndex, e) {
      const state = useEditorStore.getState()
      if (state.activeTool !== 'measure') return

      const el = vpDivRefs.current[vpIndex]
      if (!el) return
      const rect = el.getBoundingClientRect()

      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )

      const cam = s.cameras[vpIndex]
      raycaster.setFromCamera(ndc, cam)

      // Raycast against all visible clouds
      let closestHit = null
      for (const pts of s.pointObjects) {
        if (!pts.visible) continue
        const hits = raycaster.intersectObject(pts)
        if (hits.length > 0) {
          if (!closestHit || hits[0].distance < closestHit.distance) {
            closestHit = hits[0]
          }
        }
      }

      if (closestHit) {
        const p = closestHit.point
        state.addMeasurePoint({ x: p.x, y: p.y, z: p.z })
      }
    }

    const handlers = []
    for (let i = 0; i < 4; i++) {
      const el = vpDivRefs.current[i]
      if (!el) continue
      const idx = i
      const handler = (e) => handleMeasureClick(idx, e)
      el.addEventListener('click', handler)
      handlers.push([el, handler])
    }

    return () => {
      for (const [el, handler] of handlers) {
        el.removeEventListener('click', handler)
      }
    }
  }, [activeTool])

  // ── Sync measure markers to scene ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    // Clean up existing measure markers
    for (const obj of s.measureMarkers) {
      s.scene.remove(obj)
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose()
        obj.material.dispose()
      }
    }
    s.measureMarkers = []

    if (!measurePoints || measurePoints.length === 0) return

    // Render spheres at each point
    for (const pt of measurePoints) {
      const geo = new THREE.SphereGeometry(0.15, 8, 8)
      const mat = new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(pt.position.x, pt.position.y, pt.position.z)
      mesh.renderOrder = 999
      s.scene.add(mesh)
      s.measureMarkers.push(mesh)
    }

    // If two points, draw line + distance label
    if (measurePoints.length === 2) {
      const a = measurePoints[0].position
      const b = measurePoints[1].position

      // Connecting line
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, a.y, a.z),
        new THREE.Vector3(b.x, b.y, b.z),
      ])
      const lineMat = new THREE.LineBasicMaterial({ color: 0x4ade80, depthTest: false })
      const line = new THREE.Line(lineGeo, lineMat)
      line.renderOrder = 999
      s.scene.add(line)
      s.measureMarkers.push(line)

      // Distance
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const distM = dist.toFixed(2)
      const distFt = (dist * 3.28084).toFixed(2)

      // Text sprite at midpoint
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 64
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'rgba(10, 10, 18, 0.85)'
      ctx.beginPath()
      ctx.roundRect(0, 0, 256, 64, 8)
      ctx.fill()
      ctx.fillStyle = '#4ade80'
      ctx.font = 'bold 24px Ubuntu, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${distM}m / ${distFt}ft`, 128, 32)

      const texture = new THREE.CanvasTexture(canvas)
      const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false })
      const sprite = new THREE.Sprite(spriteMat)
      sprite.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
      sprite.scale.set(2.5, 0.625, 1)
      sprite.renderOrder = 1000
      s.scene.add(sprite)
      s.measureMarkers.push(sprite)
    }
  }, [measurePoints])

  // ── Sync trajectory line to scene ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    // Remove old trajectory
    if (s.trajectoryLine) {
      s.scene.remove(s.trajectoryLine)
      s.trajectoryLine.geometry.dispose()
      s.trajectoryLine.material.dispose()
      s.trajectoryLine = null
    }

    if (!trajectory?.positions || trajectory.positions.length < 2) return
    const visible = useEditorStore.getState().trajectoryVisible

    // Apply parent cloud's transform to trajectory positions
    const cloudTransform = trajectoryCloudId
      ? (clouds.find(c => c.id === trajectoryCloudId)?.transform || new THREE.Matrix4())
      : new THREE.Matrix4()

    const v = new THREE.Vector3()
    const points = trajectory.positions.map(p => {
      v.set(p[0], p[1], p[2])
      v.applyMatrix4(cloudTransform)
      return v.clone()
    })
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const mat = new THREE.LineBasicMaterial({ color: 0xfbbf24, linewidth: 2, depthTest: false })
    const line = new THREE.Line(geo, mat)
    line.renderOrder = 998
    line.visible = visible
    s.scene.add(line)
    s.trajectoryLine = line
  }, [trajectory, trajectoryCloudId, clouds])

  // ── Toggle trajectory visibility ──
  const trajectoryVisible = useEditorStore(s => s.trajectoryVisible)
  useEffect(() => {
    const s = stateRef.current
    if (s?.trajectoryLine) s.trajectoryLine.visible = trajectoryVisible
  }, [trajectoryVisible])

  // ── Sync POI markers to scene ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    const currentSelectedPoiId = useEditorStore.getState().selectedPoiId

    // Build a map of existing POI meshes (spheres only) so we can reuse the selected one
    const existingMeshById = new Map()
    for (const obj of s.poiMarkers) {
      if (obj.userData?.poiId && obj.isMesh && obj.geometry?.type === 'SphereGeometry') {
        existingMeshById.set(obj.userData.poiId, obj)
      }
    }

    // Remove old markers — but keep the selected POI's sphere mesh if TC is attached
    const keepMesh = currentSelectedPoiId ? existingMeshById.get(currentSelectedPoiId) : null
    for (const obj of s.poiMarkers) {
      if (obj === keepMesh) continue // preserve — TC is attached to this
      s.scene.remove(obj)
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    }
    s.poiMarkers = keepMesh ? [keepMesh] : []

    if (!pois || pois.length === 0) {
      // If we kept a mesh but there are no pois, clean it up
      if (keepMesh) {
        s.scene.remove(keepMesh)
        keepMesh.geometry?.dispose()
        keepMesh.material?.dispose()
        s.poiMarkers = []
      }
      return
    }

    const v = new THREE.Vector3()

    for (const poi of pois) {
      // Compute world position from local position + parent cloud transform
      const cloudTransform = poi.cloudId
        ? (clouds.find(c => c.id === poi.cloudId)?.transform || new THREE.Matrix4())
        : new THREE.Matrix4()
      v.set(poi.position[0], poi.position[1], poi.position[2])
      v.applyMatrix4(cloudTransform)
      const wx = v.x, wy = v.y, wz = v.z

      // Reuse existing mesh for the selected POI to keep TC attached
      if (poi.id === currentSelectedPoiId && keepMesh) {
        keepMesh.position.set(wx, wy, wz)
        keepMesh.material.color.set(poi.color || '#f472b6')
        keepMesh.material.opacity = 1.0
        // s.poiMarkers already has keepMesh
      } else {
        // Sphere marker
        const geo = new THREE.SphereGeometry(0.25, 12, 12)
        const mat = new THREE.MeshBasicMaterial({
          color: poi.color || '#f472b6',
          depthTest: false,
          transparent: true,
          opacity: poi.id === currentSelectedPoiId ? 1.0 : 0.8,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(wx, wy, wz)
        mesh.renderOrder = 997
        mesh.userData.poiId = poi.id
        s.scene.add(mesh)
        s.poiMarkers.push(mesh)
      }

      // Vertical line from marker downward for visibility
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(wx, wy, wz),
        new THREE.Vector3(wx, wy - 1.5, wz),
      ])
      const lineMat = new THREE.LineBasicMaterial({ color: poi.color || '#f472b6', depthTest: false })
      const line = new THREE.Line(lineGeo, lineMat)
      line.renderOrder = 997
      s.scene.add(line)
      s.poiMarkers.push(line)

      // Selection ring for selected POI
      if (poi.id === currentSelectedPoiId) {
        const ringGeo = new THREE.RingGeometry(0.35, 0.45, 24)
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x00e5ff,
          side: THREE.DoubleSide,
          depthTest: false,
          transparent: true,
          opacity: 0.8,
        })
        const ring = new THREE.Mesh(ringGeo, ringMat)
        ring.position.set(wx, wy, wz)
        ring.renderOrder = 998
        s.scene.add(ring)
        s.poiMarkers.push(ring)
      }
    }
  }, [pois, clouds])

  // ── Overlap visualization (distance-based coloring) ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    // Restore stashed colors when toggling off
    if (!overlapVisActive) {
      if (s.stashedColors) {
        for (const { pts, origColors } of s.stashedColors) {
          const colorAttr = pts.geometry.getAttribute('color')
          if (colorAttr) {
            colorAttr.array.set(origColors)
            colorAttr.needsUpdate = true
          }
        }
        s.stashedColors = null
      }
      return
    }

    const state = useEditorStore.getState()
    const srcPts = s.pointObjects.find(p => p.userData.cloudId === state.sourceCloudId)
    const tgtPts = s.pointObjects.find(p => p.userData.cloudId === state.targetCloudId)
    if (!srcPts || !tgtPts) return

    // Get world positions for target cloud → build KD-tree
    const tgtGeo = tgtPts.geometry
    const tgtPosAttr = tgtGeo.getAttribute('position')
    const tgtCount = tgtPosAttr.count
    const tgtWorld = new Float32Array(tgtCount * 3)
    const v = new THREE.Vector3()
    tgtPts.updateWorldMatrix(true, false)

    for (let i = 0; i < tgtCount; i++) {
      v.set(tgtPosAttr.array[i * 3], tgtPosAttr.array[i * 3 + 1], tgtPosAttr.array[i * 3 + 2])
      v.applyMatrix4(tgtPts.matrixWorld)
      tgtWorld[i * 3] = v.x
      tgtWorld[i * 3 + 1] = v.y
      tgtWorld[i * 3 + 2] = v.z
    }

    const tree = new KDTree3D(tgtWorld)

    // Stash source colors and recolor by proximity
    const srcGeo = srcPts.geometry
    const srcColorAttr = srcGeo.getAttribute('color')
    if (!srcColorAttr) return

    s.stashedColors = [{ pts: srcPts, origColors: new Float32Array(srcColorAttr.array) }]

    const srcPosAttr = srcGeo.getAttribute('position')
    const srcCount = srcPosAttr.count
    srcPts.updateWorldMatrix(true, false)

    const threshold = 0.5 // meters — blue (close) → original (far)
    for (let i = 0; i < srcCount; i++) {
      v.set(srcPosAttr.array[i * 3], srcPosAttr.array[i * 3 + 1], srcPosAttr.array[i * 3 + 2])
      v.applyMatrix4(srcPts.matrixWorld)

      const { distSq } = tree.nearest(v.x, v.y, v.z)
      const dist = Math.sqrt(distSq)
      const t = Math.min(1, dist / threshold) // 0 = close (blue), 1 = far (original)

      const idx = i * 3
      srcColorAttr.array[idx]     = t * s.stashedColors[0].origColors[idx]     + (1 - t) * 0.2
      srcColorAttr.array[idx + 1] = t * s.stashedColors[0].origColors[idx + 1] + (1 - t) * 0.4
      srcColorAttr.array[idx + 2] = t * s.stashedColors[0].origColors[idx + 2] + (1 - t) * 1.0
    }
    srcColorAttr.needsUpdate = true
  }, [overlapVisActive])

  // ── Box select drag handler ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return
    if (activeTool !== 'boxSelect') return

    function handleMouseDown(vpIndex, e) {
      if (e.button !== 0) return
      const state = useEditorStore.getState()
      if (state.activeTool !== 'boxSelect') return

      const el = vpDivRefs.current[vpIndex]
      if (!el) return
      const rect = el.getBoundingClientRect()
      const startX = e.clientX - rect.left
      const startY = e.clientY - rect.top

      setDragRect({ vpIndex, x1: startX, y1: startY, x2: startX, y2: startY })

      function onMove(me) {
        const r = el.getBoundingClientRect()
        setDragRect(prev => prev ? { ...prev, x2: me.clientX - r.left, y2: me.clientY - r.top } : null)
      }

      function onUp(me) {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)

        const r = el.getBoundingClientRect()
        const endX = me.clientX - r.left
        const endY = me.clientY - r.top
        setDragRect(null)

        // Minimum drag distance to avoid accidental clicks
        if (Math.abs(endX - startX) < 5 && Math.abs(endY - startY) < 5) return

        // Compute selection: project all points to screen, check if inside rect
        const state = useEditorStore.getState()
        const cloudId = state.selectedCloudId
        if (!cloudId) return

        const cloud = state.clouds.find(c => c.id === cloudId)
        if (!cloud?.geometry || !cloud.visible) return

        const cam = s.cameras[vpIndex]
        const posAttr = cloud.geometry.getAttribute('position')
        const count = posAttr.count

        const minX = Math.min(startX, endX)
        const maxX = Math.max(startX, endX)
        const minY = Math.min(startY, endY)
        const maxY = Math.max(startY, endY)

        const vpW = r.width
        const vpH = r.height
        const v = new THREE.Vector3()
        const selected = []

        for (let i = 0; i < count; i++) {
          v.set(posAttr.array[i * 3], posAttr.array[i * 3 + 1], posAttr.array[i * 3 + 2])
          v.applyMatrix4(cloud.transform)
          v.project(cam)

          // NDC to viewport pixel coords
          const sx = (v.x * 0.5 + 0.5) * vpW
          const sy = (-v.y * 0.5 + 0.5) * vpH

          if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
            selected.push(i)
          }
        }

        if (selected.length > 0) {
          if (me.shiftKey) {
            state.addToSelection(cloudId, selected)
          } else {
            state.setSelectedIndices(cloudId, selected)
          }
        } else if (!me.shiftKey) {
          state.clearSelection()
        }
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

    const handlers = []
    for (let i = 0; i < 4; i++) {
      const el = vpDivRefs.current[i]
      if (!el) continue
      const idx = i
      const handler = (e) => handleMouseDown(idx, e)
      el.addEventListener('mousedown', handler)
      handlers.push([el, handler])
    }

    return () => {
      for (const [el, handler] of handlers) {
        el.removeEventListener('mousedown', handler)
      }
    }
  }, [activeTool])

  // ── Selection highlight overlay ──
  useEffect(() => {
    const s = stateRef.current
    if (!s) return

    // Remove previous overlay
    if (s.selectionOverlay) {
      s.scene.remove(s.selectionOverlay)
      s.selectionOverlay.geometry.dispose()
      s.selectionOverlay.material.dispose()
      s.selectionOverlay = null
    }

    if (!selectedIndices) return

    // Find the cloud with the most selected points
    let bestCloudId = null
    let bestIndices = null
    for (const [cloudId, indices] of Object.entries(selectedIndices)) {
      if (indices && indices.length > 0) {
        if (!bestIndices || indices.length > bestIndices.length) {
          bestCloudId = cloudId
          bestIndices = indices
        }
      }
    }

    if (!bestCloudId || !bestIndices || bestIndices.length === 0) return

    const cloud = clouds.find(c => c.id === bestCloudId)
    if (!cloud?.geometry) return

    const srcPos = cloud.geometry.getAttribute('position')
    const count = bestIndices.length

    // Build overlay geometry with selected points in world space
    const positions = new Float32Array(count * 3)
    for (let j = 0; j < count; j++) {
      const i = bestIndices[j]
      positions[j * 3] = srcPos.array[i * 3]
      positions[j * 3 + 1] = srcPos.array[i * 3 + 1]
      positions[j * 3 + 2] = srcPos.array[i * 3 + 2]
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))

    const mat = new THREE.PointsMaterial({
      size: 0.15,
      color: 0xfbbf24, // bright amber/yellow
      depthTest: false,
      sizeAttenuation: true,
    })

    const overlay = new THREE.Points(geo, mat)
    overlay.renderOrder = 998

    // Apply same transform as the source cloud
    _pos.set(0, 0, 0); _quat.identity(); _scale.set(1, 1, 1)
    cloud.transform.decompose(_pos, _quat, _scale)
    overlay.position.copy(_pos)
    overlay.quaternion.copy(_quat)
    overlay.scale.copy(_scale)

    s.scene.add(overlay)
    s.selectionOverlay = overlay
  }, [selectedIndices, clouds])

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
          {dragRect && dragRect.vpIndex === 0 && <DragRectOverlay rect={dragRect} />}
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
          {dragRect && dragRect.vpIndex === 1 && <DragRectOverlay rect={dragRect} />}
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
          {dragRect && dragRect.vpIndex === 2 && <DragRectOverlay rect={dragRect} />}
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
          {dragRect && dragRect.vpIndex === 3 && <DragRectOverlay rect={dragRect} />}
        </div>
      </div>
    </div>
  )
})

export default EditorViewportLayout
