import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react'
import TopBar from './components/TopBar'
import OnboardingModal from './components/OnboardingModal'
import ExpeditionAlertModal from './components/ExpeditionAlertModal'
import Home from './pages/Home'
import Explore from './pages/Explore'
import Events from './pages/Events'
import Feed from './pages/Feed'
import Groups from './pages/Groups'
import Login from './pages/Login'
import Register from './pages/Register'
import VerifyEmail from './pages/VerifyEmail'
import GoogleCallback from './pages/GoogleCallback'
import useAuthStore from './stores/authStore'
import chatSocket from './services/chatSocket'
import useChatStore from './stores/chatStore'
import useExpeditionStore from './stores/expeditionStore'

// Lazy-load heavy pages — they import Three.js, Leaflet, TipTap, etc.
const CaveDetail = lazy(() => import('./pages/CaveDetail'))
const CreateCave = lazy(() => import('./pages/CreateCave'))
const Profile = lazy(() => import('./pages/Profile'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'))
const EventDetail = lazy(() => import('./pages/EventDetail'))
const PointCloudEditor = lazy(() => import('./pages/PointCloudEditor'))
const WikiPage = lazy(() => import('./pages/WikiPage'))
const WikiArticle = lazy(() => import('./pages/WikiArticle'))
const WikiEditor = lazy(() => import('./pages/WikiEditor'))
const WikiHistory = lazy(() => import('./pages/WikiHistory'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

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

/**
 * Global WebSocket connection — connects once when authenticated,
 * routes messages to chat store and expedition alert store.
 */
function GlobalWebSocket() {
  const { user } = useAuthStore()

  useEffect(() => {
    if (!user) return

    chatSocket.connect()

    const unsub = chatSocket.subscribe((data) => {
      const chatStore = useChatStore.getState()

      if (data.type === 'connected') {
        chatStore.fetchChannels()
      } else if (data.type === 'typing') {
        chatStore.handleTypingEvent(data)
      } else if (data.type === 'reaction_update') {
        chatStore.handleReactionUpdate(data, user?.id)
      } else if (data.type === 'member_update') {
        chatStore.fetchChannels()
      } else if (data.type === 'message_edit') {
        chatStore.handleMessageEdit(data)
      } else if (data.type === 'message_delete') {
        chatStore.handleMessageDelete(data)
      } else if (data.type === 'message_pin') {
        chatStore.handleMessagePin(data)
      } else if (data.type === 'notification') {
        chatStore.handleNotification(data)
      } else if (data.type === 'expedition_state_change') {
        chatStore.handleExpeditionStateChange(data)
        // Push blocking alert for important state transitions
        const alertStates = ['active', 'overdue', 'alert_sent', 'emergency_sent', 'completed', 'resolved']
        if (alertStates.includes(data.state)) {
          useExpeditionStore.getState().pushAlert(data)
        }
      } else if (data.type === 'expedition_surrogate_added') {
        chatStore.handleExpeditionStateChange(data)
        useExpeditionStore.getState().pushAlert(data)
      } else if (data.id && data.channel_id) {
        chatStore.handleIncomingMessage(data)
      }
    })

    return () => {
      unsub()
      chatSocket.disconnect()
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
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
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/auth/google/callback" element={<GoogleCallback />} />

        {/* Protected routes — with TopBar */}
        <Route path="/*" element={
          <ProtectedRoute>
            <GlobalWebSocket />
            <ExpeditionAlertModal />
            <TopBar />
          <main className="flex-1 min-w-0 overflow-x-hidden">
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
                <Route path="/caves/:caveId/editor" element={<PointCloudEditor />} />
                <Route path="/events" element={<Events />} />
                <Route path="/events/:eventId" element={<EventDetail />} />
                <Route path="/expeditions" element={<Navigate to="/events" replace />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/grottos" element={<Groups />} />
                <Route path="/grottos/:grottoId" element={<Groups />} />
                <Route path="/groups" element={<Navigate to="/grottos" replace />} />
                <Route path="/groups/:grottoId" element={<Navigate to="/grottos" replace />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/chat/:channelId" element={<ChatPage />} />
                <Route path="/wiki" element={<WikiPage />} />
                <Route path="/wiki/new" element={<WikiEditor />} />
                <Route path="/wiki/category/:categorySlug" element={<WikiPage />} />
                <Route path="/wiki/:slug/edit" element={<WikiEditor />} />
                <Route path="/wiki/:slug/history" element={<WikiHistory />} />
                <Route path="/wiki/:slug" element={<WikiArticle />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/users/:userId" element={<UserProfilePage />} />
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
