import { Link, useLocation } from 'react-router-dom'

const navItems = [
  { path: '/', label: 'Home' },
  { path: '/explore', label: 'Explore' },
  { path: '/expeditions', label: 'Expeditions' },
  { path: '/feed', label: 'Feed' },
  { path: '/profile', label: 'Profile' },
]

export default function TopBar() {
  const location = useLocation()

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
    </header>
  )
}
