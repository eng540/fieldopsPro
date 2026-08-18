'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, MapPin, Save, WifiOff, RefreshCw, Trash2, Users, Wrench, ClipboardCheck, RotateCcw, CloudOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { listDiary, saveDiary, type DiaryEntry } from '@/lib/legacy-capabilities-api'
import { saveDiaryOffline } from '@/lib/offline-db'

const DRAFT_PREFIX = 'fieldops-diary-draft:'
const DRAFT_META_PREFIX = 'fieldops-diary-meta:'

type FormState = {
  diary_date: string
  weather: string
  workers: string
  equipment: string
  visits_total: string
  visits_accepted: string
  observations: string
  gps_tag: Record<string, unknown> | null
}

type DraftMeta = { savedAt: string }

const initialForm = (): FormState => ({
  diary_date: new Date().toISOString().slice(0, 10),
  weather: '',
  workers: '',
  equipment: '',
  visits_total: '0',
  visits_accepted: '0',
  observations: '',
  gps_tag: null,
})

function isFormState(value: unknown): value is FormState {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.diary_date === 'string' && typeof v.observations === 'string'
}

export function FieldDiaryScreen({ projectId, projectName, onChanged }: { projectId?: string; projectName?: string; onChanged?: () => void | Promise<void> }) {
  const { toast } = useToast()
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [online, setOnline] = useState(true)
  const [hasDraft, setHasDraft] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(initialForm())
  const draftKey = projectId ? `${DRAFT_PREFIX}${projectId}` : ''
  const draftMetaKey = projectId ? `${DRAFT_META_PREFIX}${projectId}` : ''

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setEntries((await listDiary(projectId)).items)
    } catch (e) {
      toast({ title: 'تعذر تحميل السجل السابق', description: e instanceof Error ? e.message : 'خطأ غير معروف', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    addEventListener('online', sync)
    addEventListener('offline', sync)
    return () => {
      removeEventListener('online', sync)
      removeEventListener('offline', sync)
    }
  }, [])

  useEffect(() => { load() }, [projectId])

  useEffect(() => {
    setHasDraft(false)
    setDraftSavedAt(null)
    setForm(initialForm())
    if (!draftKey) return
    try {
      const raw = localStorage.getItem(draftKey)
      const metaRaw = draftMetaKey ? localStorage.getItem(draftMetaKey) : null
      if (raw) {
        const parsed = JSON.parse(raw)
        if (isFormState(parsed)) {
          setForm({ ...initialForm(), ...parsed })
          setHasDraft(true)
          if (metaRaw) setDraftSavedAt((JSON.parse(metaRaw) as DraftMeta).savedAt || null)
        }
      }
    } catch {
      localStorage.removeItem(draftKey)
      if (draftMetaKey) localStorage.removeItem(draftMetaKey)
    }
  }, [draftKey, draftMetaKey])

  useEffect(() => {
    if (!draftKey || !projectId) return
    const timer = setTimeout(() => {
      try {
        const savedAt = new Date().toISOString()
        localStorage.setItem(draftKey, JSON.stringify(form))
        if (draftMetaKey) localStorage.setItem(draftMetaKey, JSON.stringify({ savedAt } satisfies DraftMeta))
        setHasDraft(true)
        setDraftSavedAt(savedAt)
      } catch {
        // Storage can be unavailable in private/restricted browser modes.
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [form, draftKey, draftMetaKey, projectId])

  const totals = useMemo(() => ({
    workers: Math.max(0, Number(form.workers) || 0),
    total: Math.max(0, Number(form.visits_total) || 0),
    accepted: Math.max(0, Number(form.visits_accepted) || 0),
  }), [form])

  const valid = !!projectId && !!form.diary_date && totals.accepted <= totals.total
  const draftText = draftSavedAt ? new Date(draftSavedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : null

  const gps = () => {
    if (!navigator.geolocation) {
      toast({ title: 'تحديد الموقع غير متاح', description: 'المتصفح أو الجهاز لا يدعم GPS', variant: 'destructive' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      p => setForm(f => ({ ...f, gps_tag: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy), captured_at: new Date().toISOString() } })),
      () => toast({ title: 'تعذر الحصول على الموقع', description: 'تحقق من صلاحية الموقع في المتصفح', variant: 'destructive' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
  }

  const clearDraft = () => {
    if (draftKey) localStorage.removeItem(draftKey)
    if (draftMetaKey) localStorage.removeItem(draftMetaKey)
    setHasDraft(false)
    setDraftSavedAt(null)
    setForm(initialForm())
    toast({ title: 'تم مسح المسودة', description: 'يمكنك بدء سجل جديد لهذا المشروع' })
  }

  const restoreDraft = () => {
    if (!draftKey) return
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (isFormState(parsed)) {
        setForm({ ...initialForm(), ...parsed })
        toast({ title: 'تمت استعادة المسودة' })
      }
    } catch {
      toast({ title: 'تعذر استعادة المسودة', variant: 'destructive' })
    }
  }

  const save = async () => {
    if (!valid) {
      toast({ title: 'تحقق من البيانات', description: totals.accepted > totals.total ? 'عدد الزيارات المقبولة لا يمكن أن يتجاوز الإجمالي' : 'اختر مشروعاً وأدخل التاريخ', variant: 'destructive' })
      return
    }
    const payload = {
      project_id: Number(projectId),
      diary_date: form.diary_date,
      weather: form.weather || null,
      workforce: { workers: totals.workers },
      equipment: form.equipment.split(',').map(s => s.trim()).filter(Boolean),
      visits_total: totals.total,
      visits_accepted: totals.accepted,
      observations: form.observations || null,
      gps_tag: form.gps_tag,
      attachments: [],
    }
    setSaving(true)
    try {
      if (!online) {
        await saveDiaryOffline(payload)
        if (draftKey) localStorage.removeItem(draftKey)
        if (draftMetaKey) localStorage.removeItem(draftMetaKey)
        setHasDraft(false)
        setDraftSavedAt(null)
        setForm(initialForm())
        toast({ title: 'تمت إضافة اليومية إلى طابور المزامنة', description: 'ستُرسل تلقائياً عند عودة الاتصال.' })
        return
      }
      await saveDiary(payload)
      if (draftKey) localStorage.removeItem(draftKey)
      if (draftMetaKey) localStorage.removeItem(draftMetaKey)
      setHasDraft(false)
      setDraftSavedAt(null)
      await load()
      await onChanged?.()
      toast({ title: 'تم حفظ سجل الموقع', description: 'تم حفظ السجل على الخادم بنجاح' })
      setForm(initialForm())
    } catch {
      try {
        if (draftKey) localStorage.setItem(draftKey, JSON.stringify(form))
        if (draftMetaKey) {
          const savedAt = new Date().toISOString()
          localStorage.setItem(draftMetaKey, JSON.stringify({ savedAt } satisfies DraftMeta))
          setDraftSavedAt(savedAt)
        }
        setHasDraft(true)
      } catch { /* best effort */ }
      toast({ title: 'تم حفظ المسودة محلياً', description: 'تعذر الوصول للخادم. لم تُفقد البيانات ويمكن إعادة المحاولة.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return <div className="space-y-5" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><CalendarDays className="w-5 h-5 text-emerald-600"/><h2 className="text-2xl font-bold">سجل الموقع اليومي</h2>{hasDraft && <Badge variant="outline">مسودة محفوظة</Badge>}</div>
        <p className="text-sm text-gray-500 mt-1">{projectName || 'اختر مشروعاً من الشريط العلوي قبل الإدخال'}</p>
      </div>
      <div className="flex items-center gap-2">
        {!online && <Badge><WifiOff className="w-3 h-3 ml-1"/>أوفلاين</Badge>}
        {hasDraft && draftText && <span className="text-[11px] text-gray-500 flex items-center gap-1"><CloudOff className="w-3 h-3"/>آخر حفظ محلي {draftText}</span>}
      </div>
    </div>
    {!projectId && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">لا يمكن إنشاء سجل قبل اختيار مشروع. اختر المشروع من أعلى الشاشة.</div>}
    {hasDraft && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex flex-wrap items-center justify-between gap-2 text-sm text-emerald-800"><span>توجد مسودة غير مرسلة لهذا المشروع.</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={restoreDraft}><RotateCcw className="w-3.5 h-3.5 ml-1"/>استعادة المسودة</Button><Button size="sm" variant="ghost" onClick={clearDraft}><Trash2 className="w-3.5 h-3.5 ml-1"/>مسحها</Button></div></div>}
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-white border rounded-xl p-5 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm font-medium">التاريخ<Input className="mt-1" type="date" value={form.diary_date} onChange={e=>setForm({...form,diary_date:e.target.value})}/></label>
          <label className="text-sm font-medium">حالة الطقس<Select value={form.weather||'__none'} onValueChange={v=>setForm({...form,weather:v==='__none'?'':v})}><SelectTrigger className="mt-1"><SelectValue placeholder="اختر الحالة"/></SelectTrigger><SelectContent><SelectItem value="__none">غير محدد</SelectItem><SelectItem value="مشمس">مشمس</SelectItem><SelectItem value="غائم">غائم</SelectItem><SelectItem value="ممطر">ممطر</SelectItem><SelectItem value="عاصف">عاصف</SelectItem></SelectContent></Select></label>
          <label className="text-sm font-medium"><span className="flex items-center gap-1"><Users className="w-4 h-4"/>عدد العمال</span><Input className="mt-1" type="number" min="0" value={form.workers} onChange={e=>setForm({...form,workers:e.target.value})}/></label>
          <label className="text-sm font-medium"><span className="flex items-center gap-1"><Wrench className="w-4 h-4"/>المعدات</span><Input className="mt-1" placeholder="حفارة، خلاطة، شاحنة..." value={form.equipment} onChange={e=>setForm({...form,equipment:e.target.value})}/></label>
          <label className="text-sm font-medium">إجمالي الزيارات<Input className="mt-1" type="number" min="0" value={form.visits_total} onChange={e=>setForm({...form,visits_total:e.target.value})}/></label>
          <label className="text-sm font-medium">الزيارات المقبولة<Input className={`mt-1 ${totals.accepted>totals.total?'border-red-500':''}`} type="number" min="0" value={form.visits_accepted} onChange={e=>setForm({...form,visits_accepted:e.target.value})}/></label>
        </div>
        <div className="rounded-lg bg-gray-50 border p-3 flex items-center justify-between text-sm"><span className="flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-emerald-600"/>نسبة قبول الزيارات</span><b>{totals.total?Math.round((totals.accepted/totals.total)*100):0}%</b></div>
        <label className="text-sm font-medium">الملاحظات اليومية<Textarea className="mt-1" rows={7} placeholder="الأعمال المنفذة، العمالة، المعوقات، الزيارات، التوجيهات..." value={form.observations} onChange={e=>setForm({...form,observations:e.target.value})}/></label>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={gps}><MapPin className="w-4 h-4 ml-1"/>{form.gps_tag?'تم التقاط الموقع':'التقاط GPS'}</Button><Button onClick={save} disabled={saving||!projectId}>{saving?<RefreshCw className="w-4 h-4 ml-1 animate-spin"/>:<Save className="w-4 h-4 ml-1"/>}{saving?'جارٍ الحفظ':'حفظ السجل'}</Button>{hasDraft&&<Button variant="ghost" onClick={clearDraft}><Trash2 className="w-4 h-4 ml-1"/>مسح المسودة</Button>}</div>
      </div>
      <div className="bg-white border rounded-xl p-5"><div className="flex items-center justify-between mb-4"><h3 className="font-bold">السجل السابق</h3><Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/></Button></div>{entries.length?entries.slice(0,15).map(e=><div key={e.id} className="border rounded-lg p-3 mb-2 hover:bg-gray-50"><div className="flex justify-between text-sm"><b>{e.diary_date}</b><Badge variant="outline">{e.visits_accepted}/{e.visits_total}</Badge></div><div className="flex gap-3 text-[11px] text-gray-500 mt-2"><span>{e.weather||'طقس غير محدد'}</span>{e.gps_tag&&<span className="text-emerald-700">GPS</span>}</div><p className="text-xs text-gray-600 mt-2 line-clamp-3">{e.observations||'بدون ملاحظات'}</p></div>):<p className="text-sm text-gray-500">لا توجد سجلات سابقة لهذا المشروع.</p>}</div>
    </div>
  </div>
}
