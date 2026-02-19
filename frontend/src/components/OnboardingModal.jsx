import { useState } from 'react'
import api from '../services/api'
import useAuthStore from '../stores/authStore'
import { SPECIALTIES, AVATAR_PRESETS } from '../constants/profileOptions'

const STEPS = ['Welcome', 'Avatar', 'About You', 'Specialties']

export default function OnboardingModal({ onComplete }) {
  const { user, fetchMe } = useAuthStore()
  const [step, setStep] = useState(0)
  const [avatarPreset, setAvatarPreset] = useState('')
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [selectedSpecialties, setSelectedSpecialties] = useState([])
  const [saving, setSaving] = useState(false)

  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setAvatarFile(file)
      setAvatarPreset('')
      setAvatarPreview(URL.createObjectURL(file))
    }
  }

  const handlePresetSelect = (key) => {
    setAvatarPreset(key)
    setAvatarFile(null)
    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview)
      setAvatarPreview(null)
    }
  }

  const toggleSpecialty = (specialty) => {
    setSelectedSpecialties(prev =>
      prev.includes(specialty)
        ? prev.filter(s => s !== specialty)
        : prev.length < 10 ? [...prev, specialty] : prev
    )
  }

  const handleSubmit = async () => {
    setSaving(true)
    try {
      const formData = new FormData()
      if (firstName) formData.append('first_name', firstName)
      if (lastName) formData.append('last_name', lastName)
      if (bio) formData.append('bio', bio)
      if (location) formData.append('location', location)
      if (avatarFile) formData.append('avatar', avatarFile)
      formData.append('avatar_preset', avatarPreset)
      formData.append('specialties', JSON.stringify(selectedSpecialties))
      formData.append('onboarding_complete', 'true')

      await api.patch('/users/me/', formData)
      await fetchMe()
      onComplete()
    } catch (err) {
      console.error('Onboarding save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleSkip = async () => {
    try {
      await api.patch('/users/me/', { onboarding_complete: true })
      await fetchMe()
    } catch { /* close anyway */ }
    onComplete()
  }

  const selectedPreset = AVATAR_PRESETS.find(p => p.key === avatarPreset)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(10, 10, 18, 0.92)', backdropFilter: 'blur(8px)' }}
    >
      <div className="cyber-card w-full max-w-md p-6">
        {/* Step indicators */}
        <div className="flex justify-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === step ? 32 : 16,
                background: i <= step ? 'var(--cyber-cyan)' : 'var(--cyber-surface-2)',
              }}
            />
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="text-center">
            <div className="text-5xl mb-4">{'\uD83D\uDC09'}</div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--cyber-cyan)' }}>
              Welcome to Cave Dragon!
            </h2>
            <p className="text-sm mb-1" style={{ color: 'var(--cyber-text)' }}>
              Hey <strong>{user?.username}</strong>, let's set up your profile.
            </p>
            <p className="text-xs mb-6" style={{ color: 'var(--cyber-text-dim)' }}>
              This only takes a minute. You can always edit later.
            </p>
          </div>
        )}

        {/* Step 1: Avatar */}
        {step === 1 && (
          <div>
            <h2 className="text-lg font-bold mb-1 text-center" style={{ color: 'var(--cyber-cyan)' }}>
              Choose Your Avatar
            </h2>
            <p className="text-xs text-center mb-5" style={{ color: 'var(--cyber-text-dim)' }}>
              Pick an icon or upload a photo
            </p>

            {/* Current selection preview */}
            <div className="flex justify-center mb-5">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-3xl"
                style={{ background: 'var(--cyber-surface)', border: '2px solid var(--cyber-cyan)' }}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="preview" className="w-full h-full rounded-full object-cover" />
                ) : selectedPreset ? (
                  selectedPreset.emoji
                ) : (
                  <span style={{ color: 'var(--cyber-text-dim)' }}>?</span>
                )}
              </div>
            </div>

            {/* Preset grid */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {AVATAR_PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handlePresetSelect(p.key)}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg transition-colors"
                  style={{
                    background: avatarPreset === p.key ? 'var(--cyber-surface-2)' : 'transparent',
                    border: avatarPreset === p.key ? '1px solid var(--cyber-cyan)' : '1px solid transparent',
                  }}
                >
                  <span className="text-2xl">{p.emoji}</span>
                  <span className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>{p.label}</span>
                </button>
              ))}
            </div>

            {/* Upload option */}
            <label className="cyber-btn cyber-btn-ghost w-full py-2 text-xs cursor-pointer text-center block">
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
              {avatarFile ? avatarFile.name : 'Upload Photo'}
            </label>
          </div>
        )}

        {/* Step 2: About You */}
        {step === 2 && (
          <div>
            <h2 className="text-lg font-bold mb-1 text-center" style={{ color: 'var(--cyber-cyan)' }}>
              Tell Us About Yourself
            </h2>
            <p className="text-xs text-center mb-5" style={{ color: 'var(--cyber-text-dim)' }}>
              All fields are optional
            </p>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
                    First Name
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="cyber-input w-full px-3 py-2 text-sm"
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="cyber-input w-full px-3 py-2 text-sm"
                    placeholder="Last name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
                  Bio
                </label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  rows={3}
                  className="cyber-textarea w-full px-3 py-2 text-sm resize-none"
                  placeholder="A little about yourself..."
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
                  Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className="cyber-input w-full px-3 py-2 text-sm"
                  placeholder="City, Country (e.g. Ljubljana, Slovenia)"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Specialties */}
        {step === 3 && (
          <div>
            <h2 className="text-lg font-bold mb-1 text-center" style={{ color: 'var(--cyber-cyan)' }}>
              Your Specialties
            </h2>
            <p className="text-xs text-center mb-5" style={{ color: 'var(--cyber-text-dim)' }}>
              Select up to 10 that describe you
            </p>

            <div className="flex flex-wrap gap-2 justify-center">
              {SPECIALTIES.map(s => {
                const active = selectedSpecialties.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSpecialty(s)}
                    className="cyber-badge px-3 py-1.5 text-xs cursor-pointer transition-colors"
                    style={{
                      borderColor: active ? 'var(--cyber-cyan)' : 'var(--cyber-border)',
                      color: active ? 'var(--cyber-cyan)' : 'var(--cyber-text-dim)',
                      background: active ? 'rgba(0, 255, 255, 0.08)' : 'transparent',
                    }}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
            {selectedSpecialties.length > 0 && (
              <p className="text-xs text-center mt-3" style={{ color: 'var(--cyber-text-dim)' }}>
                {selectedSpecialties.length} selected
              </p>
            )}
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-6">
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs transition-colors"
            style={{ color: 'var(--cyber-text-dim)' }}
          >
            Skip
          </button>

          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(s => s - 1)}
                className="cyber-btn cyber-btn-ghost px-4 py-2 text-sm"
              >
                Back
              </button>
            )}

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(s => s + 1)}
                className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="cyber-btn cyber-btn-cyan px-4 py-2 text-sm disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Complete'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
