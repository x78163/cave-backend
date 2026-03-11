import { create } from 'zustand'
import api from '../services/api'

const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  emailVerificationRequired: false,
  unverifiedEmail: null,

  login: async (username, password) => {
    set({ error: null, emailVerificationRequired: false })
    try {
      const { data } = await api.post('/users/auth/login/', { username, password })
      localStorage.setItem('access_token', data.tokens.access)
      localStorage.setItem('refresh_token', data.tokens.refresh)
      set({ user: data.user, isAuthenticated: true, error: null })
      return data.user
    } catch (err) {
      const resp = err.response?.data
      if (resp?.email_verification_required) {
        set({
          error: 'Please verify your email before signing in.',
          emailVerificationRequired: true,
          unverifiedEmail: resp.email || '',
        })
      } else {
        const msg = resp?.error || resp?.detail || 'Login failed'
        set({ error: msg })
      }
      throw err
    }
  },

  googleAuth: async (credential, inviteCode, redirectUri) => {
    set({ error: null })
    try {
      const payload = redirectUri
        ? { code: credential, redirect_uri: redirectUri }
        : { credential }
      if (inviteCode) payload.invite_code = inviteCode
      const { data } = await api.post('/users/auth/google/', payload)

      if (data.needs_invite_code) {
        return { needsInviteCode: true }
      }

      localStorage.setItem('access_token', data.tokens.access)
      localStorage.setItem('refresh_token', data.tokens.refresh)
      set({ user: data.user, isAuthenticated: true, error: null })
      return data
    } catch (err) {
      const resp = err.response?.data
      if (resp?.needs_invite_code) {
        return { needsInviteCode: true }
      }
      const msg = resp?.error || resp?.detail || 'Google sign-in failed'
      set({ error: msg })
      throw err
    }
  },

  register: async (username, email, password, passwordConfirm, inviteCode) => {
    set({ error: null })
    try {
      const { data } = await api.post('/users/auth/register/', {
        username,
        email,
        password,
        password_confirm: passwordConfirm,
        invite_code: inviteCode || '',
      })
      // Don't auto-login — require email verification
      if (data.email_verification_required) {
        set({
          emailVerificationRequired: true,
          unverifiedEmail: email,
          error: null,
        })
        return { emailVerificationRequired: true }
      }
      localStorage.setItem('access_token', data.tokens.access)
      localStorage.setItem('refresh_token', data.tokens.refresh)
      set({ user: data.user, isAuthenticated: true, error: null })
      return data.user
    } catch (err) {
      const errors = err.response?.data
      let msg = 'Registration failed'
      if (errors && typeof errors === 'object') {
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

  verifyEmail: async (token) => {
    try {
      const { data } = await api.post('/users/auth/verify-email/', { token })
      localStorage.setItem('access_token', data.tokens.access)
      localStorage.setItem('refresh_token', data.tokens.refresh)
      set({
        user: data.user,
        isAuthenticated: true,
        emailVerificationRequired: false,
        unverifiedEmail: null,
        error: null,
      })
      return data
    } catch (err) {
      const msg = err.response?.data?.error || 'Verification failed'
      throw new Error(msg)
    }
  },

  resendVerification: async (email) => {
    await api.post('/users/auth/send-verification/', { email })
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
    set({ user: null, isAuthenticated: false, error: null, emailVerificationRequired: false, unverifiedEmail: null })
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

  clearError: () => set({ error: null, emailVerificationRequired: false }),
}))

export default useAuthStore
