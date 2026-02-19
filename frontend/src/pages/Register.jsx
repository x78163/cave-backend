import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

// Matches Django's UnicodeUsernameValidator: letters, digits, and _ . @ + -
const USERNAME_RE = /^[\w.@+-]+$/

function validateUsername(value) {
  if (!value) return null
  if (value.length < 3) return { ok: false, msg: 'Must be at least 3 characters' }
  if (value.length > 150) return { ok: false, msg: 'Must be 150 characters or fewer' }
  if (!USERNAME_RE.test(value))
    return { ok: false, msg: 'Only letters, numbers, and _ . @ + - are allowed' }
  return { ok: true, msg: 'Looks good' }
}

function validatePassword(value) {
  if (!value) return null
  if (value.length < 8) return { ok: false, msg: `${8 - value.length} more character${8 - value.length === 1 ? '' : 's'} needed` }
  return { ok: true, msg: 'Meets minimum length' }
}

function FieldHint({ result }) {
  if (!result) return null
  return (
    <p className="text-xs mt-1" style={{ color: result.ok ? '#22c55e' : '#fbbf24' }}>
      {result.ok ? '\u2713' : '\u26A0'} {result.msg}
    </p>
  )
}

export default function Register() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const { register, error, clearError } = useAuthStore()
  const navigate = useNavigate()

  const usernameResult = useMemo(() => validateUsername(username), [username])
  const passwordResult = useMemo(() => validatePassword(password), [password])
  const confirmResult = useMemo(() => {
    if (!passwordConfirm) return null
    if (password !== passwordConfirm) return { ok: false, msg: 'Passwords do not match' }
    return { ok: true, msg: 'Passwords match' }
  }, [password, passwordConfirm])

  const clientValid = usernameResult?.ok && passwordResult?.ok &&
    confirmResult?.ok && email.length > 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!clientValid) return
    setLoading(true)
    try {
      await register(username, email, password, passwordConfirm)
      navigate('/')
    } catch {
      // error is set in store
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cyber-bg)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">
            <span style={{ color: 'var(--cyber-cyan)' }}>&#9672;</span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--cyber-cyan)' }}>
            Cave Mapper
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--cyber-text-dim)' }}>
            Create your account
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="cyber-card p-6 space-y-4">
          {error && (
            <div className="text-sm text-center py-2 px-3 rounded-lg"
              style={{ background: 'rgba(255,0,200,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,0,200,0.2)' }}>
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); clearError() }}
              className="cyber-input w-full px-4 py-2.5 text-sm"
              placeholder="Letters, numbers, _ . @ + -"
              autoComplete="username"
              required
            />
            <FieldHint result={usernameResult} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError() }}
              className="cyber-input w-full px-4 py-2.5 text-sm"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearError() }}
              className="cyber-input w-full px-4 py-2.5 text-sm"
              placeholder="Min 8 characters"
              autoComplete="new-password"
              required
            />
            <FieldHint result={passwordResult} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
              Confirm Password
            </label>
            <input
              type="password"
              value={passwordConfirm}
              onChange={(e) => { setPasswordConfirm(e.target.value); clearError() }}
              className="cyber-input w-full px-4 py-2.5 text-sm"
              placeholder="Repeat password"
              autoComplete="new-password"
              required
            />
            <FieldHint result={confirmResult} />
          </div>

          <button
            type="submit"
            disabled={loading || !clientValid}
            className="cyber-btn cyber-btn-cyan w-full py-2.5 text-sm disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>

          <p className="text-center text-sm" style={{ color: 'var(--cyber-text-dim)' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: 'var(--cyber-cyan)' }} className="hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
