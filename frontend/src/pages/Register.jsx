import { useState, useMemo, useEffect, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import useAuthStore from '../stores/authStore'
import api from '../services/api'

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
  const [searchParams] = useSearchParams()
  const isGoogleFlow = searchParams.get('google') === '1'
  const [inviteCode, setInviteCode] = useState(searchParams.get('code') || '')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [requireInviteCode, setRequireInviteCode] = useState(true)
  const [verificationSent, setVerificationSent] = useState(false)
  const { register, googleAuth, error, clearError } = useAuthStore()
  const navigate = useNavigate()

  // Fetch site settings to know if invite code is required
  useEffect(() => {
    api.get('/users/site-settings/')
      .then(({ data }) => setRequireInviteCode(data.require_invite_code))
      .catch(() => {})
  }, [])

  // Google flow: user was redirected here because they need an invite code
  const handleGoogleWithCode = useCallback(async () => {
    const code = sessionStorage.getItem('google_auth_code')
    const redirectUri = sessionStorage.getItem('google_redirect_uri')
    if (!code || !redirectUri) {
      navigate('/login')
      return
    }
    setLoading(true)
    clearError()
    try {
      const result = await googleAuth(code, inviteCode, redirectUri)
      if (result?.needsInviteCode) return // still need code
      sessionStorage.removeItem('google_auth_code')
      sessionStorage.removeItem('google_redirect_uri')
      navigate('/')
    } catch {
      // error in store
    } finally {
      setLoading(false)
    }
  }, [googleAuth, inviteCode, navigate, clearError])

  const usernameResult = useMemo(() => validateUsername(username), [username])
  const passwordResult = useMemo(() => validatePassword(password), [password])
  const confirmResult = useMemo(() => {
    if (!passwordConfirm) return null
    if (password !== passwordConfirm) return { ok: false, msg: 'Passwords do not match' }
    return { ok: true, msg: 'Passwords match' }
  }, [password, passwordConfirm])

  const clientValid = isGoogleFlow
    ? inviteCode.length > 0
    : usernameResult?.ok && passwordResult?.ok && confirmResult?.ok &&
      email.length > 0 && (!requireInviteCode || inviteCode.length > 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!clientValid) return

    if (isGoogleFlow) {
      handleGoogleWithCode()
      return
    }

    setLoading(true)
    try {
      const result = await register(username, email, password, passwordConfirm, inviteCode)
      if (result?.emailVerificationRequired) {
        setVerificationSent(true)
        return
      }
      navigate('/')
    } catch {
      // error is set in store
    } finally {
      setLoading(false)
    }
  }

  // Show verification sent screen
  if (verificationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cyber-bg)' }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="/cave-dragon-logo.png" alt="Cave Dragon" className="w-48 h-48 mx-auto mb-2" />
            <h1 className="text-2xl font-bold" style={{ color: 'var(--cyber-cyan)' }}>
              Check Your Email
            </h1>
          </div>
          <div className="cyber-card p-6 text-center space-y-4">
            <p className="text-sm" style={{ color: 'var(--cyber-text)' }}>
              We sent a verification link to <strong style={{ color: 'var(--cyber-cyan)' }}>{email}</strong>.
            </p>
            <p className="text-sm" style={{ color: 'var(--cyber-text-dim)' }}>
              Click the link in the email to verify your account and start exploring.
            </p>
            <p className="text-center text-sm" style={{ color: 'var(--cyber-text-dim)' }}>
              Already verified?{' '}
              <Link to="/login" style={{ color: 'var(--cyber-cyan)' }} className="hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Google invite code flow
  if (isGoogleFlow) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cyber-bg)' }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="/cave-dragon-logo.png" alt="Cave Dragon" className="w-48 h-48 mx-auto mb-2" />
            <h1 className="text-2xl font-bold" style={{ color: 'var(--cyber-cyan)' }}>
              Almost There
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--cyber-text-dim)' }}>
              Enter your invite code to complete sign-up
            </p>
          </div>
          <form onSubmit={handleSubmit} className="cyber-card p-6 space-y-4">
            {error && (
              <div className="text-sm text-center py-2 px-3 rounded-lg"
                style={{ background: 'rgba(255,0,200,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,0,200,0.2)' }}>
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
                Invite Code
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => { setInviteCode(e.target.value.toUpperCase()); clearError() }}
                className="cyber-input w-full px-4 py-2.5 text-sm font-mono tracking-widest"
                placeholder="XXXXXXXX"
                maxLength={8}
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={loading || !inviteCode}
              className="cyber-btn cyber-btn-cyan w-full py-2.5 text-sm disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Complete Sign Up'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cyber-bg)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/cave-dragon-logo.png" alt="Cave Dragon" className="w-48 h-48 mx-auto mb-2" />
          <h1 className="text-2xl font-bold" style={{ color: 'var(--cyber-cyan)' }}>
            Cave Dragon
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

          {requireInviteCode && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
                Invite Code
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => { setInviteCode(e.target.value.toUpperCase()); clearError() }}
                className="cyber-input w-full px-4 py-2.5 text-sm font-mono tracking-widest"
                placeholder="XXXXXXXX"
                maxLength={8}
                required
              />
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
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearError() }}
                className="cyber-input w-full px-4 py-2.5 pr-10 text-sm"
                placeholder="Min 8 characters"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            <FieldHint result={passwordResult} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--cyber-text-dim)' }}>
              Confirm Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordConfirm}
                onChange={(e) => { setPasswordConfirm(e.target.value); clearError() }}
                className="cyber-input w-full px-4 py-2.5 pr-10 text-sm"
                placeholder="Repeat password"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
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
