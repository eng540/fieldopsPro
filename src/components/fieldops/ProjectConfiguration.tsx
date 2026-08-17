"use client"

import React, { useCallback, useEffect, useState } from "react"
import { apiRequest } from "@/lib/api-client"

export default function ProjectConfiguration() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await apiRequest("/api/v1/projects")
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل إعدادات المشروع")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="p-6">جاري تحميل إعدادات المشروع...</div>
  if (error) return <div className="p-6"><div className="text-destructive">{error}</div><button onClick={() => void load()} className="mt-3 rounded border px-3 py-2">إعادة المحاولة</button></div>

  return <div className="p-6">إعداد المشروع</div>
}
