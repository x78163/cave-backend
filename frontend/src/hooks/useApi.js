import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'

export async function apiFetch(path, options = {}) {
  const { method = 'GET', body, headers, ...rest } = options
  const config = { method, url: path, headers, ...rest }
  if (body) {
    if (body instanceof FormData) {
      config.data = body
    } else if (typeof body === 'string') {
      config.data = JSON.parse(body)
    } else {
      config.data = body
    }
  }
  const res = await api(config)
  return res.data
}

export function useApi(path) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!!path)
  const [error, setError] = useState(null)

  const refetch = useCallback(() => {
    if (!path) { setLoading(false); return }
    setLoading(true)
    setError(null)
    api.get(path)
      .then((res) => setData(res.data))
      .catch(setError)
      .finally(() => setLoading(false))
  }, [path])

  useEffect(() => { refetch() }, [refetch])

  return { data, loading, error, refetch }
}
