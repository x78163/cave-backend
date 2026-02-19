import { create } from 'zustand'
import api from '../services/api'

const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (username, password) => {
    set({ error: null })
    try {
      const { data } = await api.post('/users/auth/login/', { username, password })
      localStorage.setItem('access_token', data.access)
      localStorage.setItem('refresh_token', data.refresh)
      // Fetch full user profile
      const { data: user } = await api.get('/users/me/')
      set({ user, isAuthenticated: true, error: null })
      return user
    } catch (err) {
      const msg = err.response?.data?.detail || 'Login failed'
      set({ error: msg })
      throw err
    }
  },

  register: async (username, email, password, passwordConfirm) => {
    set({ error: null })
    try {
      const { data } = await api.post('/users/auth/register/', {
        username,
        email,
        password,
        password_confirm: passwordConfirm,
      })
      localStorage.setItem('access_token', data.tokens.access)
      localStorage.setItem('refresh_token', data.tokens.refresh)
      set({ user: data.user, isAuthenticated: true, error: null })
      return data.user
    } catch (err) {
      const errors = err.response?.data
      let msg = 'Registration failed'
      if (errors && typeof errors === 'object') {
        // DRF returns {field: [messages]} or {detail: "message"}
        if (errors.detail) {
          msg = errors.detail
        } else {
          const messages = []
          for (const [key, val] of Object.entries(errors)) {
            const text = Array.isArray(val) ? val[0] : String(val)
            messages.push(key === 'non_field_errors' ? text : `${key}: ${text}`)
          }
          if (messages.length) msg = messages.join('. ')
        }
      }
      set({ error: msg })
      throw err
    }
  },

  fetchMe: async () => {
    try {
      const { data } = await api.get('/users/me/')
      set({ user: data, isAuthenticated: true })
      return data
    } catch {
      set({ user: null, isAuthenticated: false })
      return null
    }
  },

  logout: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    set({ user: null, isAuthenticated: false, error: null })
  },

  initAuth: async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      set({ isLoading: false })
      return
    }
    try {
      const { data } = await api.get('/users/me/')
      set({ user: data, isAuthenticated: true, isLoading: false })
    } catch {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))

export default useAuthStore
