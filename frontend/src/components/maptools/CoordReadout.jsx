import { useState, useEffect } from 'react'

/**
 * Always-visible cursor lat/lon readout at bottom-center of map.
 * Hidden on mobile (no persistent cursor) and on mouse leave.
 */
export default function CoordReadout({ map }) {
  const [coords, setCoords] = useState(null)

  useEffect(() => {
    if (!map) return
    const onMove = (e) => setCoords(e.latlng)
    const container = map.getContainer()
    const onOut = () => setCoords(null)
    map.on('mousemove', onMove)
    container.addEventListener('mouseleave', onOut)
    return () => {
      map.off('mousemove', onMove)
      container.removeEventListener('mouseleave', onOut)
    }
  }, [map])

  if (!coords) return null

  return (
    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-[1100]
      px-2 py-0.5 rounded-full text-[10px] font-mono
      bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
      backdrop-blur-sm pointer-events-none select-none hidden sm:block">
      {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
    </div>
  )
}
