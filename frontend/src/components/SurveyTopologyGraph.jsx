import { useMemo } from 'react'
import { BRANCH_COLORS } from '../utils/surveyColors'

const LANE_SPACING = 32
const ROW_HEIGHT = 24
const DOT_RADIUS = 4
const JUNCTION_RADIUS = 7
const LABEL_OFFSET = 14
const PADDING = { top: 28, left: 12, right: 80, bottom: 12 }

/**
 * SVG-based GitHub-style branch/fork topology graph for cave surveys.
 * Shows stations as dots along vertical branch lanes with fork curves at junctions.
 * Loop closure shots shown as dashed merge lines.
 * Click any station to start a new branch from it.
 */
export default function SurveyTopologyGraph({ renderData, onBranchFrom, height = 300 }) {
  const layout = useMemo(() => {
    if (!renderData?.branches?.length) return null

    const branches = renderData.branches
    const junctionSet = new Set(renderData.junction_stations || [])

    // Build station → vertical position (row index)
    // Walk branches in order, assigning rows sequentially
    const stationRow = {}
    let rowCounter = 0

    // Process main branch first, then sub-branches
    for (const branch of branches) {
      for (const stName of branch.stations) {
        if (!(stName in stationRow)) {
          stationRow[stName] = rowCounter++
        }
      }
    }

    // Build lane positions for each branch
    const laneMap = {}
    for (let i = 0; i < branches.length; i++) {
      laneMap[branches[i].id] = i
    }

    // Build station → branch id lookup
    const stationBranch = {}
    for (const branch of branches) {
      for (const stName of branch.stations) {
        if (!(stName in stationBranch)) {
          stationBranch[stName] = branch.id
        }
      }
    }

    // Build station info for rendering
    const stationNodes = []
    for (const branch of branches) {
      const lane = laneMap[branch.id]
      for (const stName of branch.stations) {
        stationNodes.push({
          name: stName,
          lane,
          row: stationRow[stName],
          branchId: branch.id,
          isJunction: junctionSet.has(stName),
        })
      }
    }

    // Build fork curves (from parent junction to first station of child branch)
    const forks = []
    for (const branch of branches) {
      if (branch.parent_station == null || branch.parent_branch == null) continue
      const parentLane = laneMap[branch.parent_branch]
      const childLane = laneMap[branch.id]
      const parentRow = stationRow[branch.parent_station]
      const childRow = stationRow[branch.stations[0]]
      if (parentRow == null || childRow == null) continue
      forks.push({
        parentLane,
        childLane,
        parentRow,
        childRow,
        branchId: branch.id,
      })
    }

    // Build vertical lane segments (connect consecutive stations in each branch)
    const laneSegments = []
    for (const branch of branches) {
      const lane = laneMap[branch.id]
      for (let i = 0; i < branch.stations.length - 1; i++) {
        const r1 = stationRow[branch.stations[i]]
        const r2 = stationRow[branch.stations[i + 1]]
        laneSegments.push({ lane, r1, r2, branchId: branch.id })
      }
    }

    // Build loop closure merge lines
    const merges = []
    for (const lc of (renderData.loop_closures || [])) {
      const fromBranch = stationBranch[lc.from]
      const toBranch = stationBranch[lc.to]
      if (fromBranch == null || toBranch == null) continue
      const fromLane = laneMap[fromBranch]
      const toLane = laneMap[toBranch]
      const fromRow = stationRow[lc.from]
      const toRow = stationRow[lc.to]
      if (fromRow == null || toRow == null) continue
      merges.push({ fromLane, toLane, fromRow, toRow, from: lc.from, to: lc.to })
    }

    const totalRows = rowCounter
    const totalLanes = branches.length
    const svgWidth = PADDING.left + totalLanes * LANE_SPACING + PADDING.right
    const svgHeight = PADDING.top + totalRows * ROW_HEIGHT + PADDING.bottom

    return { branches, stationNodes, forks, laneSegments, merges, svgWidth, svgHeight, laneMap }
  }, [renderData])

  if (!layout || !renderData?.branches?.length || renderData.branches.length < 2) return null

  const laneX = (lane) => PADDING.left + lane * LANE_SPACING + LANE_SPACING / 2
  const rowY = (row) => PADDING.top + row * ROW_HEIGHT + ROW_HEIGHT / 2

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: '1px solid var(--cyber-border)',
        background: 'rgba(10,14,20,0.8)',
        maxHeight: height,
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div className="px-2 py-1 text-[10px] opacity-50 uppercase tracking-wider border-b"
        style={{ borderColor: 'var(--cyber-border)' }}>
        Topology
      </div>

      <svg
        width={layout.svgWidth}
        height={layout.svgHeight}
        style={{ display: 'block' }}
      >
        {/* Branch labels at top */}
        {layout.branches.map(b => (
          <text
            key={`label-${b.id}`}
            x={laneX(layout.laneMap[b.id])}
            y={12}
            textAnchor="middle"
            fill={BRANCH_COLORS[b.id % BRANCH_COLORS.length]}
            fontSize="9"
            fontFamily="monospace"
            opacity={0.7}
          >
            {b.name}
          </text>
        ))}

        {/* Lane vertical segments */}
        {layout.laneSegments.map((seg, i) => (
          <line
            key={`seg-${i}`}
            x1={laneX(seg.lane)}
            y1={rowY(seg.r1)}
            x2={laneX(seg.lane)}
            y2={rowY(seg.r2)}
            stroke={BRANCH_COLORS[seg.branchId % BRANCH_COLORS.length]}
            strokeWidth={2}
            opacity={0.6}
          />
        ))}

        {/* Fork curves (bezier from parent junction to child branch) */}
        {layout.forks.map((fork, i) => {
          const px = laneX(fork.parentLane)
          const py = rowY(fork.parentRow)
          const cx = laneX(fork.childLane)
          const cy = rowY(fork.childRow)
          const midY = (py + cy) / 2
          return (
            <path
              key={`fork-${i}`}
              d={`M ${px} ${py} C ${px} ${midY}, ${cx} ${midY}, ${cx} ${cy}`}
              fill="none"
              stroke={BRANCH_COLORS[fork.branchId % BRANCH_COLORS.length]}
              strokeWidth={2}
              opacity={0.5}
            />
          )
        })}

        {/* Loop closure merge lines (dashed bezier from branch end back to target) */}
        {layout.merges.map((merge, i) => {
          const fx = laneX(merge.fromLane)
          const fy = rowY(merge.fromRow)
          const tx = laneX(merge.toLane)
          const ty = rowY(merge.toRow)
          // Curve direction: go outward from the from-lane then sweep to target
          const midY = (fy + ty) / 2
          return (
            <g key={`merge-${i}`}>
              <path
                d={`M ${fx} ${fy} C ${fx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`}
                fill="none"
                stroke="#69f0ae"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.5}
              />
              {/* Small arrow at target end */}
              <circle
                cx={tx}
                cy={ty}
                r={3}
                fill="none"
                stroke="#69f0ae"
                strokeWidth={1}
                opacity={0.5}
              />
            </g>
          )
        })}

        {/* Station dots + labels */}
        {layout.stationNodes.map(st => {
          const x = laneX(st.lane)
          const y = rowY(st.row)
          const color = BRANCH_COLORS[st.branchId % BRANCH_COLORS.length]
          return (
            <g
              key={st.name}
              style={{ cursor: 'pointer' }}
              onClick={() => onBranchFrom?.(st.name)}
            >
              {/* Hover hit area */}
              <rect
                x={x - 8}
                y={y - ROW_HEIGHT / 2}
                width={LABEL_OFFSET + 60}
                height={ROW_HEIGHT}
                fill="transparent"
              />

              {/* Junction ring */}
              {st.isJunction && (
                <circle
                  cx={x}
                  cy={y}
                  r={JUNCTION_RADIUS}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  opacity={0.6}
                />
              )}

              {/* Station dot */}
              <circle
                cx={x}
                cy={y}
                r={DOT_RADIUS}
                fill={color}
              />

              {/* Station name */}
              <text
                x={x + LABEL_OFFSET}
                y={y + 3}
                fill="#c0c0d0"
                fontSize="10"
                fontFamily="monospace"
              >
                {st.name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
