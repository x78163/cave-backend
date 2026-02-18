import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Component, Suspense, lazy } from 'react'
import TopBar from './components/TopBar'
import Home from './pages/Home'
import Explore from './pages/Explore'
import Expeditions from './pages/Expeditions'
import Feed from './pages/Feed'

// Lazy-load CaveDetail — it imports Three.js, Leaflet, TipTap (heavy)
const CaveDetail = lazy(() => import('./pages/CaveDetail'))

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

function App() {
  return (
    <Router>
      <ErrorBoundary>
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
              <Route path="/caves/:caveId" element={<CaveDetail />} />
              <Route path="/expeditions" element={<Expeditions />} />
              <Route path="/feed" element={<Feed />} />
            </Routes>
          </Suspense>
        </main>
      </ErrorBoundary>
    </Router>
  )
}

export default App
