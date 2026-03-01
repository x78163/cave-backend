import { useEffect, useRef, useState } from 'react'
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
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

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

  const navLink = (item) => {
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
  }

  return (
    <header className="cyber-topbar sticky top-0 z-50">
      <div className="px-4 md:px-6 py-3 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 no-underline shrink-0">
          <img src="/cave-dragon-logo.png" alt="" className="h-10 w-10 md:h-[3.25rem] md:w-[3.25rem]" />
          <span className="text-base md:text-lg font-bold" style={{ color: 'var(--cyber-cyan)' }}>
            Cave Dragon
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map(navLink)}
        </nav>

        {/* Desktop user menu */}
        <div className="hidden md:flex items-center gap-3">
          <Link to="/profile" className="flex items-center gap-2 no-underline">
            <AvatarDisplay user={user} size="w-8 h-8" textSize="text-xs" />
            <span className="text-sm text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)] transition-colors">
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

        {/* Mobile: unread badge + hamburger */}
        <div className="flex md:hidden items-center gap-2">
          {totalUnread > 0 && (
            <Link to="/chat" className="no-underline">
              <span className="chat-unread-badge text-xs">{totalUnread > 99 ? '99+' : totalUnread}</span>
            </Link>
          )}
          <button
            className="flex flex-col gap-1 p-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span className={`block w-5 h-0.5 bg-[var(--cyber-cyan)] transition-transform duration-200 ${mobileOpen ? 'rotate-45 translate-y-[3px]' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[var(--cyber-cyan)] transition-opacity duration-200 ${mobileOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[var(--cyber-cyan)] transition-transform duration-200 ${mobileOpen ? '-rotate-45 -translate-y-[3px]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--cyber-border)] px-4 py-3 space-y-1" style={{ background: 'var(--cyber-surface)' }}>
          {navItems.map(navLink)}
          <div className="pt-2 mt-2 border-t border-[var(--cyber-border)] flex items-center justify-between">
            <Link to="/profile" className="flex items-center gap-2 no-underline">
              <AvatarDisplay user={user} size="w-7 h-7" textSize="text-xs" />
              <span className="text-sm text-[var(--cyber-text-dim)]">{user?.username}</span>
            </Link>
            <button
              onClick={handleLogout}
              className="text-xs text-[var(--cyber-text-dim)] hover:text-[var(--cyber-magenta)] transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
