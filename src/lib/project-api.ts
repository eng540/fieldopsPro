'use client'

import { apiRequest } from './api-client'

export interface CreateProjectInput {
  name: string
  code: string
  location?: string | null
  description?: string | null
}

export async function createProject(input: CreateProjectInput) {
  const response = await apiRequest<any>('/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      location: input.location?.trim() || null,
      description: input.description?.trim() || null,
    }),
  })
  if (!response.success) {
    const message = response.error === 'UNAUTHORIZED'
      ? 'انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى.'
      : response.error || 'فشل إنشاء المشروع.'
    throw new Error(message)
  }
  return response.data
}
