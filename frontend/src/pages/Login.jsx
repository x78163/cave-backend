import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendStatus, setResendStatus] = useState(null)
  const {
    login, googleAuth, resendVerification,
    error, clearError, emailVerificationRequired, unverifiedEmail,
  } = useAuthStore()
  const navigate = useNavigate()

  // Load Google Identity Services script
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId) return

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCallback,
      })
      window.google?.accounts.id.renderButton(
        document.getElementById('google-signin-btn'),
        {
          theme: 'filled_black',
          size: 'large',
          width: '100%',
          text: 'signin_with',
          shape: 'rectangular',
        }
      )
    }
    document.head.appendChild(script)
    return () => { document.head.removeChild(script) }
  }, [])

  const handleGoogleCallback = useCallback(async (response) => {
    setLoading(true)
    clearError()
    try {
      const result = await googleAuth(response.credential)
      if (result?.needsInviteCode) {
        // Redirect to register with the Google credential
        sessionStorage.setItem('google_credential', response.credential)
        navigate('/register?google=1')
        return
      }
      navigate('/')
    } catch {
      // error set in store
    } finally {
      setLoading(false)
    }
  }, [googleAuth, navigate, clearError])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(username, password)
      navigate('/')
    } catch {
      // error is set in store
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!unverifiedEmail) return
    setResendStatus('sending')
    try {
      await resendVerification(unverifiedEmail)
      setResendStatus('sent')
    } catch {
      setResendStatus('error')
    }
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
            Sign in to continue
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="cyber-card p-6 space-y-4">
          {error && (
            <div className="text-sm text-center py-2 px-3 rounded-lg"
              style={{ background: 'rgba(255,0,200,0.1)', color: '#ff6b6b', border: '1px solid rgba(255,0,200,0.2)' }}>
              {error}
              {emailVerificationRequired && unverifiedEmail && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendStatus === 'sending'}
                    className="text-xs underline"
                    style={{ color: 'var(--cyber-cyan)' }}
                  >
                    {resendStatus === 'sent' ? 'Verification email sent!' :
                     resendStatus === 'sending' ? 'Sending...' :
                     'Resend verification email'}
                  </button>
                </div>
              )}
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
              placeholder="Enter username"
              autoComplete="username"
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
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="cyber-btn cyber-btn-cyan w-full py-2.5 text-sm disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          {/* Google Sign-In */}
          {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
            <>
              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px" style={{ background: 'var(--cyber-border)' }} />
                <span className="text-xs" style={{ color: 'var(--cyber-text-dim)' }}>or</span>
                <div className="flex-1 h-px" style={{ background: 'var(--cyber-border)' }} />
              </div>
              <div id="google-signin-btn" className="flex justify-center" />
            </>
          )}

          <p className="text-center text-sm" style={{ color: 'var(--cyber-text-dim)' }}>
            No account?{' '}
            <Link to="/register" style={{ color: 'var(--cyber-cyan)' }} className="hover:underline">
              Register
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
