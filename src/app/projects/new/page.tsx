'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ArrowRight, Building2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export default function NewProjectPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [location, setLocation] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !code.trim()) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), code: code.trim(), location: location.trim() || null }),
      })
      if (res.status === 401) throw new Error('انتهت جلسة الدخول؛ يرجى تسجيل الدخول مجددًا')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || data.error || `HTTP ${res.status}`)
      }
      toast({ title: 'تم إنشاء المشروع', description: 'تم إنشاء المشروع بنجاح' })
      router.push('/')
    } catch (err) {
      toast({ title: 'تعذر إنشاء المشروع', description: err instanceof Error ? err.message : 'خطأ غير متوقع', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8" dir="rtl">
      <div className="max-w-xl mx-auto">
        <Button variant="ghost" onClick={() => router.back()} className="mb-4 gap-2">
          <ArrowRight className="h-4 w-4" /> العودة
        </Button>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center"><Building2 className="h-5 w-5 text-emerald-700" /></div>
              <div>
                <CardTitle>إنشاء مشروع جديد</CardTitle>
                <CardDescription>أنشئ المشروع أولًا ثم أضف القواميس والوحدات وبنود جدول الكميات الفعلية.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2"><Label>اسم المشروع *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="اسم المشروع" required /></div>
              <div className="space-y-2"><Label>رمز المشروع *</Label><Input value={code} onChange={e => setCode(e.target.value)} placeholder="PRJ-001" required /></div>
              <div className="space-y-2"><Label>الموقع</Label><Input value={location} onChange={e => setLocation(e.target.value)} placeholder="الموقع" /></div>
              <Button type="submit" disabled={loading || !name.trim() || !code.trim()} className="w-full bg-emerald-600 hover:bg-emerald-700">
                {loading && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                إنشاء المشروع
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
