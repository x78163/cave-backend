import { create } from 'zustand'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js'

const gltfLoader = new GLTFLoader()
const plyLoader = new PLYLoader()
const pcdLoader = new PCDLoader()

const CLOUD_COLORS = ['#00e5ff', '#ff6b6b', '#4ade80', '#fbbf24', '#c084fc', '#f472b6', '#fb923c', '#38bdf8']

async function loadGlb(url) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`)
  const buffer = await resp.arrayBuffer()
  return new Promise((resolve, reject) =>
    gltfLoader.parse(buffer, '', resolve, reject)
  )
}

function extractPointCloud(gltf) {
  let geometry = null
  gltf.scene.traverse(child => {
    if (child.geometry && !geometry) {
      geometry = child.geometry
    }
  })
  return geometry
}

function ensureColors(geometry) {
  if (!geometry.getAttribute('color')) {
    const count = geometry.getAttribute('position').count
    const colors = new Float32Array(count * 3).fill(0.7)
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  }
  return geometry
}

function parseFileBuffer(buffer, ext) {
  if (ext === 'glb' || ext === 'gltf') {
    return new Promise((resolve, reject) => {
      gltfLoader.parse(buffer, '', (gltf) => {
        const geo = extractPointCloud(gltf)
        if (!geo) reject(new Error('No geometry found in GLB'))
        else resolve(geo)
      }, reject)
    })
  }
  if (ext === 'ply') {
    const geo = plyLoader.parse(buffer)
    return Promise.resolve(geo)
  }
  if (ext === 'pcd') {
    const parsed = pcdLoader.parse(buffer)
    // PCDLoader may return BufferGeometry or Points depending on version
    const geo = parsed.isBufferGeometry ? parsed : parsed.geometry
    return Promise.resolve(geo)
  }
  return Promise.reject(new Error(`Unsupported format: .${ext}`))
}

const useEditorStore = create((set, get) => ({
  caveId: null,
  caveName: '',
  clouds: [],
  activeTool: 'select',
  transformMode: null, // 'translate' | 'rotate' | 'scale' | null
  activeViewport: null,
  selectedCloudId: null,
  importModalOpen: false,
  flyMode: false,
  isDirty: false,
  loading: false,
  error: null,

  // Alignment mode state
  alignmentMode: false,
  sourceCloudId: null,
  targetCloudId: null,
  pickedPoints: [],
  currentPairIndex: 0,
  pickPhase: 'source', // 'source' | 'target'
  preAlignmentTransform: null,
  registrationResult: null,
  icpResult: null,
  icpRunning: false,
  icpProgress: null,
  overlapVisActive: false,
  icpSampleSize: 5000,

  // Selection + painting state
  selectedIndices: {}, // { [cloudId]: number[] }
  paintColor: '#ff6b6b',

  setCaveId: (id) => set({ caveId: id }),
  setCaveName: (name) => set({ caveName: name }),
  setActiveTool: (tool) => set({ activeTool: tool, transformMode: null }),
  setActiveViewport: (vp) => set({ activeViewport: vp }),
  setSelectedCloud: (id) => set({ selectedCloudId: id }),
  setImportModalOpen: (open) => set({ importModalOpen: open }),
  toggleFlyMode: () => set(state => ({ flyMode: !state.flyMode })),

  setTransformMode: (mode) => {
    const current = get().transformMode
    // Toggle off if same mode, otherwise activate
    set({ transformMode: current === mode ? null : mode })
  },

  loadCaveCloud: async (caveId) => {
    set({ loading: true, error: null })
    try {
      const urls = [
        `/api/caves/${caveId}/media/cave_pointcloud.glb`,
        `/media/caves/${caveId}/cave_pointcloud.glb`,
      ]
      let gltf = null
      for (const url of urls) {
        try {
          gltf = await loadGlb(url)
          break
        } catch { /* try next */ }
      }
      if (!gltf) throw new Error('No point cloud found')

      const geometry = extractPointCloud(gltf)
      if (!geometry) throw new Error('No geometry in GLB')
      ensureColors(geometry)

      const pointCount = geometry.getAttribute('position').count
      const cloud = {
        id: crypto.randomUUID(),
        name: get().caveName || 'Cave Point Cloud',
        sourceType: 'cave_glb',
        sourceCaveId: caveId,
        geometry,
        transform: new THREE.Matrix4(),
        visible: true,
        locked: false,
        pointCount,
        color: CLOUD_COLORS[0],
      }

      set(state => ({
        clouds: [...state.clouds, cloud],
        loading: false,
        selectedCloudId: cloud.id,
      }))

      return cloud
    } catch (err) {
      set({ loading: false, error: err.message })
      return null
    }
  },

  importFile: async (file) => {
    set({ loading: true, error: null })
    try {
      const buffer = await file.arrayBuffer()
      const ext = file.name.split('.').pop().toLowerCase()
      const geometry = await parseFileBuffer(buffer, ext)
      if (!geometry) throw new Error('No geometry found in file')
      ensureColors(geometry)

      const pointCount = geometry.getAttribute('position').count
      const colorIdx = get().clouds.length % CLOUD_COLORS.length
      const cloud = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.\w+$/, ''),
        sourceType: 'file',
        sourceCaveId: null,
        geometry,
        transform: new THREE.Matrix4(),
        visible: true,
        locked: false,
        pointCount,
        color: CLOUD_COLORS[colorIdx],
      }

      set(state => ({
        clouds: [...state.clouds, cloud],
        loading: false,
        selectedCloudId: cloud.id,
        importModalOpen: false,
      }))
      return cloud
    } catch (err) {
      set({ loading: false, error: err.message })
      return null
    }
  },

  importFromCave: async (caveId, caveName) => {
    set({ loading: true, error: null })
    try {
      const urls = [
        `/api/caves/${caveId}/media/cave_pointcloud.glb`,
        `/media/caves/${caveId}/cave_pointcloud.glb`,
      ]
      let gltf = null
      for (const url of urls) {
        try {
          gltf = await loadGlb(url)
          break
        } catch { /* try next */ }
      }
      if (!gltf) throw new Error('No point cloud found for this cave')

      const geometry = extractPointCloud(gltf)
      if (!geometry) throw new Error('No geometry in GLB')
      ensureColors(geometry)

      const pointCount = geometry.getAttribute('position').count
      const colorIdx = get().clouds.length % CLOUD_COLORS.length
      const cloud = {
        id: crypto.randomUUID(),
        name: caveName || 'Cave Point Cloud',
        sourceType: 'cave_glb',
        sourceCaveId: caveId,
        geometry,
        transform: new THREE.Matrix4(),
        visible: true,
        locked: false,
        pointCount,
        color: CLOUD_COLORS[colorIdx],
      }

      set(state => ({
        clouds: [...state.clouds, cloud],
        loading: false,
        selectedCloudId: cloud.id,
        importModalOpen: false,
      }))
      return cloud
    } catch (err) {
      set({ loading: false, error: err.message })
      return null
    }
  },

  updateCloudTransform: (cloudId, matrix) => set(state => ({
    clouds: state.clouds.map(c =>
      c.id === cloudId ? { ...c, transform: matrix.clone() } : c
    ),
    isDirty: true,
  })),

  toggleCloudVisibility: (cloudId) => set(state => ({
    clouds: state.clouds.map(c =>
      c.id === cloudId ? { ...c, visible: !c.visible } : c
    ),
  })),

  toggleCloudLock: (cloudId) => set(state => ({
    clouds: state.clouds.map(c =>
      c.id === cloudId ? { ...c, locked: !c.locked } : c
    ),
  })),

  setCloudColor: (cloudId, color) => set(state => ({
    clouds: state.clouds.map(c =>
      c.id === cloudId ? { ...c, color } : c
    ),
  })),

  deleteCloud: (cloudId) => {
    const state = get()
    const cloud = state.clouds.find(c => c.id === cloudId)
    if (cloud?.geometry) cloud.geometry.dispose()
    set({
      clouds: state.clouds.filter(c => c.id !== cloudId),
      selectedCloudId: state.selectedCloudId === cloudId ? null : state.selectedCloudId,
    })
  },

  // ── Alignment actions ──
  enterAlignmentMode: () => {
    const state = get()
    const unlocked = state.clouds.filter(c => !c.locked)
    if (unlocked.length < 2) return
    const source = unlocked.find(c => c.id === state.selectedCloudId) || unlocked[0]
    const target = unlocked.find(c => c.id !== source.id) || unlocked[1]
    set({
      alignmentMode: true,
      sourceCloudId: source.id,
      targetCloudId: target.id,
      preAlignmentTransform: source.transform.clone(),
      activeTool: 'pick',
      transformMode: null,
      pickedPoints: [],
      currentPairIndex: 0,
      pickPhase: 'source',
      registrationResult: null,
      icpResult: null,
      icpProgress: null,
      overlapVisActive: false,
    })
  },

  exitAlignmentMode: () => set({
    alignmentMode: false,
    sourceCloudId: null,
    targetCloudId: null,
    pickedPoints: [],
    currentPairIndex: 0,
    pickPhase: 'source',
    preAlignmentTransform: null,
    registrationResult: null,
    icpResult: null,
    icpRunning: false,
    icpProgress: null,
    overlapVisActive: false,
    activeTool: 'select',
  }),

  setSourceCloud: (id) => set({ sourceCloudId: id }),
  setTargetCloud: (id) => set({ targetCloudId: id }),

  addPickedPoint: (cloudId, position) => set(state => {
    const pt = {
      id: crypto.randomUUID(),
      cloudId,
      position,
      pairIndex: state.currentPairIndex,
    }
    const isTarget = state.pickPhase === 'target'
    return {
      pickedPoints: [...state.pickedPoints, pt],
      pickPhase: isTarget ? 'source' : 'target',
      currentPairIndex: isTarget ? state.currentPairIndex + 1 : state.currentPairIndex,
    }
  }),

  removePickedPair: (pairIndex) => set(state => ({
    pickedPoints: state.pickedPoints.filter(p => p.pairIndex !== pairIndex),
  })),

  clearPickedPoints: () => set({
    pickedPoints: [],
    currentPairIndex: 0,
    pickPhase: 'source',
    registrationResult: null,
  }),

  resetAlignment: () => {
    const state = get()
    if (state.preAlignmentTransform && state.sourceCloudId) {
      set(prev => ({
        clouds: prev.clouds.map(c =>
          c.id === prev.sourceCloudId ? { ...c, transform: prev.preAlignmentTransform.clone() } : c
        ),
        registrationResult: null,
        icpResult: null,
        icpProgress: null,
      }))
    }
  },

  acceptAlignment: () => {
    set({
      alignmentMode: false,
      sourceCloudId: null,
      targetCloudId: null,
      pickedPoints: [],
      currentPairIndex: 0,
      pickPhase: 'source',
      preAlignmentTransform: null,
      registrationResult: null,
      icpResult: null,
      icpRunning: false,
      icpProgress: null,
      overlapVisActive: false,
      activeTool: 'select',
      isDirty: true,
    })
  },

  setRegistrationResult: (result) => set({ registrationResult: result }),
  setIcpRunning: (running) => set({ icpRunning: running }),
  setIcpProgress: (progress) => set({ icpProgress: progress }),
  setIcpResult: (result) => set({ icpResult: result }),
  setIcpSampleSize: (size) => set({ icpSampleSize: size }),
  toggleOverlapVis: () => set(state => ({ overlapVisActive: !state.overlapVisActive })),

  // ── Selection + Paint actions ──
  setSelectedIndices: (cloudId, indices) => set(state => ({
    selectedIndices: { ...state.selectedIndices, [cloudId]: indices },
  })),

  addToSelection: (cloudId, indices) => set(state => {
    const existing = state.selectedIndices[cloudId] || []
    const merged = new Set([...existing, ...indices])
    return { selectedIndices: { ...state.selectedIndices, [cloudId]: [...merged] } }
  }),

  clearSelection: () => set({ selectedIndices: {} }),

  selectAllPoints: () => {
    const state = get()
    const cloudId = state.selectedCloudId
    if (!cloudId) return
    const cloud = state.clouds.find(c => c.id === cloudId)
    if (!cloud?.geometry) return
    const count = cloud.geometry.getAttribute('position').count
    const all = Array.from({ length: count }, (_, i) => i)
    set({ selectedIndices: { ...state.selectedIndices, [cloudId]: all } })
  },

  deleteSelectedPoints: () => {
    const state = get()
    const entries = Object.entries(state.selectedIndices).filter(([, indices]) => indices.length > 0)
    if (entries.length === 0) return

    const newClouds = state.clouds.map(cloud => {
      const indices = state.selectedIndices[cloud.id]
      if (!indices || indices.length === 0) return cloud

      const toDelete = new Set(indices)
      const oldGeo = cloud.geometry
      const oldPos = oldGeo.getAttribute('position')
      const oldCol = oldGeo.getAttribute('color')
      const oldCount = oldPos.count

      // Build new arrays without deleted indices
      const keepIndices = []
      for (let i = 0; i < oldCount; i++) {
        if (!toDelete.has(i)) keepIndices.push(i)
      }

      const newCount = keepIndices.length
      const newPos = new Float32Array(newCount * 3)
      const newCol = new Float32Array(newCount * 3)

      for (let j = 0; j < newCount; j++) {
        const i = keepIndices[j]
        newPos[j * 3] = oldPos.array[i * 3]
        newPos[j * 3 + 1] = oldPos.array[i * 3 + 1]
        newPos[j * 3 + 2] = oldPos.array[i * 3 + 2]
        if (oldCol) {
          newCol[j * 3] = oldCol.array[i * 3]
          newCol[j * 3 + 1] = oldCol.array[i * 3 + 1]
          newCol[j * 3 + 2] = oldCol.array[i * 3 + 2]
        }
      }

      const newGeo = new THREE.BufferGeometry()
      newGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3))
      newGeo.setAttribute('color', new THREE.Float32BufferAttribute(newCol, 3))

      oldGeo.dispose()
      return { ...cloud, geometry: newGeo, pointCount: newCount }
    })

    set({ clouds: newClouds, selectedIndices: {}, isDirty: true })
  },

  paintSelectedPoints: (hexColor) => {
    const state = get()
    const entries = Object.entries(state.selectedIndices).filter(([, indices]) => indices.length > 0)
    if (entries.length === 0) return

    // Convert hex to RGB 0-1
    const hex = hexColor.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16) / 255
    const g = parseInt(hex.substring(2, 4), 16) / 255
    const b = parseInt(hex.substring(4, 6), 16) / 255

    for (const [cloudId, indices] of entries) {
      const cloud = state.clouds.find(c => c.id === cloudId)
      if (!cloud?.geometry) continue
      const colorAttr = cloud.geometry.getAttribute('color')
      if (!colorAttr) continue

      for (const i of indices) {
        colorAttr.array[i * 3] = r
        colorAttr.array[i * 3 + 1] = g
        colorAttr.array[i * 3 + 2] = b
      }
      colorAttr.needsUpdate = true
    }

    set({ isDirty: true })
  },

  setPaintColor: (color) => set({ paintColor: color }),

  clearAll: () => {
    const { clouds } = get()
    for (const c of clouds) {
      if (c.geometry) c.geometry.dispose()
    }
    set({
      caveId: null,
      caveName: '',
      clouds: [],
      selectedCloudId: null,
      activeTool: 'select',
      transformMode: null,
      activeViewport: null,
      importModalOpen: false,
      flyMode: false,
      isDirty: false,
      loading: false,
      error: null,
      alignmentMode: false,
      sourceCloudId: null,
      targetCloudId: null,
      pickedPoints: [],
      currentPairIndex: 0,
      pickPhase: 'source',
      preAlignmentTransform: null,
      registrationResult: null,
      icpResult: null,
      icpRunning: false,
      icpProgress: null,
      overlapVisActive: false,
      selectedIndices: {},
      paintColor: '#ff6b6b',
    })
  },
}))

export { CLOUD_COLORS }
export default useEditorStore
