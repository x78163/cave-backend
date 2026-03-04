import { create } from 'zustand'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { apiFetch } from '../hooks/useApi'

const gltfLoader = new GLTFLoader()
const plyLoader = new PLYLoader()
const pcdLoader = new PCDLoader()
const gltfExporter = new GLTFExporter()

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

async function exportGeometryToGlb(geometry) {
  // Wrap geometry in a Points mesh for GLTFExporter
  const material = new THREE.PointsMaterial({ vertexColors: true })
  const points = new THREE.Points(geometry.clone(), material)
  const glb = await gltfExporter.parseAsync(points, { binary: true })
  material.dispose()
  points.geometry.dispose()
  return new Blob([glb], { type: 'model/gltf-binary' })
}

function mergeCloudGeometries(clouds) {
  // Merge all visible clouds into a single geometry with transforms applied
  const visibleClouds = clouds.filter(c => c.visible && c.geometry)
  if (visibleClouds.length === 0) return null

  let totalPoints = 0
  for (const cloud of visibleClouds) {
    totalPoints += cloud.geometry.getAttribute('position').count
  }

  const mergedPos = new Float32Array(totalPoints * 3)
  const mergedCol = new Float32Array(totalPoints * 3)
  let offset = 0

  for (const cloud of visibleClouds) {
    const posAttr = cloud.geometry.getAttribute('position')
    const colAttr = cloud.geometry.getAttribute('color')
    const count = posAttr.count

    // Apply transform to each point
    const v = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      v.set(posAttr.array[i * 3], posAttr.array[i * 3 + 1], posAttr.array[i * 3 + 2])
      v.applyMatrix4(cloud.transform)
      mergedPos[(offset + i) * 3] = v.x
      mergedPos[(offset + i) * 3 + 1] = v.y
      mergedPos[(offset + i) * 3 + 2] = v.z
    }

    // Copy colors directly
    if (colAttr) {
      mergedCol.set(colAttr.array.subarray(0, count * 3), offset * 3)
    } else {
      mergedCol.fill(0.7, offset * 3, (offset + count) * 3)
    }

    offset += count
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mergedPos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(mergedCol, 3))
  return geo
}

async function fetchTrajectory(caveId) {
  const urls = [
    `/api/caves/${caveId}/media/trajectory.json`,
    `/media/caves/${caveId}/trajectory.json`,
  ]
  for (const url of urls) {
    try {
      const resp = await fetch(url)
      if (!resp.ok) continue
      return await resp.json()
    } catch { /* try next */ }
  }
  return null
}

const POI_TYPES = [
  { value: 'entrance', label: 'Entrance', color: '#4ade80' },
  { value: 'junction', label: 'Junction', color: '#8b5cf6' },
  { value: 'squeeze', label: 'Squeeze', color: '#ef4444' },
  { value: 'water', label: 'Water', color: '#38bdf8' },
  { value: 'formation', label: 'Formation', color: '#fbbf24' },
  { value: 'hazard', label: 'Hazard', color: '#ff6b6b' },
  { value: 'biology', label: 'Biology', color: '#10b981' },
  { value: 'camp', label: 'Camp', color: '#f97316' },
  { value: 'survey_station', label: 'Survey Station', color: '#6366f1' },
  { value: 'transition', label: 'Transition', color: '#ec4899' },
  { value: 'marker', label: 'Marker', color: '#a1a1aa' },
  { value: 'waypoint', label: 'Waypoint', color: '#fb923c' },
]

function poiTypeColor(type) {
  return POI_TYPES.find(t => t.value === type)?.color || '#f472b6'
}

async function fetchCavePois(caveId) {
  try {
    const data = await apiFetch(`/mapping/caves/${caveId}/pois/`)
    const poiList = data.pois || data || []
    // Only import POIs with SLAM coordinates
    return poiList
      .filter(p => p.slam_x != null && p.slam_y != null && p.slam_z != null)
      .map(p => ({
        id: p.id,
        name: p.label || `${(POI_TYPES.find(t => t.value === p.poi_type)?.label || 'POI')}`,
        type: p.poi_type || 'marker',
        position: [p.slam_x, p.slam_y, p.slam_z],
        color: poiTypeColor(p.poi_type),
        dbId: p.id, // track database origin for sync
        latitude: p.latitude,
        longitude: p.longitude,
        description: p.description || '',
        source: p.source || 'mapping',
      }))
  } catch {
    return []
  }
}

