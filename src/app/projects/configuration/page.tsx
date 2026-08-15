'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ArrowRight, BookOpen, Boxes, FileText, Loader2, Plus, RefreshCw } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getDictionariesHybrid, getProjectsHybrid } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

type Dictionary = { id: string; kind?: string; key?: string; value?: string; name?: string; category?: string; description?: string | null; isActive?: boolean; items?: any[] }
type Unit = { id: string; name: string; code: string; unitType?: string; floor?: string | null; areaSqm?: number | null; boqItems?: Boq[] }
type Boq = { id: string; trade: string; description: string; quantity: number; unitOfMeasure: string; completionPct?: number }

async function api<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const send = () => fetch(`${API_BASE}${endpoint}`, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(useAuthStore.getState().tokens?.accessToken ? { Authorization: `Bearer ${useAuthStore.getState().tokens!.accessToken}` } : {}), ...(options.headers || {}) } })
  let res = await send()
  if (res.status === 401) { await useAuthStore.getState().refreshAccessToken(); res = await send() }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`)
  return data as T
}

export default function ProjectConfigurationPage() {
  const params = useSearchParams(); const router = useRouter(); const { toast } = useToast(); const user = useAuthStore(s => s.user)
  const projectId = params.get('projectId') || ''
  const orgId = String(user?.orgId || '')
  const [project, setProject] = useState<any>(null); const [dictionaries, setDictionaries] = useState<Dictionary[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false)
  const [dictKind, setDictKind] = useState('trade'); const [dictKey, setDictKey] = useState(''); const [dictValue, setDictValue] = useState('')
  const [unitName, setUnitName] = useState(''); const [unitCode, setUnitCode] = useState(''); const [unitType, setUnitType] = useState(''); const [unitFloor, setUnitFloor] = useState(''); const [unitArea, setUnitArea] = useState('')
  const [selectedUnit, setSelectedUnit] = useState(''); const [trade, setTrade] = useState(''); const [description, setDescription] = useState(''); const [quantity, setQuantity] = useState(''); const [uom, setUom] = useState('')

  const reload = async () => {
    if (!orgId || !projectId) return
    setLoading(true)
    try {
      const [projectsResult, dictionariesResult] = await Promise.all([getProjectsHybrid(orgId), getDictionariesHybrid(orgId)])
      setProject(projectsResult.data.find((p: any) => String(p.id) === String(projectId)) || null)
      setDictionaries(dictionariesResult.data || [])
    } catch (e) { toast({ title: 'تعذر تحميل إعدادات المشروع', description: e instanceof Error ? e.message : 'خطأ غير متوقع', variant: 'destructive' }) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [orgId, projectId])

  const kinds = useMemo(() => Array.from(new Set(dictionaries.map(d => d.kind || d.category).filter(Boolean))), [dictionaries])
  const trades = useMemo(() => dictionaries.filter(d => (d.kind || d.category) === 'trade' && (d.isActive !== false)).map(d => d.value || d.name || d.key).filter(Boolean), [dictionaries])
  const uoms = useMemo(() => dictionaries.filter(d => (d.kind || d.category) === 'uom' && (d.isActive !== false)).map(d => d.value || d.name || d.key).filter(Boolean), [dictionaries])
  const unitTypes = useMemo(() => dictionaries.filter(d => (d.kind || d.category) === 'unit_type' && (d.isActive !== false)).map(d => d.value || d.name || d.key).filter(Boolean), [dictionaries])

  const addDictionary = async () => {
    if (!dictValue.trim()) return
    setSaving(true)
    try { await api('/projects/dictionaries', { method: 'POST', body: JSON.stringify({ project_id: projectId, kind: dictKind, key: dictKey.trim() || dictValue.trim(), value: dictValue.trim(), sort_order: 0, is_active: true }) }); setDictKey(''); setDictValue(''); await reload(); toast({ title: 'تمت إضافة القيمة' }) }
    catch (e) { toast({ title: 'فشل إضافة القاموس', description: e instanceof Error ? e.message : 'خطأ', variant: 'destructive' }) }
    finally { setSaving(false) }
  }

  const addUnit = async () => {
    if (!unitName.trim() || !unitCode.trim() || !unitType.trim()) return
    setSaving(true)
    try { await api(`/projects/${projectId}/units`, { method: 'POST', body: JSON.stringify({ name: unitName.trim(), code: unitCode.trim(), unit_type: unitType.trim(), floor: unitFloor.trim() || null, area_sqm: unitArea ? Number(unitArea) : null }) }); setUnitName(''); setUnitCode(''); setUnitFloor(''); setUnitArea(''); await reload(); toast({ title: 'تمت إضافة الوحدة' }) }
    catch (e) { toast({ title: 'فشل إضافة الوحدة', description: e instanceof Error ? e.message : 'خطأ', variant: 'destructive' }) }
    finally { setSaving(false) }
  }

  const addBoq = async () => {
    if (!selectedUnit || !description.trim() || !trade.trim() || !uom.trim() || !quantity) return
    setSaving(true)
    try { await api(`/projects/${projectId}/units/${selectedUnit}/boq`, { method: 'POST', body: JSON.stringify({ trade: trade.trim(), description: description.trim(), quantity: Number(quantity), unit_of_measure: uom.trim() }) }); setDescription(''); setQuantity(''); await reload(); toast({ title: 'تمت إضافة بند جدول الكميات' }) }
    catch (e) { toast({ title: 'فشل إضافة البند', description: e instanceof Error ? e.message : 'خطأ', variant: 'destructive' }) }
    finally { setSaving(false) }
  }

  if (!projectId) return <main className="p-6" dir="rtl"><Card><CardContent className="p-8 text-center">لم يتم تحديد مشروع.</CardContent></Card></main>
  if (loading && !project) return <main className="min-h-screen flex items-center justify-center" dir="rtl"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></main>
  if (!project) return <main className="p-6" dir="rtl"><Card><CardContent className="p-8 text-center">المشروع غير موجود أو لا يمكن الوصول إليه.</CardContent></Card></main>

  return <main className="min-h-screen bg-gray-50 p-4 md:p-6" dir="rtl">
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => router.push('/')}><ArrowRight className="h-5 w-5" /></Button><div><h1 className="text-xl font-bold">إعداد المشروع</h1><p className="text-sm text-muted-foreground">{project.name} — {project.code}</p></div></div><Button variant="outline" size="sm" onClick={reload} disabled={loading}><RefreshCw className={`h-4 w-4 ml-1 ${loading ? 'animate-spin' : ''}`} />تحديث</Button></div>
      <Card><CardContent className="p-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center"><div><p className="text-xs text-muted-foreground">القواميس</p><p className="text-xl font-bold">{dictionaries.length}</p></div><div><p className="text-xs text-muted-foreground">الوحدات</p><p className="text-xl font-bold">{project.units?.length || 0}</p></div><div><p className="text-xs text-muted-foreground">بنود BOQ</p><p className="text-xl font-bold">{(project.units || []).reduce((n: number, u: any) => n + (u.boqItems?.length || 0), 0)}</p></div><div><p className="text-xs text-muted-foreground">الإنجاز</p><p className="text-xl font-bold text-emerald-700">{Math.round(project.completionPct || 0)}%</p></div></div></CardContent></Card>

      <Tabs defaultValue="dictionaries" dir="rtl">
        <TabsList className="grid grid-cols-3 w-full"><TabsTrigger value="dictionaries"><BookOpen className="h-4 w-4 ml-1" />القواميس</TabsTrigger><TabsTrigger value="units"><Boxes className="h-4 w-4 ml-1" />الوحدات</TabsTrigger><TabsTrigger value="boq"><FileText className="h-4 w-4 ml-1" />BOQ</TabsTrigger></TabsList>

        <TabsContent value="dictionaries" className="space-y-4">
          <Card><CardHeader><CardTitle>قواميس المشروع</CardTitle><CardDescription>القيم القابلة للتخصيص للمشروع. لا توجد أسماء بنود مفروضة في الكود.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid md:grid-cols-3 gap-3"><div><Label>نوع القاموس</Label><Input value={dictKind} onChange={e => setDictKind(e.target.value.trim().toLowerCase())} placeholder="trade / uom / unit_type / ..." /></div><div><Label>المفتاح</Label><Input value={dictKey} onChange={e => setDictKey(e.target.value)} placeholder="مفتاح اختياري" /></div><div><Label>القيمة الظاهرة للمستخدم *</Label><Input value={dictValue} onChange={e => setDictValue(e.target.value)} placeholder="مثال: حجر طبيعي" /></div></div><Button onClick={addDictionary} disabled={saving || !dictValue.trim()}><Plus className="h-4 w-4 ml-1" />إضافة إلى قاموس المشروع</Button><Separator /><div className="flex flex-wrap gap-2">{dictionaries.map((d, i) => <Badge key={d.id || i} variant="outline">{d.kind || d.category}: {d.value || d.name || d.key}</Badge>)}</div></CardContent></Card>
        </TabsContent>

        <TabsContent value="units" className="space-y-4">
          <Card><CardHeader><CardTitle>الوحدات</CardTitle><CardDescription>نوع الوحدة يُقرأ من قاموس المشروع، ويمكن إضافة قيمة جديدة من تبويب القواميس.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid md:grid-cols-3 gap-3"><div><Label>اسم الوحدة *</Label><Input value={unitName} onChange={e => setUnitName(e.target.value)} placeholder="مثال: المأوى 001" /></div><div><Label>رمز الوحدة *</Label><Input value={unitCode} onChange={e => setUnitCode(e.target.value)} placeholder="S-001" /></div><div><Label>نوع الوحدة *</Label><Select value={unitType} onValueChange={setUnitType}><SelectTrigger><SelectValue placeholder={unitTypes.length ? 'اختر من القاموس' : 'أضف unit_type أولًا'} /></SelectTrigger><SelectContent>{unitTypes.map(v => <SelectItem key={String(v)} value={String(v)}>{String(v)}</SelectItem>)}</SelectContent></Select></div></div><div className="grid md:grid-cols-2 gap-3"><div><Label>الطابق</Label><Input value={unitFloor} onChange={e => setUnitFloor(e.target.value)} /></div><div><Label>المساحة</Label><Input type="number" value={unitArea} onChange={e => setUnitArea(e.target.value)} /></div></div><Button onClick={addUnit} disabled={saving || !unitName.trim() || !unitCode.trim() || !unitType.trim()}><Plus className="h-4 w-4 ml-1" />إضافة وحدة</Button><Separator /><div className="space-y-2">{(project.units || []).map((u: Unit) => <Card key={u.id}><CardContent className="p-3 flex items-center justify-between"><div><p className="font-bold">{u.name}</p><p className="text-xs text-muted-foreground">{u.code} · {u.unitType || '—'} · {u.floor || '—'}</p></div><Badge variant="outline">{u.boqItems?.length || 0} بند</Badge></CardContent></Card>)}</div></CardContent></Card>
        </TabsContent>

        <TabsContent value="boq" className="space-y-4">
          <Card><CardHeader><CardTitle>بنود جدول الكميات الفعلية</CardTitle><CardDescription>كل بند يُضاف إلى الوحدة فعليًا. الوصف والتصنيف والكمية والوحدة ليست ثابتة في الكود.</CardDescription></CardHeader><CardContent className="space-y-4"><div><Label>الوحدة *</Label><Select value={selectedUnit} onValueChange={setSelectedUnit}><SelectTrigger><SelectValue placeholder="اختر الوحدة" /></SelectTrigger><SelectContent>{(project.units || []).map((u: Unit) => <SelectItem key={u.id} value={u.id}>{u.name} — {u.code}</SelectItem>)}</SelectContent></Select></div><div className="grid md:grid-cols-4 gap-3"><div><Label>التصنيف/Trade *</Label><Select value={trade} onValueChange={setTrade}><SelectTrigger><SelectValue placeholder={trades.length ? 'اختر من القاموس' : 'أضف trade أولًا'} /></SelectTrigger><SelectContent>{trades.map(v => <SelectItem key={String(v)} value={String(v)}>{String(v)}</SelectItem>)}</SelectContent></Select></div><div><Label>الوصف الفعلي *</Label><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="وصف بند المشروع" /></div><div><Label>الكمية *</Label><Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} /></div><div><Label>وحدة القياس *</Label><Select value={uom} onValueChange={setUom}><SelectTrigger><SelectValue placeholder={uoms.length ? 'اختر من القاموس' : 'أضف uom أولًا'} /></SelectTrigger><SelectContent>{uoms.map(v => <SelectItem key={String(v)} value={String(v)}>{String(v)}</SelectItem>)}</SelectContent></Select></div></div><Button onClick={addBoq} disabled={saving || !selectedUnit || !description.trim() || !trade || !quantity || !uom}><Plus className="h-4 w-4 ml-1" />إضافة بند فعلي</Button><Separator /><div className="space-y-3">{(project.units || []).map((u: Unit) => <div key={u.id}><div className="font-bold text-sm mb-1">{u.name}</div>{(u.boqItems || []).length ? <div className="space-y-1">{u.boqItems!.map((b: Boq) => <div key={b.id} className="flex items-center justify-between rounded-lg border bg-white p-2 text-sm"><div className="min-w-0"><Badge variant="outline" className="ml-2">{b.trade}</Badge><span>{b.description}</span></div><span className="text-xs text-muted-foreground">{b.quantity} {b.unitOfMeasure}</span></div>)}</div> : <p className="text-xs text-muted-foreground">لا توجد بنود بعد.</p>}</div>)}</div></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  </main>
}
