import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, error, clearError } = useAuthStore()
  const navigate = useNavigate()

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
            Sign in to continue
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
