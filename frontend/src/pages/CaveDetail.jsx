import { useNavigate, useParams } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { MarkdownHooks as Markdown } from 'react-markdown'
import RichTextEditor from '../components/RichTextEditor'
import SurfaceMap from '../components/SurfaceMap'
import CaveMapSection from '../components/CaveMapSection'
import CameraCapture from '../components/CameraCapture'
import CaveExplorer from '../components/CaveExplorer'
import StarRating from '../components/StarRating'
import { apiFetch } from '../hooks/useApi'

export default function CaveDetail() {
  const navigate = useNavigate()
  const { caveId } = useParams()
  const [cave, setCave] = useState(null)
  const [loading, setLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  // Description wiki editor state
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [savingDesc, setSavingDesc] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [revisions, setRevisions] = useState([])

  // Cave overlay on surface map
  const [overlayMapData, setOverlayMapData] = useState(null)
  const [overlayPois, setOverlayPois] = useState([])
  const [showOverlay, setShowOverlay] = useState(false)
  const [overlayLevel, setOverlayLevel] = useState(0)

  // Photo carousel state
  const [carouselOpen, setCarouselOpen] = useState(false)
  const [carouselIndex, setCarouselIndex] = useState(0)

  // Photo upload dialog state
  const [uploadDialog, setUploadDialog] = useState(null) // { file, preview }
  const [uploadCaption, setUploadCaption] = useState('')
  const [uploadTags, setUploadTags] = useState('')

  // Photo edit state
  const [editingPhoto, setEditingPhoto] = useState(null) // photo id
  const [editCaption, setEditCaption] = useState('')
  const [editTags, setEditTags] = useState('')
  const [savingPhotoEdit, setSavingPhotoEdit] = useState(false)

  // 3D Explorer
  const [showExplorer, setShowExplorer] = useState(false)

  // Ratings (cloud-specific)
  const [ratingsData, setRatingsData] = useState(null)
  const [newRating, setNewRating] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [submittingRating, setSubmittingRating] = useState(false)

  const fetchCave = () => {
    fetch(`/api/caves/${caveId}/`)
      .then(res => {
        if (!res.ok) throw new Error('Not found')
        return res.json()
      })
      .then(data => { setCave(data); setLoading(false) })
      .catch(() => { setLoading(false) })
  }

  const fetchRatings = () => {
    fetch(`/api/social/caves/${caveId}/ratings/`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setRatingsData(data) })
      .catch(() => {})
  }

  useEffect(() => { fetchCave(); fetchRatings() }, [caveId])

  // Fetch cave map data + POIs when overlay is toggled on
  useEffect(() => {
    if (!showOverlay || overlayMapData) return
    fetch(`/api/caves/${caveId}/map-data/`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setOverlayMapData(data) })
      .catch(() => {})
    fetch(`/api/mapping/caves/${caveId}/pois/`)
      .then(r => r.ok ? r.json() : { pois: [] })
      .then(data => setOverlayPois(data.pois || []))
      .catch(() => {})
  }, [showOverlay, caveId])

  /* --- Photo upload with dialog --- */
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const preview = URL.createObjectURL(file)
    setUploadDialog({ file, preview })
    setUploadCaption('')
    setUploadTags('')
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  const handlePhotoUpload = async () => {
    if (!uploadDialog) return
    setUploadingPhoto(true)
    const formData = new FormData()
    formData.append('image', uploadDialog.file)
    formData.append('caption', uploadCaption)
    formData.append('tags', uploadTags)
    try {
      const res = await fetch(`/api/caves/${caveId}/photos/`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        URL.revokeObjectURL(uploadDialog.preview)
        setUploadDialog(null)
        fetchCave()
      }
    } finally {
      setUploadingPhoto(false)
    }
  }

  const cancelUpload = () => {
    if (uploadDialog) URL.revokeObjectURL(uploadDialog.preview)
    setUploadDialog(null)
  }

  /* --- Photo edit (caption/tags) --- */
  const startEditPhoto = (photo) => {
    setEditingPhoto(photo.id)
    setEditCaption(photo.caption || '')
    setEditTags(photo.tags || '')
  }

  const savePhotoEdit = async (photoId) => {
    setSavingPhotoEdit(true)
    try {
      const res = await fetch(`/api/caves/${caveId}/photos/${photoId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: editCaption, tags: editTags }),
      })
      if (res.ok) {
        setEditingPhoto(null)
        fetchCave()
      }
    } finally {
      setSavingPhotoEdit(false)
    }
  }

  const deletePhoto = async (photoId) => {
    const res = await fetch(`/api/caves/${caveId}/photos/${photoId}/`, {
      method: 'DELETE',
    })
    if (res.ok) {
      setCarouselOpen(false)
      setEditingPhoto(null)
      fetchCave()
    }
  }

  /* --- Comments --- */
  const handleAddComment = async () => {
    if (!newComment.trim()) return
    setSubmittingComment(true)
    try {
      const res = await fetch(`/api/caves/${caveId}/comments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newComment }),
      })
      if (res.ok) { setNewComment(''); fetchCave() }
    } finally {
      setSubmittingComment(false)
    }
  }

  /* --- Description wiki --- */
  const startEditDesc = () => {
    setDescDraft(cave.description || '')
    setEditSummary('')
    setEditingDesc(true)
  }

  const saveDescription = async () => {
    setSavingDesc(true)
    try {
      const res = await fetch(`/api/caves/${caveId}/description/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: descDraft,
          edit_summary: editSummary || 'Updated description',
        }),
      })
      if (res.ok) {
        setEditingDesc(false)
        fetchCave()
      }
    } finally {
      setSavingDesc(false)
    }
  }

  const fetchHistory = async () => {
    const res = await fetch(`/api/caves/${caveId}/description/`)
    if (res.ok) {
      const data = await res.json()
      setRevisions(data.revisions || [])
      setShowHistory(true)
    }
  }

  /* --- Ratings (cloud-specific) --- */
  const handleSubmitRating = async () => {
    if (!newRating) return
    setSubmittingRating(true)
    try {
      await apiFetch(`/social/caves/${caveId}/ratings/`, {
        method: 'POST',
        body: JSON.stringify({
          rating: newRating,
          review_text: reviewText,
          user: 1,
        }),
      })
      setNewRating(0)
      setReviewText('')
      fetchRatings()
    } catch (err) {
      console.error('Rating submit failed:', err)
    } finally {
      setSubmittingRating(false)
    }
  }

  /* --- Carousel navigation --- */
  const photos = cave?.photos || []
  const openCarousel = (idx) => {
    setCarouselIndex(idx)
    setEditingPhoto(null)
    setCarouselOpen(true)
  }
  const prevPhoto = () => setCarouselIndex(i => (i - 1 + photos.length) % photos.length)
  const nextPhoto = () => setCarouselIndex(i => (i + 1) % photos.length)

  // Touch swipe support for carousel
  const touchStartX = useRef(null)
  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX }
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) > 50) {
      dx > 0 ? prevPhoto() : nextPhoto()
    }
    touchStartX.current = null
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--cyber-bg)]">
        <p className="text-[var(--cyber-text-dim)]">Loading cave profile...</p>
      </div>
    )
  }

  if (!cave) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--cyber-bg)]">
        <p className="text-[var(--cyber-text-dim)] text-lg">Cave not found</p>
        <button onClick={() => navigate('/explore')}
          className="mt-4 text-[var(--cyber-cyan)] hover:underline">
          Back to Explore
        </button>
      </div>
    )
  }

  const hasLocation = cave.latitude != null && cave.longitude != null
  const currentPhoto = photos[carouselIndex]

  return (
    <div className="flex flex-col min-h-screen bg-[var(--cyber-bg)]">
      {/* Top bar */}
      <div className="cyber-topbar flex items-center justify-between px-4 py-3">
        <button onClick={() => navigate('/explore')}
          className="text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] px-3 py-1 transition-colors">
          &larr; Back
        </button>
        <h2 className="text-white font-semibold truncate max-w-[50%]">{cave.name}</h2>
        <div className="px-3 py-1" /> {/* spacer */}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Hero / Cover area */}
        <div className="relative bg-gradient-to-b from-cyan-900/20 to-[var(--cyber-bg)] px-4 pt-6 pb-4">
          <h1 className="text-2xl font-bold text-white mb-1">{cave.name}</h1>
          {cave.region && (
            <p className="text-[var(--cyber-text-dim)] text-sm">
              {cave.region}{cave.country ? `, ${cave.country}` : ''}
            </p>
          )}
          {hasLocation && (
            <p className="text-[#555570] text-xs mt-1">
              {cave.latitude.toFixed(4)}, {cave.longitude.toFixed(4)}
            </p>
          )}

          {/* Rating summary */}
          {ratingsData && ratingsData.rating_count > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <StarRating value={Math.round(ratingsData.average_rating)} size="text-sm" />
              <span className="text-[var(--cyber-text-dim)] text-sm">
                {Number(ratingsData.average_rating).toFixed(1)} ({ratingsData.rating_count})
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 mt-4">
            {hasLocation && (
              <button
                disabled
                className="flex-1 py-3 rounded-full font-semibold text-sm text-center transition-all
                  bg-gradient-to-r from-purple-600 to-purple-700 text-white
                  shadow-[0_0_15px_rgba(178,75,255,0.2)] active:scale-[0.97]"
              >
                Find this Cave
              </button>
            )}

            {cave.has_map ? (
              <button
                onClick={() => setShowExplorer(!showExplorer)}
                className={`flex-1 py-3 rounded-full font-semibold text-sm text-center transition-all
                  ${showExplorer
                    ? 'bg-[var(--cyber-surface-2)] text-[var(--cyber-cyan)] border border-cyan-700/50'
                    : 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-[0_0_15px_rgba(0,229,255,0.2)] active:scale-[0.97]'}`}
              >
                {showExplorer ? 'Close 3D Explorer' : 'Explore this Cave'}
              </button>
            ) : (
              <span className="flex-1 py-3 rounded-full font-semibold text-sm text-center
                bg-gradient-to-r from-amber-600 to-amber-700 text-white
                shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                Not Yet Mapped
              </span>
            )}

            <span
              className={`inline-flex items-center justify-center px-4 py-3 rounded-full text-sm font-medium
                ${cave.visibility === 'public'
                  ? 'bg-cyan-900/30 text-[var(--cyber-cyan)] border border-cyan-800/30'
                  : cave.visibility === 'limited_public'
                    ? 'bg-amber-900/30 text-amber-400 border border-amber-800/30'
                    : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]'}`}
            >
              {cave.visibility === 'public' ? 'Public' : cave.visibility === 'limited_public' ? 'Limited' : 'Private'}
            </span>
          </div>
        </div>

        {/* 3D Explorer embed */}
        {showExplorer && (
          <div className="px-4 pb-3">
            <div className="rounded-2xl overflow-hidden border border-[var(--cyber-border)]"
              style={{ height: '500px' }}>
              <CaveExplorer caveId={caveId} />
            </div>
          </div>
        )}

        {/* Stats bar */}
        <div className="px-4 py-3 border-t border-b border-[var(--cyber-border)]">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Length" value={cave.total_length ? `${cave.total_length}m` : '\u2014'} />
            <Stat label="Levels" value={cave.number_of_levels || '\u2014'} />
            <Stat label="Hazards" value={cave.hazard_count || '0'} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center mt-2">
            <Stat label="Largest Space" value={cave.largest_chamber ? `${cave.largest_chamber}m\u00B2` : '\u2014'} />
            <Stat label="Tightest" value={cave.smallest_passage ? `${cave.smallest_passage}m` : '\u2014'} />
            <Stat label="Depth" value={cave.vertical_extent ? `${cave.vertical_extent}m` : '\u2014'} />
          </div>
        </div>

        {/* Condition badges */}
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {cave.has_map ? (
            <Badge color="cyan" text="Mapped" />
          ) : (
            <Badge color="gray" text="Not Yet Mapped" />
          )}
          {cave.toxic_gas_present && (
            <Badge color="red" text={`Toxic Gas: ${cave.toxic_gas_types || 'Yes'}`} />
          )}
          {cave.water_present && (
            <Badge color="blue" text={cave.water_description || 'Water Present'} />
          )}
          {cave.max_particulate && cave.max_particulate > 35 && (
            <Badge color="amber" text={`PM2.5: ${cave.max_particulate}`} />
          )}
          {cave.requires_equipment && (
            <Badge color="gray" text="Special Equipment" />
          )}
        </div>

        {/* Cave Map (interactive 2D) */}
        {cave.has_map && (
          <CaveMapSection caveId={caveId} />
        )}

        {/* Equipment note */}
        {cave.requires_equipment && (
          <div className="px-4 pb-3">
            <div className="rounded-2xl bg-amber-900/20 border border-amber-800/30 p-3">
              <p className="text-amber-300 text-xs font-semibold mb-1">Required Equipment</p>
              <p className="text-[var(--cyber-text)] text-sm">{cave.requires_equipment}</p>
            </div>
          </div>
        )}

        {/* Description - Wiki style with markdown */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white font-semibold">Description</h3>
            <div className="flex gap-2">
              {cave.revision_count > 0 && (
                <button onClick={fetchHistory}
                  className="text-[#555570] text-xs hover:text-[var(--cyber-text-dim)]">
                  History ({cave.revision_count})
                </button>
              )}
              {!editingDesc && (
                <button onClick={startEditDesc}
                  className="text-[var(--cyber-cyan)] text-sm hover:underline">
                  Edit
                </button>
              )}
            </div>
          </div>

          {editingDesc ? (
            /* Rich text wiki editor */
            <div className="space-y-2">
              <RichTextEditor
                content={descDraft}
                onChange={setDescDraft}
                placeholder="Write your description... Use the toolbar to add headings, images, links, and formatting."
                caveId={caveId}
              />
              <input
                value={editSummary}
                onChange={e => setEditSummary(e.target.value)}
                placeholder="Edit summary (e.g. Added geology section)"
                className="cyber-input w-full px-4 py-2 text-sm"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditingDesc(false)}
                  className="px-5 py-2 rounded-full text-sm text-[var(--cyber-text-dim)]
                    bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                    hover:border-[var(--cyber-text-dim)] transition-colors">
                  Cancel
                </button>
                <button onClick={saveDescription} disabled={savingDesc}
                  className="px-5 py-2 rounded-full text-sm font-semibold
                    bg-gradient-to-r from-cyan-600 to-cyan-700 text-white
                    shadow-[0_0_12px_rgba(0,229,255,0.2)]">
                  {savingDesc ? 'Saving...' : 'Save Revision'}
                </button>
              </div>
            </div>
          ) : cave.description ? (
            /* Rendered markdown */
            <div className="prose-cave rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] p-4">
              <Markdown>{cave.description}</Markdown>
            </div>
          ) : (
            <div className="rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] py-6 text-center">
              <p className="text-[var(--cyber-text-dim)] text-sm mb-2">No description yet</p>
              <button onClick={startEditDesc}
                className="text-[var(--cyber-cyan)] text-sm hover:underline">
                Write the first description
              </button>
            </div>
          )}
        </div>

        {/* Revision history modal */}
        {showHistory && (
          <div className="px-4 pb-3">
            <div className="rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-white font-semibold text-sm">Revision History</h4>
                <button onClick={() => setShowHistory(false)}
                  className="text-[var(--cyber-text-dim)] text-xs hover:text-white">Close</button>
              </div>
              {revisions.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {revisions.map(rev => (
                    <div key={rev.id}
                      className="flex items-center justify-between py-2 border-b border-[var(--cyber-border)] last:border-0">
                      <div>
                        <span className="text-[var(--cyber-text)] text-sm">Rev {rev.revision_number}</span>
                        <span className="text-[var(--cyber-text-dim)] text-xs ml-2">{rev.edit_summary}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[var(--cyber-text-dim)] text-xs block">{rev.editor_name}</span>
                        <span className="text-[#555570] text-xs">
                          {new Date(rev.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--cyber-text-dim)] text-sm">No revision history</p>
              )}
            </div>
          </div>
        )}

        {/* Surface map */}
        {hasLocation && (
          <div className="px-4 py-3">
            {cave.has_map && (
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setShowOverlay(v => !v)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all
                    ${showOverlay
                      ? 'bg-cyan-900/40 text-[var(--cyber-cyan)] border border-cyan-700/50'
                      : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]'}`}
                >
                  {showOverlay ? 'Hide Underground' : 'Show Underground'}
                </button>
                {showOverlay && overlayMapData && (overlayMapData.levels || []).length > 1 && (
                  <div className="flex gap-1">
                    {overlayMapData.levels.map(l => (
                      <button key={l.index}
                        onClick={() => setOverlayLevel(l.index)}
                        className={`px-2 py-1 rounded-full text-xs transition-all
                          ${overlayLevel === l.index
                            ? 'bg-cyan-900/40 text-[var(--cyber-cyan)] border border-cyan-700/50'
                            : 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border border-[var(--cyber-border)]'}`}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <SurfaceMap
              center={[cave.latitude, cave.longitude]}
              markers={[{ lat: cave.latitude, lon: cave.longitude, label: cave.name }]}
              zoom={14}
              height={showOverlay ? '16rem' : '12rem'}
              className="border border-[var(--cyber-border)]"
              caveMapData={overlayMapData}
              cavePois={overlayPois}
              caveHeading={cave.slam_heading || 0}
              caveOverlayVisible={showOverlay}
              caveOverlayLevel={overlayLevel}
            />
          </div>
        )}

        {/* Photos section */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white font-semibold">Photos ({cave.photo_count})</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCameraOpen(true)}
                className="text-[var(--cyber-cyan)] text-sm hover:underline"
              >
                Take Photo
              </button>
              <label className={`text-[var(--cyber-text-dim)] text-sm cursor-pointer hover:underline
                ${uploadingPhoto ? 'opacity-50' : ''}`}>
                {uploadingPhoto ? 'Uploading...' : 'Upload'}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="hidden"
                  disabled={uploadingPhoto}
                />
              </label>
            </div>
          </div>
          {photos.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {photos.map((photo, idx) => (
                <div key={photo.id} className="flex-shrink-0 relative group">
                  <button onClick={() => openCarousel(idx)} className="block">
                    <img src={photo.image} alt={photo.caption}
                      className="w-28 h-28 rounded-2xl object-cover border border-[var(--cyber-border)]
                        hover:border-[var(--cyber-cyan)] transition-colors" />
                  </button>
                  {photo.caption && (
                    <p className="text-[#555570] text-xs mt-1 truncate w-28">{photo.caption}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] py-8 text-center">
              <p className="text-[var(--cyber-text-dim)] text-sm">No photos yet</p>
            </div>
          )}
        </div>

        {/* Ratings section (cloud-specific) */}
        <div className="px-4 py-3">
          <h3 className="text-white font-semibold mb-3">
            Ratings
            {ratingsData?.rating_count > 0 && (
              <span className="text-sm font-normal text-[var(--cyber-text-dim)] ml-2">
                &#x2605; {Number(ratingsData.average_rating).toFixed(1)} ({ratingsData.rating_count})
              </span>
            )}
          </h3>

          {/* Submit rating */}
          <div className="rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] p-4 mb-4">
            <p className="text-sm mb-2 text-[var(--cyber-text-dim)]">Leave a rating:</p>
            <StarRating value={newRating} onChange={setNewRating} />
            <textarea
              className="cyber-textarea w-full mt-3 px-3 py-2 text-sm"
              rows={2}
              placeholder="Write a review (optional)..."
              value={reviewText}
              onChange={e => setReviewText(e.target.value)}
            />
            <button
              className={`mt-2 px-5 py-2 rounded-full text-sm font-semibold transition-all
                ${newRating
                  ? 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                  : 'bg-[var(--cyber-surface-2)] text-[#555570]'}`}
              disabled={!newRating || submittingRating}
              onClick={handleSubmitRating}
            >
              {submittingRating ? 'Submitting...' : 'Submit Rating'}
            </button>
          </div>

          {/* Existing ratings */}
          {ratingsData?.ratings?.length > 0 && (
            <div className="space-y-3">
              {ratingsData.ratings.map(r => (
                <div key={r.id} className="rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <StarRating value={r.rating} size="text-sm" />
                    <span className="text-[#555570] text-xs">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {r.review_text && (
                    <p className="text-[var(--cyber-text-dim)] text-sm mt-1">{r.review_text}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comments section */}
        <div className="px-4 py-3">
          <h3 className="text-white font-semibold mb-3">Comments ({cave.comment_count})</h3>

          <div className="flex gap-2 mb-4">
            <input
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              className="cyber-input flex-1 px-4 py-2.5 text-sm"
              onKeyDown={e => e.key === 'Enter' && handleAddComment()}
            />
            <button
              onClick={handleAddComment}
              disabled={!newComment.trim() || submittingComment}
              className={`px-5 rounded-full text-sm font-semibold transition-all
                ${newComment.trim()
                  ? 'bg-gradient-to-r from-cyan-600 to-cyan-700 text-white shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                  : 'bg-[var(--cyber-surface-2)] text-[#555570]'}`}
            >
              Post
            </button>
          </div>

          {cave.comments && cave.comments.length > 0 ? (
            <div className="space-y-3">
              {cave.comments.map(comment => (
                <div key={comment.id} className="rounded-2xl bg-[var(--cyber-surface)] border border-[var(--cyber-border)] p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[var(--cyber-text)] text-sm font-medium">{comment.author_name}</span>
                    <span className="text-[#555570] text-xs">
                      {new Date(comment.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-[var(--cyber-text-dim)] text-sm">{comment.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-[#555570] text-sm">No comments yet. Be the first!</p>
            </div>
          )}
        </div>

        <div className="h-8" />
      </div>

      {/* ====== PHOTO UPLOAD DIALOG ====== */}
      {uploadDialog && (
        <div className="carousel-overlay flex items-center justify-center p-4">
          <div className="bg-[var(--cyber-surface)] border border-[var(--cyber-border)] rounded-2xl
            w-full max-w-md p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">Upload Photo</h3>
              <button onClick={cancelUpload} className="text-[var(--cyber-text-dim)] hover:text-white text-lg">
                &times;
              </button>
            </div>

            <img src={uploadDialog.preview} alt="Preview"
              className="w-full h-48 object-cover rounded-xl border border-[var(--cyber-border)]" />

            <div>
              <label className="block text-[var(--cyber-text-dim)] text-sm mb-1">Caption</label>
              <input
                value={uploadCaption}
                onChange={e => setUploadCaption(e.target.value)}
                placeholder="Describe this photo..."
                className="cyber-input w-full px-4 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-[var(--cyber-text-dim)] text-sm mb-1">Tags</label>
              <input
                value={uploadTags}
                onChange={e => setUploadTags(e.target.value)}
                placeholder="e.g. entrance, formation, crystal"
                className="cyber-input w-full px-4 py-2.5 text-sm"
              />
              <p className="text-[#555570] text-xs mt-1">Separate tags with commas</p>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={cancelUpload}
                className="px-5 py-2 rounded-full text-sm text-[var(--cyber-text-dim)]
                  bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]
                  hover:border-[var(--cyber-text-dim)] transition-colors">
                Cancel
              </button>
              <button onClick={handlePhotoUpload} disabled={uploadingPhoto}
                className="px-5 py-2 rounded-full text-sm font-semibold
                  bg-gradient-to-r from-cyan-600 to-cyan-700 text-white
                  shadow-[0_0_12px_rgba(0,229,255,0.2)]">
                {uploadingPhoto ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== CAMERA CAPTURE ====== */}
      {cameraOpen && (
        <CameraCapture
          onCapture={(blob, source) => {
            const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' })
            const preview = URL.createObjectURL(blob)
            setUploadDialog({ file, preview })
            setUploadCaption('')
            setUploadTags('')
            setCameraOpen(false)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* ====== PHOTO CAROUSEL ====== */}
      {carouselOpen && currentPhoto && (
        <div className="carousel-overlay flex flex-col"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Carousel top bar */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
            <button onClick={() => setCarouselOpen(false)}
              className="text-[var(--cyber-text-dim)] hover:text-white text-sm">
              &larr; Close
            </button>
            <span className="text-[var(--cyber-text-dim)] text-sm">
              {carouselIndex + 1} / {photos.length}
            </span>
            <div className="flex gap-2">
              <button onClick={() => startEditPhoto(currentPhoto)}
                className="text-[var(--cyber-cyan)] text-sm hover:underline">
                Edit
              </button>
              <button onClick={() => deletePhoto(currentPhoto.id)}
                className="text-red-400 text-sm hover:underline">
                Delete
              </button>
            </div>
          </div>

          {/* Image display */}
          <div className="flex-1 flex items-center justify-center relative px-4 min-h-0">
            {photos.length > 1 && (
              <button onClick={prevPhoto}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full
                  bg-black/50 text-white flex items-center justify-center
                  hover:bg-[var(--cyber-cyan)]/20 transition-colors z-10">
                &#x2039;
              </button>
            )}

            <img
              src={currentPhoto.image}
              alt={currentPhoto.caption}
              className="max-w-full max-h-full object-contain rounded-xl"
            />

            {photos.length > 1 && (
              <button onClick={nextPhoto}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full
                  bg-black/50 text-white flex items-center justify-center
                  hover:bg-[var(--cyber-cyan)]/20 transition-colors z-10">
                &#x203A;
              </button>
            )}
          </div>

          {/* Photo info / edit panel */}
          <div className="flex-shrink-0 px-4 py-3 bg-[var(--cyber-surface)] border-t border-[var(--cyber-border)]">
            {editingPhoto === currentPhoto.id ? (
              <div className="space-y-2">
                <input
                  value={editCaption}
                  onChange={e => setEditCaption(e.target.value)}
                  placeholder="Caption..."
                  className="cyber-input w-full px-4 py-2 text-sm"
                />
                <input
                  value={editTags}
                  onChange={e => setEditTags(e.target.value)}
                  placeholder="Tags (comma-separated)..."
                  className="cyber-input w-full px-4 py-2 text-sm"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditingPhoto(null)}
                    className="px-4 py-1.5 rounded-full text-sm text-[var(--cyber-text-dim)]
                      bg-[var(--cyber-surface-2)] border border-[var(--cyber-border)]">
                    Cancel
                  </button>
                  <button onClick={() => savePhotoEdit(currentPhoto.id)} disabled={savingPhotoEdit}
                    className="px-4 py-1.5 rounded-full text-sm font-semibold
                      bg-gradient-to-r from-cyan-600 to-cyan-700 text-white">
                    {savingPhotoEdit ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {currentPhoto.caption && (
                  <p className="text-white text-sm mb-1">{currentPhoto.caption}</p>
                )}
                {currentPhoto.tags && (
                  <div className="flex flex-wrap gap-1.5">
                    {currentPhoto.tags.split(',').map((tag, i) => (
                      tag.trim() && (
                        <span key={i} className="inline-block px-2.5 py-0.5 rounded-full text-xs
                          bg-[var(--cyber-surface-2)] text-[var(--cyber-cyan)] border border-[rgba(0,229,255,0.2)]">
                          {tag.trim()}
                        </span>
                      )
                    ))}
                  </div>
                )}
                {!currentPhoto.caption && !currentPhoto.tags && (
                  <p className="text-[#555570] text-sm">No caption or tags</p>
                )}
              </div>
            )}
          </div>

          {/* Thumbnail strip */}
          {photos.length > 1 && (
            <div className="flex-shrink-0 px-4 py-2 bg-[var(--cyber-surface)] border-t border-[var(--cyber-border)]">
              <div className="flex gap-2 overflow-x-auto justify-center">
                {photos.map((p, idx) => (
                  <button key={p.id} onClick={() => { setCarouselIndex(idx); setEditingPhoto(null) }}>
                    <img src={p.image} alt=""
                      className={`w-12 h-12 rounded-lg object-cover flex-shrink-0 border-2 transition-colors
                        ${idx === carouselIndex
                          ? 'border-[var(--cyber-cyan)] shadow-[0_0_8px_rgba(0,229,255,0.3)]'
                          : 'border-transparent opacity-50'}`} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-white font-semibold text-sm">{value}</div>
      <div className="text-[var(--cyber-text-dim)] text-xs">{label}</div>
    </div>
  )
}

function Badge({ color, text }) {
  const colors = {
    cyan: 'bg-cyan-900/30 text-[var(--cyber-cyan)] border-cyan-800/30',
    red: 'bg-red-900/30 text-red-400 border-red-800/30',
    amber: 'bg-amber-900/30 text-amber-400 border-amber-800/30',
    blue: 'bg-blue-900/30 text-blue-400 border-blue-800/30',
    gray: 'bg-[var(--cyber-surface-2)] text-[var(--cyber-text-dim)] border-[var(--cyber-border)]',
  }
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs border ${colors[color]}`}>
      {text}
    </span>
  )
}
