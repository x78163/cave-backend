import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '../../hooks/useApi'
import AvatarDisplay from '../AvatarDisplay'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    username: '', email: '', password: '',
    first_name: '', last_name: '',
    is_staff: false, is_wiki_editor: false,
  })
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  const handleCreate = async () => {
    if (!form.username.trim()) return alert('Username is required')
    setSaving(true)
    try {
      const data = await apiFetch('/admin/users/create/', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setResult(data)
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="cyber-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--cyber-cyan)' }}>Create User</h3>

        {result ? (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--cyber-green, #00ff88)' }}>
              User <strong>{result.username}</strong> created successfully.
            </p>
            <div className="p-3 rounded" style={{ background: 'var(--cyber-surface)', border: '1px solid var(--cyber-green, #00ff88)' }}>
              <span className="text-[10px] block mb-1" style={{ color: 'var(--cyber-text-dim)' }}>TEMPORARY PASSWORD</span>
              <code className="text-sm font-mono" style={{ color: 'var(--cyber-green, #00ff88)' }}>{result.temporary_password}</code>
            </div>
            <p className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>Save this password — it will not be shown again.</p>
            <div className="flex justify-end">
              <button className="cyber-btn px-4 py-1.5 text-xs" onClick={() => { onCreated(); onClose() }}>Done</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {['username', 'email', 'password', 'first_name', 'last_name'].map(field => (
              <label key={field} className="block">
                <span className="text-[10px] uppercase" style={{ color: 'var(--cyber-text-dim)' }}>{field.replace('_', ' ')}</span>
                <input
                  className="cyber-input w-full mt-0.5 text-sm"
                  type={field === 'password' ? 'password' : 'text'}
                  value={form[field]}
                  onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  placeholder={field === 'password' ? 'Leave blank to auto-generate' : ''}
                />
              </label>
            ))}
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={form.is_staff}
                  onChange={e => setForm(f => ({ ...f, is_staff: e.target.checked }))}
                  className="accent-[var(--cyber-cyan)]" />
                <span style={{ color: 'var(--cyber-text)' }}>Staff</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={form.is_wiki_editor}
                  onChange={e => setForm(f => ({ ...f, is_wiki_editor: e.target.checked }))}
                  className="accent-[var(--cyber-cyan)]" />
                <span style={{ color: 'var(--cyber-text)' }}>Wiki Editor</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="cyber-btn cyber-btn-ghost px-4 py-1.5 text-xs" onClick={onClose}>Cancel</button>
              <button className="cyber-btn px-4 py-1.5 text-xs" onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function UserEditModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    username: user.username,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    is_staff: user.is_staff,
    is_active: user.is_active,
    is_wiki_editor: user.is_wiki_editor,
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiFetch(`/admin/users/${user.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      onSaved()
      onClose()
    } catch (e) {
      alert('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="cyber-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--cyber-cyan)' }}>Edit User: {user.username}</h3>

        <div className="space-y-3">
          {['username', 'email', 'first_name', 'last_name'].map(field => (
            <label key={field} className="block">
              <span className="text-[10px] uppercase" style={{ color: 'var(--cyber-text-dim)' }}>{field.replace('_', ' ')}</span>
              <input
                className="cyber-input w-full mt-0.5 text-sm"
                value={form[field]}
                onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
              />
            </label>
          ))}

          <div className="flex flex-wrap gap-4 pt-2">
            {[
              { key: 'is_staff', label: 'Staff' },
              { key: 'is_active', label: 'Active' },
              { key: 'is_wiki_editor', label: 'Wiki Editor' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--cyber-text)' }}>
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                  className="accent-[var(--cyber-cyan)]"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button className="cyber-btn cyber-btn-ghost px-4 py-1.5 text-xs" onClick={onClose}>Cancel</button>
          <button className="cyber-btn px-4 py-1.5 text-xs" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordModal({ user, onClose }) {
  const [password, setPassword] = useState('')
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)

  const handleReset = async () => {
    setSaving(true)
    try {
      const data = await apiFetch(`/admin/users/${user.id}/reset-password/`, {
        method: 'POST',
        body: JSON.stringify(password ? { password } : {}),
      })
      setResult(data.temporary_password)
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="cyber-card p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--cyber-cyan)' }}>Reset Password: {user.username}</h3>

        {result ? (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--cyber-text-dim)' }}>New password:</p>
            <div className="cyber-input p-2 text-sm font-mono select-all" style={{ color: 'var(--cyber-green, #00ff88)' }}>
              {result}
            </div>
            <p className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>Share this securely with the user. It won't be shown again.</p>
            <button className="cyber-btn w-full py-1.5 text-xs" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[10px] uppercase" style={{ color: 'var(--cyber-text-dim)' }}>
                Custom password (leave blank for auto-generated)
              </span>
              <input
                type="text"
                className="cyber-input w-full mt-0.5 text-sm"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Auto-generated if empty"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button className="cyber-btn cyber-btn-ghost px-4 py-1.5 text-xs" onClick={onClose}>Cancel</button>
              <button className="cyber-btn px-4 py-1.5 text-xs" onClick={handleReset} disabled={saving}
                style={{ background: 'var(--cyber-amber, #ffaa00)', color: '#000' }}>
                {saving ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DeleteUserModal({ user, onClose, onDeleted }) {
  const [action, setAction] = useState('inherit')
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await apiFetch(`/admin/users/${user.id}/?action=${action}`, { method: 'DELETE' })
      onDeleted()
      onClose()
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="cyber-card p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-4 text-red-400">Delete User: {user.username}</h3>

        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
            What should happen to this user's content (caves, photos, posts)?
          </p>

          <label className="flex items-center gap-2 text-xs p-2 rounded cursor-pointer"
            style={{ background: action === 'inherit' ? 'var(--cyber-surface)' : 'transparent' }}>
            <input type="radio" checked={action === 'inherit'} onChange={() => setAction('inherit')}
              className="accent-[var(--cyber-cyan)]" />
            <div>
              <div style={{ color: 'var(--cyber-text)' }}>Inherit content</div>
              <div style={{ color: 'var(--cyber-text-dim)' }}>Transfer caves, photos, posts to you</div>
            </div>
          </label>

          <label className="flex items-center gap-2 text-xs p-2 rounded cursor-pointer"
            style={{ background: action === 'delete' ? 'var(--cyber-surface)' : 'transparent' }}>
            <input type="radio" checked={action === 'delete'} onChange={() => setAction('delete')}
              className="accent-red-400" />
            <div>
              <div className="text-red-400">Delete everything</div>
              <div style={{ color: 'var(--cyber-text-dim)' }}>Permanently remove all content</div>
            </div>
          </label>

          <label className="block">
            <span className="text-[10px]" style={{ color: 'var(--cyber-text-dim)' }}>
              Type "{user.username}" to confirm
            </span>
            <input
              className="cyber-input w-full mt-0.5 text-sm"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={user.username}
            />
          </label>

          <div className="flex justify-end gap-2">
            <button className="cyber-btn cyber-btn-ghost px-4 py-1.5 text-xs" onClick={onClose}>Cancel</button>
            <button
              className="cyber-btn px-4 py-1.5 text-xs"
              onClick={handleDelete}
              disabled={deleting || confirm !== user.username}
              style={{ background: 'var(--cyber-red, #ff4444)', color: '#fff', opacity: confirm !== user.username ? 0.4 : 1 }}
            >
              {deleting ? 'Deleting...' : 'Delete User'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function UserManagement() {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('-date_joined')
  const [loading, setLoading] = useState(true)
  const [editUser, setEditUser] = useState(null)
  const [resetUser, setResetUser] = useState(null)
  const [deleteUser, setDeleteUser] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch(`/admin/users/?search=${encodeURIComponent(search)}&sort=${sort}&page=${page}&per_page=20`)
      setUsers(data.results)
      setTotal(data.total)
      setPages(data.pages)
    } catch (e) {
      console.error('Failed to fetch users:', e)
    } finally {
      setLoading(false)
    }
  }, [search, sort, page])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleSort = (col) => {
    setSort(s => s === col ? `-${col}` : s === `-${col}` ? col : col)
    setPage(1)
  }

  const SortIcon = ({ col }) => {
    if (sort === col) return <span className="ml-0.5">▲</span>
    if (sort === `-${col}`) return <span className="ml-0.5">▼</span>
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          className="cyber-input flex-1 text-sm"
          placeholder="Search users..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <button className="cyber-btn px-3 py-1.5 text-xs whitespace-nowrap" onClick={() => setShowCreate(true)}>
          + Add User
        </button>
        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--cyber-text-dim)' }}>
          {total} users
        </span>
      </div>

      <div className="cyber-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--cyber-border)' }}>
              {[
                { key: 'username', label: 'User' },
                { key: 'email', label: 'Email' },
                { key: 'date_joined', label: 'Joined' },
                { key: 'last_login', label: 'Last Login' },
                { key: 'cave_count', label: 'Caves' },
              ].map(col => (
                <th key={col.key}
                  className="text-left p-2 cursor-pointer hover:text-[var(--cyber-cyan)]"
                  style={{ color: 'var(--cyber-text-dim)' }}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}<SortIcon col={col.key} />
                </th>
              ))}
              <th className="p-2 text-left" style={{ color: 'var(--cyber-text-dim)' }}>Roles</th>
              <th className="p-2 text-right" style={{ color: 'var(--cyber-text-dim)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--cyber-text-dim)' }}>No users found</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="hover:bg-[var(--cyber-surface)]" style={{ borderBottom: '1px solid var(--cyber-border)' }}>
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <AvatarDisplay user={u} size="w-6 h-6" textSize="text-[10px]" />
                    <span style={{ color: 'var(--cyber-text)' }}>{u.username}</span>
                  </div>
                </td>
                <td className="p-2" style={{ color: 'var(--cyber-text-dim)' }}>{u.email}</td>
                <td className="p-2" style={{ color: 'var(--cyber-text-dim)' }}>{formatDate(u.date_joined)}</td>
                <td className="p-2" style={{ color: 'var(--cyber-text-dim)' }}>{formatDate(u.last_login)}</td>
                <td className="p-2" style={{ color: 'var(--cyber-cyan)' }}>{u.cave_count}</td>
                <td className="p-2">
                  <div className="flex gap-1 flex-wrap">
                    {u.is_staff && <span className="cyber-badge text-[9px]" style={{ borderColor: 'var(--cyber-magenta)', color: 'var(--cyber-magenta)' }}>Staff</span>}
                    {!u.is_active && <span className="cyber-badge text-[9px]" style={{ borderColor: 'var(--cyber-red, #ff4444)', color: 'var(--cyber-red, #ff4444)' }}>Inactive</span>}
                    {u.is_wiki_editor && <span className="cyber-badge text-[9px]" style={{ borderColor: 'var(--cyber-green, #00ff88)', color: 'var(--cyber-green, #00ff88)' }}>Wiki</span>}
                  </div>
                </td>
                <td className="p-2 text-right whitespace-nowrap">
                  <button
                    className="cyber-btn cyber-btn-ghost px-2 py-0.5 text-[10px] mr-1"
                    onClick={() => setEditUser(u)}
                  >Edit</button>
                  <button
                    className="cyber-btn cyber-btn-ghost px-2 py-0.5 text-[10px] mr-1"
                    style={{ color: 'var(--cyber-amber, #ffaa00)' }}
                    onClick={() => setResetUser(u)}
                  >Reset PW</button>
                  <button
                    className="cyber-btn cyber-btn-ghost px-2 py-0.5 text-[10px]"
                    style={{ color: 'var(--cyber-red, #ff4444)' }}
                    onClick={() => setDeleteUser(u)}
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            className="cyber-btn cyber-btn-ghost px-2 py-1 text-xs"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >Prev</button>
          <span className="text-xs" style={{ color: 'var(--cyber-text-dim)' }}>
            Page {page} of {pages}
          </span>
          <button
            className="cyber-btn cyber-btn-ghost px-2 py-1 text-xs"
            disabled={page >= pages}
            onClick={() => setPage(p => p + 1)}
          >Next</button>
        </div>
      )}

      {/* Modals */}
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={fetchUsers} />}
      {editUser && <UserEditModal user={editUser} onClose={() => setEditUser(null)} onSaved={fetchUsers} />}
      {resetUser && <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} />}
      {deleteUser && <DeleteUserModal user={deleteUser} onClose={() => setDeleteUser(null)} onDeleted={fetchUsers} />}
    </div>
  )
}
