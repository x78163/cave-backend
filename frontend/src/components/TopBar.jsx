import { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'
import useChatStore from '../stores/chatStore'
import AvatarDisplay from './AvatarDisplay'

const navItems = [
  { path: '/', label: 'Home' },
  { path: '/explore', label: 'Explore' },
  { path: '/groups', label: 'Groups' },
  { path: '/events', label: 'Events' },
  { path: '/chat', label: 'Chat' },
  { path: '/profile', label: 'Profile' },
]

export default function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const totalUnread = useChatStore(state => state.totalUnread)
  const fetchUnreadCount = useChatStore(state => state.fetchUnreadCount)
  const pollRef = useRef(null)

  // Poll unread count when NOT on chat page (WebSocket handles it when on chat)
  useEffect(() => {
    const onChat = location.pathname.startsWith('/chat')
    if (onChat) {
      clearInterval(pollRef.current)
      pollRef.current = null
      return
    }
    fetchUnreadCount()
    pollRef.current = setInterval(fetchUnreadCount, 60000)
    return () => clearInterval(pollRef.current)
  }, [location.pathname, fetchUnreadCount])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="cyber-topbar sticky top-0 z-50 px-6 py-3 flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2 no-underline">
        <img src="/cave-dragon-logo.png" alt="" className="h-[3.25rem] w-[3.25rem]" />
        <span className="text-lg font-bold" style={{ color: 'var(--cyber-cyan)' }}>
          Cave Dragon
        </span>
      </Link>

      <nav className="flex items-center gap-1">
        {navItems.map(item => {
          const active = item.path === '/chat'
            ? location.pathname.startsWith('/chat')
            : location.pathname === item.path
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`relative px-3 py-1.5 rounded-full text-sm font-medium no-underline transition-colors ${
                active
                  ? 'text-[var(--cyber-bg)] bg-[var(--cyber-cyan)]'
                  : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'
              }`}
            >
              {item.label}
              {item.path === '/chat' && totalUnread > 0 && (
                <span className="absolute -top-1 -right-1 chat-unread-badge">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* User menu */}
      <div className="flex items-center gap-3">
        <Link to="/profile" className="flex items-center gap-2 no-underline">
          <AvatarDisplay user={user} size="w-8 h-8" textSize="text-xs" />
          <span className="text-sm text-[var(--cyber-text-dim)] hidden sm:inline hover:text-[var(--cyber-cyan)] transition-colors">
            {user?.username}
          </span>
        </Link>
        <button
          onClick={handleLogout}
          className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-magenta)] transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  )
}
