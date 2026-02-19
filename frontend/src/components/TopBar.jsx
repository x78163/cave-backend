import { Link, useLocation, useNavigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'
import AvatarDisplay from './AvatarDisplay'

const navItems = [
  { path: '/', label: 'Home' },
  { path: '/explore', label: 'Explore' },
  { path: '/groups', label: 'Groups' },
  { path: '/expeditions', label: 'Expeditions' },
  { path: '/profile', label: 'Profile' },
]

export default function TopBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="cyber-topbar sticky top-0 z-50 px-6 py-3 flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2 no-underline">
        <span className="text-lg font-bold" style={{ color: 'var(--cyber-cyan)' }}>
          Cave Backend
        </span>
      </Link>

      <nav className="flex items-center gap-1">
        {navItems.map(item => {
          const active = location.pathname === item.path
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`px-3 py-1.5 rounded-full text-sm font-medium no-underline transition-colors ${
                active
                  ? 'text-[var(--cyber-bg)] bg-[var(--cyber-cyan)]'
                  : 'text-[var(--cyber-text-dim)] hover:text-[var(--cyber-cyan)]'
              }`}
            >
              {item.label}
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
