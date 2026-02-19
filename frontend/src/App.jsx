import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react'
import TopBar from './components/TopBar'
import OnboardingModal from './components/OnboardingModal'
import Home from './pages/Home'
import Explore from './pages/Explore'
import Expeditions from './pages/Expeditions'
import Feed from './pages/Feed'
import Groups from './pages/Groups'
import Login from './pages/Login'
import Register from './pages/Register'
import useAuthStore from './stores/authStore'

// Lazy-load heavy pages — they import Three.js, Leaflet, TipTap, etc.
const CaveDetail = lazy(() => import('./pages/CaveDetail'))
const CreateCave = lazy(() => import('./pages/CreateCave'))
const Profile = lazy(() => import('./pages/Profile'))

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '2rem', background: '#0a0a12', color: '#ff6b6b',
          minHeight: '100vh', fontFamily: 'monospace',
        }}>
          <h2 style={{ color: '#ff6b6b', marginBottom: '1rem' }}>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#e0e0f0', fontSize: '0.85rem' }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#8888aa', fontSize: '0.75rem', marginTop: '1rem' }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.href = '/' }}
            style={{
              marginTop: '1.5rem', padding: '0.5rem 1.5rem', borderRadius: '9999px',
              background: 'linear-gradient(135deg, #00b8d4, #00e5ff)', color: '#0a0a12',
              border: 'none', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Back to Home
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--cyber-bg)' }}>
        <p style={{ color: 'var(--cyber-text-dim)' }}>Loading...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children
}

function AppContent() {
  const { initAuth, user, isAuthenticated } = useAuthStore()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const onboardingDismissed = useRef(false)

  useEffect(() => {
    initAuth()
  }, [initAuth])

  useEffect(() => {
    if (
      isAuthenticated && user &&
      user.onboarding_complete === false &&
      !onboardingDismissed.current &&
      !showOnboarding
    ) {
      setShowOnboarding(true)
    }
  }, [isAuthenticated, user, showOnboarding])

  const handleOnboardingComplete = () => {
    onboardingDismissed.current = true
    setShowOnboarding(false)
  }

  return (
    <>
      {showOnboarding && (
        <OnboardingModal onComplete={handleOnboardingComplete} />
      )}
      <Routes>
        {/* Public routes — no TopBar */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected routes — with TopBar */}
        <Route path="/*" element={
          <ProtectedRoute>
            <TopBar />
          <main className="flex-1">
            <Suspense fallback={
              <div className="flex items-center justify-center min-h-screen bg-[var(--cyber-bg)]">
                <p className="text-[var(--cyber-text-dim)]">Loading...</p>
              </div>
            }>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/explore" element={<Explore />} />
                <Route path="/caves/new" element={<CreateCave />} />
                <Route path="/caves/:caveId" element={<CaveDetail />} />
                <Route path="/caves/:caveId/edit" element={<CreateCave />} />
                <Route path="/expeditions" element={<Expeditions />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/groups" element={<Groups />} />
                <Route path="/groups/:grottoId" element={<Groups />} />
                <Route path="/profile" element={<Profile />} />
              </Routes>
            </Suspense>
          </main>
        </ProtectedRoute>
      } />
    </Routes>
    </>
  )
}

function App() {
  return (
    <Router>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </Router>
  )
}

export default App
