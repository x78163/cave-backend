import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * CameraCapture — reusable camera viewfinder and capture overlay.
 *
 * Props:
 *   onCapture(blob, source) — called with JPEG blob and source string ('webcam' | 'upload')
 *   onClose()               — dismiss the overlay
 */
export default function CameraCapture({ onCapture, onClose }) {
  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [stream, setStream] = useState(null)
  const [error, setError] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const [initializing, setInitializing] = useState(true)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  // Initialize camera
  useEffect(() => {
    let cancelled = false

    const init = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera API not available on this device')
        setInitializing(false)
        return
      }

      try {
        const initialStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })

        if (cancelled) {
          initialStream.getTracks().forEach(t => t.stop())
          return
        }

        streamRef.current = initialStream
        setStream(initialStream)
        setError(null)
        setInitializing(false)
        if (videoRef.current) {
          videoRef.current.srcObject = initialStream
        }

        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = allDevices.filter(d => d.kind === 'videoinput')
        if (!cancelled) {
          setDevices(videoDevices)
          const activeTrack = initialStream.getVideoTracks()[0]
          const activeSettings = activeTrack?.getSettings()
          const activeId = activeSettings?.deviceId || ''
          setSelectedDevice(activeId)
        }
      } catch (err) {
        if (!cancelled) {
          setInitializing(false)
          if (err.name === 'NotAllowedError') {
            setError('Camera permission denied. Use "Upload File" instead.')
          } else if (err.name === 'NotReadableError') {
            setError('Camera in use by another application')
          } else if (err.name === 'NotFoundError') {
            setError('No camera found on this device')
          } else {
            setError(`Could not access camera: ${err.message}`)
          }
        }
      }
    }

    init()
    return () => { cancelled = true }
  }, [])

  // Switch camera
  const switchCamera = useCallback(async (deviceId) => {
    if (!deviceId) return
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
    }
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = newStream
      setStream(newStream)
      setError(null)
      if (videoRef.current) {
        videoRef.current.srcObject = newStream
      }
    } catch {
      setError('Could not switch camera')
    }
  }, [])

  const handleDeviceChange = (e) => {
    const deviceId = e.target.value
    setSelectedDevice(deviceId)
    switchCamera(deviceId)
  }

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  // Capture from webcam
  const captureWebcam = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)

    setCapturing(true)
    canvas.toBlob(
      (blob) => {
        setCapturing(false)
        if (blob) {
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop())
            streamRef.current = null
          }
          onCapture(blob, 'webcam')
        }
      },
      'image/jpeg',
      0.9
    )
  }, [onCapture])

  // File upload fallback
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      onCapture(file, 'upload')
    }
  }

  const handleClose = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[2000] bg-[#0a0a12]/95 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--cyber-border)]">
        <label className="text-[var(--cyber-text-dim)] hover:text-white px-3 py-2 transition-colors
          cursor-pointer text-sm border border-[var(--cyber-border)] rounded-full">
          Upload File
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </label>

        <span className="text-white text-sm font-semibold">Take Photo</span>

        <button
          onClick={handleClose}
          className="w-10 h-10 flex items-center justify-center rounded-full
            border border-[var(--cyber-cyan)] text-[var(--cyber-cyan)]
            hover:bg-[var(--cyber-cyan)] hover:text-[#0a0a12]
            active:scale-90 transition-all text-xl font-bold"
        >
          &#x2715;
        </button>
      </div>

      {/* Viewfinder */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <div className="camera-viewfinder w-full max-w-lg">
          {devices.length > 1 && (
            <select
              value={selectedDevice || ''}
              onChange={handleDeviceChange}
              className="w-full mb-3 px-3 py-2 rounded-lg bg-[var(--cyber-surface)] border border-[var(--cyber-border)]
                text-white text-sm"
            >
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          )}

          {initializing ? (
            <div className="aspect-video rounded-xl bg-[var(--cyber-surface)] flex items-center justify-center">
              <p className="text-[var(--cyber-text-dim)] text-sm">Starting camera...</p>
            </div>
          ) : error ? (
            <div className="aspect-video rounded-xl bg-[var(--cyber-surface)] flex flex-col items-center justify-center gap-3">
              <div className="text-4xl opacity-30">&#x1F4F7;</div>
              <p className="text-[var(--cyber-text-dim)] text-sm text-center px-4">{error}</p>
              <label className="mt-2 px-4 py-2 rounded-full bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                text-[var(--cyber-cyan)] text-sm cursor-pointer hover:border-[var(--cyber-cyan)] transition-colors">
                Upload from File
                <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
              </label>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-xl bg-black"
            />
          )}
        </div>
      </div>

      {/* Capture button */}
      <div className="pb-8 pt-4 flex justify-center">
        <button
          onClick={captureWebcam}
          disabled={capturing || !!error || initializing}
          className="capture-btn w-18 h-18 rounded-full border-4 border-white/80 bg-transparent
            flex items-center justify-center active:scale-90 transition-transform
            disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className={`w-14 h-14 rounded-full bg-white ${capturing ? 'scale-75' : ''} transition-transform`} />
        </button>
      </div>

      {/* Hidden canvas for webcam capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
