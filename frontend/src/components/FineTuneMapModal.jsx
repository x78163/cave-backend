import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  BASE_LAYERS, getLayerById,
  create3DEPHillshadeLayer, HILLSHADE_OVERLAY,
} from '../utils/mapLayers'

// Cyan marker for picked location
const pickIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
  <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="#00e5ff" stroke="#0a0a12" stroke-width="2"/>
  <circle cx="14" cy="14" r="6" fill="#0a0a12"/>
</svg>`

const pickIcon = L.divIcon({
  html: pickIconSvg,
  className: 'cave-marker',
  iconSize: [28, 40],
  iconAnchor: [14, 40],
})

/**
 * Modal with a Leaflet map for click-to-pick coordinate fine-tuning.
 * Satellite + 3DEP LiDAR hillshade enabled by default.
 */
export default function FineTuneMapModal({ initialLat, initialLon, onConfirm, onClose }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const tileRef = useRef(null)
  const hillshadeRef = useRef(null)

  const [picked, setPicked] = useState(null)
  const [activeLayerId, setActiveLayerId] = useState('esri_imagery')
  const [hillshadeOn, setHillshadeOn] = useState(true)
  const [layerMenuOpen, setLayerMenuOpen] = useState(false)

  const hasInitial = initialLat != null && initialLon != null

  useEffect(() => {
    if (!containerRef.current) return

    const center = hasInitial ? [initialLat, initialLon] : [37.5, -96.0]
    const zoom = hasInitial ? 17 : 5

    const map = L.map(containerRef.current, {
      center,
      zoom,
      maxZoom: 21,
      zoomControl: true,
      attributionControl: true,
    })
    mapRef.current = map

    // Satellite base layer
    const layerConfig = getLayerById('esri_imagery')
    const tile = L.tileLayer(layerConfig.url, {
      ...layerConfig.options,
      attribution: layerConfig.attribution,
    }).addTo(map)
    tileRef.current = tile
    const tilePane = map.getPane('tilePane')
    if (tilePane) tilePane.style.filter = layerConfig.filter || ''

    // 3DEP hillshade on by default
    const hs = create3DEPHillshadeLayer(L)
    hillshadeRef.current = hs
    hs.addTo(map)

    // Initial marker at current coords
    if (hasInitial) {
      const m = L.marker(center, { icon: pickIcon }).addTo(map)
      markerRef.current = m
    }

    // Click handler
    map.on('click', (e) => {
      const { lat, lng } = e.latlng
      setPicked({ lat, lon: lng })
      if (markerRef.current) {
        markerRef.current.setLatLng(e.latlng)
      } else {
        markerRef.current = L.marker(e.latlng, { icon: pickIcon }).addTo(map)
      }
    })

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const switchLayer = (id) => {
    const map = mapRef.current
    if (!map) return
    const config = getLayerById(id)
    const tilePane = map.getPane('tilePane')
    if (tilePane) tilePane.style.filter = config.filter || ''
    if (tileRef.current) map.removeLayer(tileRef.current)
    const tile = L.tileLayer(config.url, {
      ...config.options,
      attribution: config.attribution,
    }).addTo(map)
    tile.bringToBack()
    tileRef.current = tile
    setActiveLayerId(id)
    setLayerMenuOpen(false)
  }

  const toggleHillshade = () => {
    const map = mapRef.current
    const hs = hillshadeRef.current
    if (!map || !hs) return
    if (hillshadeOn) {
      map.removeLayer(hs)
    } else {
      hs.addTo(map)
    }
    setHillshadeOn(!hillshadeOn)
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center px-4"
      style={{ background: 'rgba(10, 10, 18, 0.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="cyber-card w-full max-w-2xl p-5 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-white font-semibold text-sm">Fine Tune Location</h3>
        <p className="text-[var(--cyber-text-dim)] text-xs">
          Click on the map to place the cave entrance precisely.
        </p>

        {/* Map container */}
        <div className="relative">
          <div
            ref={containerRef}
            className="rounded-lg overflow-hidden"
            style={{ height: '400px', width: '100%', cursor: 'crosshair' }}
          />

          {/* Layer switcher */}
          <div className="absolute top-3 left-12 z-[2100]">
            <button
              onClick={() => setLayerMenuOpen(v => !v)}
              className="px-2.5 py-1.5 rounded-full text-xs font-medium transition-all shadow-lg
                bg-[#0a0a12]/80 text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]
                backdrop-blur-sm hover:text-[var(--cyber-cyan)] hover:border-cyan-700/50"
            >
              <span className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0L0 4l8 4 8-4L8 0z" opacity="0.9"/>
                  <path d="M0 8l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M0 12l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                {getLayerById(activeLayerId).label}
              </span>
            </button>
            {layerMenuOpen && (
              <div className="mt-1 rounded-lg bg-[#0a0a12]/95 border border-[var(--cyber-border)]
                backdrop-blur-sm shadow-xl overflow-hidden min-w-[120px]">
                {BASE_LAYERS.map(layer => (
                  <button
                    key={layer.id}
                    onClick={() => switchLayer(layer.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors
                      hover:bg-[var(--cyber-surface-2)]
                      ${activeLayerId === layer.id
                        ? 'text-[var(--cyber-cyan)]'
                        : 'text-[var(--cyber-text-dim)]'
                      }`}
                  >
                    {layer.label}
                  </button>
                ))}
                <div className="border-t border-[var(--cyber-border)]">
                  <button
                    onClick={toggleHillshade}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2
                      hover:bg-[var(--cyber-surface-2)]
                      ${hillshadeOn ? 'text-[var(--cyber-cyan)]' : 'text-[var(--cyber-text-dim)]'}`}
                  >
                    <span className={`inline-block w-3 h-3 rounded-sm border transition-colors
                      ${hillshadeOn
                        ? 'bg-[var(--cyber-cyan)] border-[var(--cyber-cyan)]'
                        : 'border-[var(--cyber-border)]'
                      }`}
                    >
                      {hillshadeOn && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#0a0a12" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    {HILLSHADE_OVERLAY.label}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Picked coordinates */}
        {picked && (
          <p className="text-emerald-400 text-xs font-mono">
            {picked.lat.toFixed(6)}, {picked.lon.toFixed(6)}
          </p>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-xs font-semibold
              bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)]
              border border-[var(--cyber-border)] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => picked && onConfirm(picked)}
            disabled={!picked}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all
              ${picked
                ? 'bg-[var(--cyber-cyan)]/20 text-[var(--cyber-cyan)] border border-cyan-700/50 hover:bg-[var(--cyber-cyan)]/30'
                : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)] opacity-50 cursor-not-allowed'
              }`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
