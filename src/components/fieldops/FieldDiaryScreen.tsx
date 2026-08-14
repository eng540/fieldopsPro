'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, CloudSun, MapPin, Save, WifiOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { listDiary, saveDiary, type DiaryEntry } from '@/lib/legacy-capabilities-api'

interface Props { projectId?: string; projectName?: string }

export function FieldDiaryScreen({ projectId, projectName }: Props) {
  const { toast } = useToast()
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [offlineDraft, setOfflineDraft] = useState<any>(null)
  const [form, setForm] = useState({
    diary_date: new Date().toISOString().slice(0,10), weather: '', workers: '', equipment: '',
    visits_total: '0', visits_accepted: '0', observations: '', gps_tag: null as Record<string, unknown> | null,
  })

  const load = async () => {
    if (!projectId) return
    setLoading(true)
    try { setEntries((await listDiary(projectId)).items) } catch (e) { console.warn(e) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [projectId])

  const gps = () => {
    if (!navigator.geolocation) return toast({ title: 'GPS غير متاح', variant: 'destructive' })
    navigator.geolocation.getCurrentPosition(
      p => setForm(f => ({ ...f, gps_tag: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy, captured_at: new Date().toISOString() } })),
      () => toast({ title: 'تعذر الحصول على الموقع', description: 'تحقق من صلاحية الموقع', variant: 'destructive' })
    )
  }

  const save = async () => {
    if (!projectId) return
    const payload = {
      project_id: Number(projectId), diary_date: form.diary_date, weather: form.weather || null,
      workforce: { workers: Number(form.workers || 0) }, equipment: form.equipment.split(',').map(s => s.trim()).filter(Boolean),
      visits_total: Number(form.visits_total || 0), visits_accepted: Number(form.visits_accepted || 0),
      observations: form.observations || null, gps_tag: form.gps_tag, attachments: [],
    }
    if (!navigator.onLine) {
      localStorage.setItem('fieldops-diary-draft', JSON.stringify(payload)); setOfflineDraft(payload)
      return toast({ title: 'تم الحفظ محلياً', description: 'سيتم رفع سجل اليوم عند عودة الاتصال' })
    }
    try { await saveDiary(payload); localStorage.removeItem('fieldops-diary-draft'); setOfflineDraft(null); await load(); toast({ title: 'تم حفظ سجل الموقع' }) }
    catch (e) { localStorage.setItem('fieldops-diary-draft', JSON.stringify(payload)); setOfflineDraft(payload); toast({ title: 'حُفظ كمسودة', description: 'تعذر الاتصال بالخادم', variant: 'destructive' }) }
  }

  useEffect(() => { try { const d = localStorage.getItem('fieldops-diary-draft'); if (d) setOfflineDraft(JSON.parse(d)) } catch {} }, [])

  return <div className="space-y-5">
    <div className="flex items-center justify-between"><div><h2 className="text-2xl font-bold">سجل الموقع اليومي</h2><p className="text-sm text-gray-500 mt-1">{projectName || 'اختر مشروعاً'} — سجل ميداني موحد</p></div><div className="flex gap-2"><Badge variant="outline"><CalendarDays className="w-3 h-3 ml-1" />{form.diary_date}</Badge>{!navigator.onLine && <Badge className="bg-amber-100 text-amber-800"><WifiOff className="w-3 h-3 ml-1"/>أوفلاين</Badge>}</div></div>
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-white rounded-xl border p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4"><label className="text-sm">التاريخ<Input type="date" value={form.diary_date} onChange={e=>setForm({...form,diary_date:e.target.value})}/></label><label className="text-sm">الطقس<Input placeholder="مشمس / غائم / ممطر" value={form.weather} onChange={e=>setForm({...form,weather:e.target.value})}/></label><label className="text-sm">عدد العمال<Input type="number" min="0" value={form.workers} onChange={e=>setForm({...form,workers:e.target.value})}/></label><label className="text-sm">المعدات<Input placeholder="خلاطة، قلاب..." value={form.equipment} onChange={e=>setForm({...form,equipment:e.target.value})}/></label><label className="text-sm">الزيارات/المواقع المفحوصة<Input type="number" min="0" value={form.visits_total} onChange={e=>setForm({...form,visits_total:e.target.value})}/></label><label className="text-sm">المقبول منها<Input type="number" min="0" value={form.visits_accepted} onChange={e=>setForm({...form,visits_accepted:e.target.value})}/></label></div>
        <label className="text-sm">الملاحظات اليومية<Textarea rows={6} placeholder="الأعمال المنفذة، المعوقات، التوجيهات، الملاحظات..." value={form.observations} onChange={e=>setForm({...form,observations:e.target.value})}/></label>
        <div className="flex gap-2"><Button variant="outline" onClick={gps}><MapPin className="w-4 h-4 ml-1"/>{form.gps_tag ? 'تم التقاط GPS' : 'التقاط GPS'}</Button><Button onClick={save}><Save className="w-4 h-4 ml-1"/>حفظ سجل اليوم</Button></div>
      </div>
      <div className="bg-white rounded-xl border p-5"><h3 className="font-bold mb-3">السجلات السابقة</h3>{loading ? <RefreshCw className="animate-spin"/> : entries.length === 0 ? <p className="text-sm text-gray-500">لا توجد سجلات لهذا المشروع.</p> : <div className="space-y-2">{entries.slice(0,8).map(e=><div key={e.id} className="border rounded-lg p-3"><div className="flex justify-between"><b className="text-sm">{e.diary_date}</b><span className="text-xs text-gray-500">{e.visits_accepted}/{e.visits_total} مقبول</span></div><p className="text-xs text-gray-600 mt-1 line-clamp-2">{e.observations || 'بدون ملاحظات'}</p></div>)}</div>}{offlineDraft && <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs">مسودة محلية تنتظر الاتصال.</div>}</div>
    </div>
  </div>
}
