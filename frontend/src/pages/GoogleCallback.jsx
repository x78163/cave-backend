import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

export default function GoogleCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { googleAuth, error } = useAuthStore()
  const [processing, setProcessing] = useState(true)

  useEffect(() => {
    const code = searchParams.get('code')
    const errParam = searchParams.get('error')

    if (errParam) {
      navigate('/login')
      return
    }

    if (!code) {
      navigate('/login')
      return
    }

    const redirectUri = `${window.location.origin}/auth/google/callback`

    googleAuth(code, null, redirectUri)
      .then((result) => {
        if (result?.needsInviteCode) {
          sessionStorage.setItem('google_auth_code', code)
          sessionStorage.setItem('google_redirect_uri', redirectUri)
          navigate('/register?google=1')
        } else {
          navigate('/')
        }
      })
      .catch(() => {
        setProcessing(false)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!processing && error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cyber-bg)' }}>
        <div className="cyber-card p-6 max-w-sm text-center">
          <p className="text-sm mb-4" style={{ color: '#ff6b6b' }}>{error}</p>
          <button
            onClick={() => navigate('/login')}
            className="cyber-btn cyber-btn-cyan px-6 py-2 text-sm"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--cyber-bg)' }}>
      <p style={{ color: 'var(--cyber-text-dim)' }}>Signing in with Google...</p>
    </div>
  )
}
