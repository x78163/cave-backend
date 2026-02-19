import { AVATAR_PRESETS } from '../constants/profileOptions'

export default function AvatarDisplay({ user, size = 'w-10 h-10', textSize = 'text-sm' }) {
  const avatarUrl = user?.avatar
  const preset = AVATAR_PRESETS.find(p => p.key === user?.avatar_preset)
  const initials = (user?.username || '??')
    .split('_').map(w => w[0]?.toUpperCase()).join('').slice(0, 2)

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={user?.username}
        className={`${size} rounded-full object-cover`}
        style={{ border: '2px solid var(--cyber-cyan)' }}
      />
    )
  }

  if (preset) {
    return (
      <div
        className={`${size} rounded-full flex items-center justify-center ${textSize}`}
        style={{ background: 'var(--cyber-surface)', border: '2px solid var(--cyber-cyan)' }}
      >
        {preset.emoji}
      </div>
    )
  }

  return (
    <div
      className={`${size} rounded-full flex items-center justify-center ${textSize} font-bold`}
      style={{ background: 'var(--cyber-surface)', color: 'var(--cyber-cyan)', border: '2px solid var(--cyber-cyan)' }}
    >
      {initials}
    </div>
  )
}
