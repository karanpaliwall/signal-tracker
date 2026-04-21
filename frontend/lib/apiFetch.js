const API_KEY = process.env.NEXT_PUBLIC_API_KEY

export default function apiFetch(url, options = {}) {
  if (!API_KEY) return fetch(url, options)
  const headers = { ...(options.headers || {}) }
  headers['X-API-Key'] = API_KEY
  return fetch(url, { ...options, headers })
}