async function syncPoisToDatabase(caveId, pois, originalDbIds) {
  const currentDbIds = new Set(pois.filter(p => p.dbId).map(p => p.dbId))
  const updatedPois = [...pois]

  // DELETE: original dbIds that are no longer in the editor
  for (const dbId of originalDbIds) {
    if (!currentDbIds.has(dbId)) {
      try {
        await apiFetch(`/mapping/caves/${caveId}/pois/${dbId}/`, { method: 'DELETE' })
      } catch { /* already deleted or not found — ok */ }
    }
  }

  // CREATE or UPDATE each POI
  for (let i = 0; i < updatedPois.length; i++) {
    const poi = updatedPois[i]
    const payload = {
      label: poi.name || '',
      poi_type: poi.type || 'marker',
      description: poi.description || '',
      slam_x: poi.position[0],
      slam_y: poi.position[1],
      slam_z: poi.position[2],
      source: poi.source || 'editor',
    }
    // Preserve GPS coords if they exist
    if (poi.latitude != null) payload.latitude = poi.latitude
    if (poi.longitude != null) payload.longitude = poi.longitude

    try {
      if (poi.dbId) {
        // UPDATE existing
        await apiFetch(`/mapping/caves/${caveId}/pois/${poi.dbId}/`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        // CREATE new
        const created = await apiFetch(`/mapping/caves/${caveId}/pois/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        // Store the new dbId so future saves update instead of re-creating
        updatedPois[i] = { ...poi, dbId: created.id }
      }
    } catch (err) {
      console.warn(`POI sync failed for "${poi.name}":`, err)
    }
  }

  return updatedPois
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

  // Project persistence state
  projectId: null,
  projectName: '',
  saving: false,
  lastSavedAt: null,

  // Trajectory state
  trajectory: null, // { positions: [[x,y,z], ...] } or null
  trajectoryVisible: true,

  // POI state
  pois: [], // [{ id, name, type, position: [x,y,z], color, dbId?, ... }]
  selectedPoiId: null,
  _originalPoiDbIds: [], // dbIds loaded at start, for detecting deletions on save

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
        modified: false,
      }

      set(state => ({
        clouds: [...state.clouds, cloud],
        loading: false,
        selectedCloudId: cloud.id,
      }))

      // Fetch trajectory and existing POIs in background (non-blocking)
      fetchTrajectory(caveId).then(traj => {
        if (traj) set({ trajectory: traj })
      }).catch(() => {})

      fetchCavePois(caveId).then(cavePois => {
        if (cavePois.length > 0) {
          const dbIds = cavePois.filter(p => p.dbId).map(p => p.dbId)
          set({ pois: cavePois, _originalPoiDbIds: dbIds })
        }
      }).catch(() => {})

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
        modified: true, // file uploads always need geometry saved
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
        modified: false,
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

  // ── Trajectory actions ──
  setTrajectory: (traj) => set({ trajectory: traj }),
  toggleTrajectoryVisible: () => set(state => ({ trajectoryVisible: !state.trajectoryVisible })),

  // ── POI actions ──
  addPoi: (position) => {
    const poi = {
      id: crypto.randomUUID(),
      name: `POI ${get().pois.length + 1}`,
      type: 'marker',
      position: [position.x, position.y, position.z],
      color: poiTypeColor('marker'),
    }
    set(state => ({
      pois: [...state.pois, poi],
      selectedPoiId: poi.id,
      isDirty: true,
    }))
    return poi
  },

  updatePoi: (poiId, updates) => set(state => ({
    pois: state.pois.map(p => p.id === poiId ? { ...p, ...updates } : p),
    isDirty: true,
  })),

  deletePoi: (poiId) => set(state => ({
    pois: state.pois.filter(p => p.id !== poiId),
    selectedPoiId: state.selectedPoiId === poiId ? null : state.selectedPoiId,
    isDirty: true,
  })),

  setSelectedPoi: (id) => set({ selectedPoiId: id }),

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
      return { ...cloud, geometry: newGeo, pointCount: newCount, modified: true }
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

    const modifiedCloudIds = new Set()
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
      modifiedCloudIds.add(cloudId)
    }

    set(prev => ({
      clouds: prev.clouds.map(c =>
        modifiedCloudIds.has(c.id) ? { ...c, modified: true } : c
      ),
      isDirty: true,
    }))
  },

  setPaintColor: (color) => set({ paintColor: color }),

  // ── Project persistence actions ──
  setProjectId: (id) => set({ projectId: id }),
  setProjectName: (name) => set({ projectName: name }),

  saveProject: async (name) => {
    const state = get()
    if (!state.caveId) throw new Error('No cave loaded')
    set({ saving: true, error: null })

    try {
      const formData = new FormData()
      formData.append('name', name)

      // Build cloud metadata and export geometry files
      const cloudsMeta = []
      for (const cloud of state.clouds) {
        const needsGeometry = cloud.modified || cloud.sourceType === 'file'
        const geoFileName = needsGeometry ? `cloud_${cloud.id.slice(0, 8)}.glb` : null

        cloudsMeta.push({
          id: cloud.id,
          name: cloud.name,
          sourceType: cloud.sourceType,
          sourceCaveId: cloud.sourceCaveId,
          transform: cloud.transform.toArray(),
          visible: cloud.visible,
          locked: cloud.locked,
          pointCount: cloud.pointCount,
          color: cloud.color,
          geometryFile: geoFileName,
          isModified: needsGeometry,
        })

        if (needsGeometry && cloud.geometry) {
          const blob = await exportGeometryToGlb(cloud.geometry)
          formData.append(`cloud_${cloud.id}`, blob, geoFileName)
        }
      }

      const projectState = { version: 1, clouds: cloudsMeta, pois: state.pois }
      formData.append('project_state', JSON.stringify(projectState))

      // Merge all visible clouds and publish as cave's explorer point cloud
      const mergedGeo = mergeCloudGeometries(state.clouds)
      if (mergedGeo) {
        const mergedBlob = await exportGeometryToGlb(mergedGeo)
        mergedGeo.dispose()
        formData.append('merged_glb', mergedBlob, 'merged.glb')
      }

      const isUpdate = !!state.projectId
      const url = isUpdate
        ? `/caves/${state.caveId}/editor-projects/${state.projectId}/`
        : `/caves/${state.caveId}/editor-projects/`

      const result = await apiFetch(url, {
        method: isUpdate ? 'PATCH' : 'POST',
        body: formData,
      })

      set({
        saving: false,
        projectId: result.id,
        projectName: result.name,
        lastSavedAt: new Date().toISOString(),
        isDirty: false,
      })

      // Sync POIs back to the mapping database (fire-and-forget)
      const syncState = get()
      if (syncState.caveId) {
        syncPoisToDatabase(syncState.caveId, syncState.pois, syncState._originalPoiDbIds)
          .then(updatedPois => {
            if (updatedPois) {
              const dbIds = updatedPois.filter(p => p.dbId).map(p => p.dbId)
              set({ pois: updatedPois, _originalPoiDbIds: dbIds })
            }
          })
          .catch(err => console.warn('POI sync failed:', err))
      }

      return result
    } catch (err) {
      set({ saving: false, error: err.message || 'Save failed' })
      throw err
    }
  },

  loadProject: async (caveId, projectId) => {
    set({ loading: true, error: null })
    try {
      const project = await apiFetch(`/caves/${caveId}/editor-projects/${projectId}/`)
      const state = project.project_state
      if (!state?.clouds) throw new Error('Invalid project data')

      // Dispose existing clouds
      const current = get()
      for (const c of current.clouds) {
        if (c.geometry) c.geometry.dispose()
      }

      // Load each cloud
      const loadedClouds = []
      for (const meta of state.clouds) {
        let geometry = null

        if (meta.geometryFile) {
          // Fetch saved geometry file
          const url = `/api/caves/${caveId}/editor-projects/${projectId}/file/${meta.geometryFile}`
          const gltf = await loadGlb(url)
          geometry = extractPointCloud(gltf)
        } else if (meta.sourceType === 'cave_glb' && meta.sourceCaveId) {
          // Re-fetch from original cave
          const urls = [
            `/api/caves/${meta.sourceCaveId}/media/cave_pointcloud.glb`,
            `/media/caves/${meta.sourceCaveId}/cave_pointcloud.glb`,
          ]
          for (const url of urls) {
            try {
              const gltf = await loadGlb(url)
              geometry = extractPointCloud(gltf)
              if (geometry) break
            } catch { /* try next */ }
          }
        }

        if (!geometry) {
          console.warn(`Could not load geometry for cloud "${meta.name}"`)
          continue
        }
        ensureColors(geometry)

        loadedClouds.push({
          id: meta.id,
          name: meta.name,
          sourceType: meta.sourceType,
          sourceCaveId: meta.sourceCaveId,
          geometry,
          transform: new THREE.Matrix4().fromArray(meta.transform),
          visible: meta.visible,
          locked: meta.locked,
          pointCount: geometry.getAttribute('position').count,
          color: meta.color,
          modified: false,
        })
      }

      const savedPois = state.pois || []

      set({
        clouds: loadedClouds,
        loading: false,
        projectId: project.id,
        projectName: project.name,
        lastSavedAt: project.updated_at,
        isDirty: false,
        selectedCloudId: loadedClouds.length > 0 ? loadedClouds[0].id : null,
        pois: savedPois,
        _originalPoiDbIds: savedPois.filter(p => p.dbId).map(p => p.dbId),
      })

      // Fetch trajectory and merge fresh cave POIs in background
      fetchTrajectory(caveId).then(traj => {
        if (traj) set({ trajectory: traj })
      }).catch(() => {})

      // Merge fresh cave POIs — add any new ones not already in saved project
      fetchCavePois(caveId).then(freshPois => {
        const current = get()
        const existingDbIds = new Set(current.pois.filter(p => p.dbId).map(p => p.dbId))
        const newPois = freshPois.filter(p => p.dbId && !existingDbIds.has(p.dbId))
        if (newPois.length > 0) {
          const allDbIds = [...current._originalPoiDbIds, ...newPois.map(p => p.dbId)]
          set({
            pois: [...current.pois, ...newPois],
            _originalPoiDbIds: allDbIds,
          })
        }
      }).catch(() => {})

      return project
    } catch (err) {
      set({ loading: false, error: err.message || 'Load failed' })
      throw err
    }
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
      trajectory: null,
      trajectoryVisible: true,
      pois: [],
      selectedPoiId: null,
      _originalPoiDbIds: [],
      projectId: null,
      projectName: '',
      saving: false,
      lastSavedAt: null,
    })
  },
}))

export { CLOUD_COLORS, POI_TYPES }
export default useEditorStore
