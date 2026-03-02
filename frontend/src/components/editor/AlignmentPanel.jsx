import { useState, useCallback } from 'react'
import * as THREE from 'three'
import useEditorStore from '../../stores/editorStore'
import { computeRigidTransform, rigidToMatrix4, downsamplePositions, runICP, KDTree3D } from '../../utils/alignmentMath'

/**
 * Extract world-space positions from a cloud's geometry + transform.
 */
function getWorldPositions(clouds, cloudId) {
  const cloud = clouds.find(c => c.id === cloudId)
  if (!cloud?.geometry) return null
  const posAttr = cloud.geometry.getAttribute('position')
  const count = posAttr.count
  const result = new Float32Array(count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    v.set(posAttr.array[i * 3], posAttr.array[i * 3 + 1], posAttr.array[i * 3 + 2])
    v.applyMatrix4(cloud.transform)
    result[i * 3] = v.x
    result[i * 3 + 1] = v.y
    result[i * 3 + 2] = v.z
  }
  return result
}

export default function AlignmentPanel() {
  const clouds = useEditorStore(s => s.clouds)
  const sourceCloudId = useEditorStore(s => s.sourceCloudId)
  const targetCloudId = useEditorStore(s => s.targetCloudId)
  const pickedPoints = useEditorStore(s => s.pickedPoints)
  const pickPhase = useEditorStore(s => s.pickPhase)
  const registrationResult = useEditorStore(s => s.registrationResult)
  const icpRunning = useEditorStore(s => s.icpRunning)
  const icpProgress = useEditorStore(s => s.icpProgress)
  const icpResult = useEditorStore(s => s.icpResult)
  const icpSampleSize = useEditorStore(s => s.icpSampleSize)
  const overlapVisActive = useEditorStore(s => s.overlapVisActive)

  const exitAlignmentMode = useEditorStore(s => s.exitAlignmentMode)
  const setSourceCloud = useEditorStore(s => s.setSourceCloud)
  const setTargetCloud = useEditorStore(s => s.setTargetCloud)
  const removePickedPair = useEditorStore(s => s.removePickedPair)
  const clearPickedPoints = useEditorStore(s => s.clearPickedPoints)
  const resetAlignment = useEditorStore(s => s.resetAlignment)
  const acceptAlignment = useEditorStore(s => s.acceptAlignment)
  const setIcpSampleSize = useEditorStore(s => s.setIcpSampleSize)
  const toggleOverlapVis = useEditorStore(s => s.toggleOverlapVis)

  // Group picked points into pairs by pairIndex
  const pairs = []
  const pairMap = new Map()
  for (const pt of pickedPoints) {
    if (!pairMap.has(pt.pairIndex)) pairMap.set(pt.pairIndex, [])
    pairMap.get(pt.pairIndex).push(pt)
  }
  for (const [idx, pts] of pairMap) {
    const src = pts.find(p => p.cloudId === sourceCloudId)
    const tgt = pts.find(p => p.cloudId === targetCloudId)
    pairs.push({ index: idx, source: src || null, target: tgt || null })
  }
  const completePairs = pairs.filter(p => p.source && p.target)
  const canRegister = completePairs.length >= 3

  // ── Apply N-point registration ──
  const handleApplyRegistration = useCallback(() => {
    const state = useEditorStore.getState()
    const srcPts = completePairs.map(p => p.source.position)
    const tgtPts = completePairs.map(p => p.target.position)

    try {
      const { R, t, rmse } = computeRigidTransform(srcPts, tgtPts)
      const m4arr = rigidToMatrix4(R, t)
      const alignMat = new THREE.Matrix4().fromArray(m4arr)

      // Compose: newTransform = alignMat * currentTransform
      const currentTransform = state.clouds.find(c => c.id === state.sourceCloudId)?.transform
      if (!currentTransform) return
      const composed = alignMat.clone().multiply(currentTransform)

      useEditorStore.getState().updateCloudTransform(state.sourceCloudId, composed)
      useEditorStore.getState().setRegistrationResult({ rmse, pairsUsed: completePairs.length })
    } catch (err) {
      console.error('Registration failed:', err)
    }
  }, [completePairs])

  // ── Run ICP ──
  const handleRunICP = useCallback(async () => {
    const state = useEditorStore.getState()
    const { sourceCloudId: srcId, targetCloudId: tgtId, clouds: c, icpSampleSize: sampleSize } = state
    if (!srcId || !tgtId) return

    state.setIcpRunning(true)
    state.setIcpResult(null)

    // Yield to UI before heavy computation
    await new Promise(r => setTimeout(r, 50))

    try {
      const srcWorld = getWorldPositions(c, srcId)
      const tgtWorld = getWorldPositions(c, tgtId)
      if (!srcWorld || !tgtWorld) return

      const srcSample = downsamplePositions(srcWorld, sampleSize)
      const tgtSample = downsamplePositions(tgtWorld, sampleSize)

      const result = runICP(srcSample, tgtSample, {
        maxIterations: 50,
        convergenceThreshold: 0.001,
        onProgress: (iter, meanDist, inlierCount) => {
          useEditorStore.getState().setIcpProgress({ iteration: iter, meanDist, inlierCount })
        },
      })

      // Compose with current transform
      const icpMat = new THREE.Matrix4().fromArray(result.matrix4)
      const currentTransform = useEditorStore.getState().clouds.find(c2 => c2.id === srcId)?.transform
      if (currentTransform) {
        const composed = icpMat.clone().multiply(currentTransform)
        useEditorStore.getState().updateCloudTransform(srcId, composed)
      }

      useEditorStore.getState().setIcpResult({
        iterations: result.iterations,
        meanDistance: result.meanDistance,
        converged: result.converged,
      })
    } catch (err) {
      console.error('ICP failed:', err)
    } finally {
      useEditorStore.getState().setIcpRunning(false)
    }
  }, [])

  const fmt = (v) => typeof v === 'number' ? v.toFixed(3) : '—'
  const fmtPt = (p) => p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : '...'

  const sourceCloud = clouds.find(c => c.id === sourceCloudId)
  const targetCloud = clouds.find(c => c.id === targetCloudId)

  return (
    <div
      className="flex flex-col h-full text-xs overflow-y-auto"
      style={{
        width: 240,
        background: 'var(--cyber-surface)',
        borderLeft: '1px solid var(--cyber-border)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--cyber-border)]">
        <span className="font-bold text-sm" style={{ color: '#c084fc' }}>Alignment</span>
        <button
          onClick={exitAlignmentMode}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10"
          style={{ color: 'var(--cyber-text-dim)' }}
        >
          &times;
        </button>
      </div>

      {/* Cloud selectors */}
      <div className="px-3 py-2 space-y-1 border-b border-[var(--cyber-border)]">
        <label className="block" style={{ color: 'var(--cyber-text-dim)' }}>
          Source (moves):
          <select
            value={sourceCloudId || ''}
            onChange={e => setSourceCloud(e.target.value)}
            className="block w-full mt-0.5 px-1 py-0.5 rounded text-xs"
            style={{ background: 'var(--cyber-bg)', color: 'var(--cyber-text)', border: '1px solid var(--cyber-border)' }}
          >
            {clouds.filter(c => !c.locked && c.id !== targetCloudId).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block" style={{ color: 'var(--cyber-text-dim)' }}>
          Target (fixed):
          <select
            value={targetCloudId || ''}
            onChange={e => setTargetCloud(e.target.value)}
            className="block w-full mt-0.5 px-1 py-0.5 rounded text-xs"
            style={{ background: 'var(--cyber-bg)', color: 'var(--cyber-text)', border: '1px solid var(--cyber-border)' }}
          >
            {clouds.filter(c => !c.locked && c.id !== sourceCloudId).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Point pairs */}
      <div className="px-3 py-2 border-b border-[var(--cyber-border)]">
        <div className="flex items-center justify-between mb-1">
          <span style={{ color: 'var(--cyber-text-dim)' }}>Control Points ({completePairs.length})</span>
          {pickedPoints.length > 0 && (
            <button
              onClick={clearPickedPoints}
              className="text-[10px] px-1 rounded hover:bg-white/10"
              style={{ color: '#ff6b6b' }}
            >
              Clear
            </button>
          )}
        </div>

        {pairs.length === 0 && (
          <p className="text-[10px] italic" style={{ color: 'var(--cyber-text-dim)' }}>
            Use Pick tool (P) to select matching points on source and target clouds.
          </p>
        )}

        <div className="space-y-1 max-h-32 overflow-y-auto">
          {pairs.map(pair => (
            <div key={pair.index} className="flex items-start gap-1 text-[10px] font-mono" style={{ color: 'var(--cyber-text-dim)' }}>
              <span className="shrink-0" style={{ color: '#fbbf24' }}>#{pair.index + 1}</span>
              <div className="flex-1 min-w-0">
                <div style={{ color: '#4ade80' }}>S: {pair.source ? fmtPt(pair.source.position) : '...'}</div>
                <div style={{ color: '#ff6b6b' }}>T: {pair.target ? fmtPt(pair.target.position) : '...'}</div>
              </div>
              <button
                onClick={() => removePickedPair(pair.index)}
                className="shrink-0 hover:bg-white/10 rounded"
                style={{ color: '#ff6b6b' }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        {/* Current pick phase indicator */}
        <div className="mt-1 text-[10px]" style={{ color: pickPhase === 'source' ? '#4ade80' : '#ff6b6b' }}>
          Next pick: {pickPhase === 'source' ? 'Source' : 'Target'} cloud
        </div>
      </div>

      {/* Registration */}
      <div className="px-3 py-2 border-b border-[var(--cyber-border)]">
        <span className="block mb-1" style={{ color: 'var(--cyber-text-dim)' }}>Registration</span>
        <button
          onClick={handleApplyRegistration}
          disabled={!canRegister}
          className="w-full px-2 py-1 rounded text-xs font-medium transition-all"
          style={{
            background: canRegister ? 'rgba(192,132,252,0.2)' : 'rgba(255,255,255,0.05)',
            color: canRegister ? '#c084fc' : 'var(--cyber-text-dim)',
            border: `1px solid ${canRegister ? 'rgba(192,132,252,0.4)' : 'var(--cyber-border)'}`,
            cursor: canRegister ? 'pointer' : 'not-allowed',
          }}
        >
          Apply Registration ({completePairs.length} pairs)
        </button>
        {registrationResult && (
          <div className="mt-1 text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
            RMSE: <span style={{ color: '#4ade80' }}>{fmt(registrationResult.rmse)}m</span>
            {' '}({registrationResult.pairsUsed} pairs)
          </div>
        )}
      </div>

      {/* ICP */}
      <div className="px-3 py-2 border-b border-[var(--cyber-border)]">
        <span className="block mb-1" style={{ color: 'var(--cyber-text-dim)' }}>ICP Fine-Tune</span>

        <label className="flex items-center gap-2 mb-1 text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
          Samples:
          <input
            type="range"
            min={1000}
            max={20000}
            step={1000}
            value={icpSampleSize}
            onChange={e => setIcpSampleSize(+e.target.value)}
            className="flex-1"
            style={{ accentColor: '#c084fc' }}
          />
          <span className="w-10 text-right font-mono">{icpSampleSize}</span>
        </label>

        <button
          onClick={handleRunICP}
          disabled={icpRunning || !sourceCloudId || !targetCloudId}
          className="w-full px-2 py-1 rounded text-xs font-medium transition-all"
          style={{
            background: icpRunning ? 'rgba(192,132,252,0.1)' : 'rgba(192,132,252,0.2)',
            color: '#c084fc',
            border: '1px solid rgba(192,132,252,0.4)',
            cursor: icpRunning ? 'wait' : 'pointer',
          }}
        >
          {icpRunning ? 'Running...' : 'Run ICP'}
        </button>

        {icpRunning && icpProgress && (
          <div className="mt-1">
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--cyber-border)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, (icpProgress.iteration / 50) * 100)}%`, background: '#c084fc' }}
              />
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--cyber-text-dim)' }}>
              Iter {icpProgress.iteration} — dist: {fmt(icpProgress.meanDist)}m
            </div>
          </div>
        )}

        {icpResult && !icpRunning && (
          <div className="mt-1 text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
            {icpResult.converged ? (
              <span style={{ color: '#4ade80' }}>Converged</span>
            ) : (
              <span style={{ color: '#fbbf24' }}>Max iterations</span>
            )}
            {' '}in {icpResult.iterations} iter — dist: {fmt(icpResult.meanDistance)}m
          </div>
        )}
      </div>

      {/* Overlap visualization */}
      <div className="px-3 py-2 border-b border-[var(--cyber-border)]">
        <button
          onClick={toggleOverlapVis}
          className="w-full px-2 py-1 rounded text-xs font-medium transition-all"
          style={{
            background: overlapVisActive ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
            color: overlapVisActive ? '#3b82f6' : 'var(--cyber-text-dim)',
            border: `1px solid ${overlapVisActive ? 'rgba(59,130,246,0.4)' : 'var(--cyber-border)'}`,
          }}
        >
          {overlapVisActive ? 'Hide' : 'Show'} Overlap Colors
        </button>
      </div>

      {/* Accept / Reset */}
      <div className="px-3 py-2 mt-auto flex gap-2">
        <button
          onClick={acceptAlignment}
          className="flex-1 px-2 py-1.5 rounded text-xs font-bold transition-all"
          style={{
            background: 'rgba(74,222,128,0.2)',
            color: '#4ade80',
            border: '1px solid rgba(74,222,128,0.4)',
          }}
        >
          Accept
        </button>
        <button
          onClick={resetAlignment}
          className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-all"
          style={{
            background: 'rgba(255,107,107,0.1)',
            color: '#ff6b6b',
            border: '1px solid rgba(255,107,107,0.3)',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
