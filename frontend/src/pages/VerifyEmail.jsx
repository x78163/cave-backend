import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [status, setStatus] = useState('verifying') // verifying | success | error
  const [errorMsg, setErrorMsg] = useState('')
  const { verifyEmail } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('No verification token provided.')
      return
    }

    verifyEmail(token)
      .then(() => {
        setStatus('success')
        setTimeout(() => navigate('/'), 2000)
      })
      .catch((err) => {
        setStatus('error')
        setErrorMsg(err.message || 'Verification failed')
      })
  }, [token])

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cyber-bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/cave-dragon-logo.png" alt="Cave Dragon" className="w-48 h-48 mx-auto mb-2" />
        </div>

        <div className="cyber-card p-6 text-center space-y-4">
          {status === 'verifying' && (
            <p className="text-sm" style={{ color: 'var(--cyber-text-dim)' }}>
              Verifying your email...
            </p>
          )}

          {status === 'success' && (
            <>
              <h2 className="text-lg font-bold" style={{ color: 'var(--cyber-cyan)' }}>
                Email Verified!
              </h2>
              <p className="text-sm" style={{ color: 'var(--cyber-text)' }}>
                Your account is now active. Redirecting...
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <h2 className="text-lg font-bold" style={{ color: '#ff6b6b' }}>
                Verification Failed
              </h2>
              <p className="text-sm" style={{ color: 'var(--cyber-text-dim)' }}>
                {errorMsg}
              </p>
              <Link
                to="/login"
                className="inline-block mt-4 cyber-btn cyber-btn-cyan px-6 py-2 text-sm"
              >
                Back to Login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
