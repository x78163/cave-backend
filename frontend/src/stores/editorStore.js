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
    })
  },
}))

export { CLOUD_COLORS }
export default useEditorStore
