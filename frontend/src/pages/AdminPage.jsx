import { Navigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'
import AdminDashboard from '../components/admin/AdminDashboard'

export default function AdminPage() {
  const { user } = useAuthStore()

  if (!user?.is_staff) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold mb-6" style={{ color: 'var(--cyber-cyan)' }}>
        Admin Dashboard
      </h1>
      <AdminDashboard />
    </div>
  )
}
