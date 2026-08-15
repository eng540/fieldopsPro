'use client'

import { useAuthStore } from './auth-store'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export interface CreateProjectInput {
  name: string
  code: string
  location?: string | null
  description?: string | null
}

export async function createProject(input: CreateProjectInput) {
  const send = async () => {
    const token = useAuthStore.getState().tokens?.accessToken
    return fetch(`${API_BASE}/projects`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        location: input.location?.trim() || null,
        description: input.description?.trim() || null,
      }),
    })
  }

  let response = await send()

  if (response.status === 401) {
    await useAuthStore.getState().refreshAccessToken()
    response = await send()
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `فشل إنشاء المشروع (HTTP ${response.status})`)
  }

  return payload
}
