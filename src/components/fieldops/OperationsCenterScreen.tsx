'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, History, Loader2, RefreshCw, Target, Search, ClipboardCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { getOrgSummary, getProjectProgress, getProjectExecutionAggregation, getExecutionState, getWorkOrderSummary, getExecutionEvents, downloadIPC } from '@/lib/operations-client'

interface SelectedProject { id: string; name: string; code?: string; completionPct?: number; totalUnits?: number; units?: any[]; boqItems?: any[] }
interface RemarkData { id: string; unitId: string | number; severity: string; status: string }

export function OperationsCenterScreen({ selectedProject, remarks = [] }: { selectedProject: SelectedProject | null; remarks?: RemarkData[] }) {
  const [summary, setSummary] = useState<any>(null)
  const [projects, setProjects] = useState<any>(null)
  const [workOrders, setWorkOrders] = useState<any>(null)
  const [execution, setExecution] = useState<any>(null)
  const [executionState, setExecutionState] = useState<any[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [unitSearch, setUnitSearch] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const [s, p, w, e, a, state] = await Promise.all([
        getOrgSummary(),
        getProjectProgress(),
        getWorkOrderSummary(),
        getExecutionEvents({ page: 1, page_size: 100 }),
        selectedProject ? getProjectExecutionAggregation(String(selectedProject.id)) : Promise.resolve({ data: null, error: undefined }),
        selectedProject ? getExecutionState(String(selectedProject.id)) : Promise.resolve({ data: { items: [] }, error: undefined }),
      ])
      const errors = [s.error, p.error, w.error, e.error, a.error, state.error].filter(Boolean)
      if (errors.length) setError(errors.join(' • '))
      setSummary(s.data); setProjects(p.data); setWorkOrders(w.data); setExecution(a.data); setExecutionState(state.data?.items || []); setEvents(e.data?.items || []); setLastLoadedAt(new Date())
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحديث مركز التشغيل') }
    finally { setLoading(false); setRefreshing(false) }
  }, [selectedProject])
  useEffect(() => { load() }, [load])

  const selectedProgress = useMemo(() => {
    if (!selectedProject) return null
    const fromExecution = execution?.summary?.overall_progress_pct
    if (typeof fromExecution === 'number') return { project_id: selectedProject.id, completion_pct: fromExecution }
    return projects?.items?.find((p: any) => String(p.project_id) === String(selectedProject.id)) || null
  }, [execution, projects, selectedProject])
  const units = useMemo(() => {
    const q = unitSearch.trim().toLowerCase()
    const executionUnits = new Map<string, any>((execution?.units || []).map((u: any) => [String(u.unit_id), u] as [string, any]))
    return (selectedProject?.units || []).map((u: any) => ({ ...u, completionPct: executionUnits.get(String(u.id))?.completion_pct ?? 0 })).filter((u: any) => !q || `${u.name || ''} ${u.code || ''}`.toLowerCase().includes(q))
  }, [execution, selectedProject, unitSearch])
  const selectedUnit = useMemo(() => units.find((u: any) => String(u.id) === String(selectedUnitId)) || units[0] || null, [units, selectedUnitId])
  const unitDetail = useMemo(() => {
    if (!selectedUnit) return null
    const states = executionState.filter((s: any) => String(s.unit_id) === String(selectedUnit.id))
    const catalog = selectedProject?.boqItems || []
    const items = states.length ? states.map((s: any) => ({ ...(catalog.find((b: any) => String(b.id) === String(s.boq_item_id)) || {}), id: s.boq_item_id, completion_pct: s.completion_pct, status: s.status, actual_quantity: s.actual_quantity })) : (selectedUnit.boqItems || [])
    const progressOf = (b: any) => Number(b.completionPct ?? b.completion_pct ?? b.achievement_pct ?? 0)
    const total = items.length
    const completed = items.filter((b: any) => progressOf(b) >= 100).length
    const inProgress = items.filter((b: any) => progressOf(b) > 0 && progressOf(b) < 100).length
    const pending = items.filter((b: any) => progressOf(b) === 0).length
    const progress = total ? Math.round(items.reduce((s: number, b: any) => s + progressOf(b), 0) / total) : Number(selectedUnit.completionPct ?? selectedUnit.completion_pct ?? 0)
    const unitRemarks = remarks.filter(r => String(r.unitId) === String(selectedUnit.id))
    const openRemarks = unitRemarks.filter(r => !['RESOLVED', 'CLOSED'].includes(String(r.status).toUpperCase()))
    const critical = openRemarks.filter(r => ['CRITICAL', 'MAJOR'].includes(String(r.severity).toUpperCase()))
    const boq = items.map((b: any) => ({ id: b.id, code: b.code ?? b.boqCode ?? b.boq_code ?? String(b.id), name: b.name ?? b.description ?? 'BOQ', progress: progressOf(b), status: b.status ?? '—', quality: b.quality ?? b.quality_pass ?? '—', planned: b.plannedQty ?? b.planned_qty ?? b.quantity, achieved: b.achievedQty ?? b.achieved_qty ?? b.actual_quantity })).sort((a: any, b: any) => b.progress - a.progress)
    return { total, completed, inProgress, pending, progress, openRemarks: openRemarks.length, critical: critical.length, boq }
  }, [executionState, selectedProject, selectedUnit, remarks])

  const filteredEvents = useMemo(() => events.filter(e => `${e.event_type} ${e.entity_id} ${e.reason || ''}`.toLowerCase().includes(search.toLowerCase())), [events, search])

  if (loading && !summary) return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>

  return <div className="space-y-6" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold">مركز التشغيل والتقارير</h2><p className="text-sm text-muted-foreground">استعادة رؤية الوحدة والـBOQ من تجربة التشغيل القديمة داخل بنية V4.</p></div><div className="flex items-center gap-2"><span className="text-[11px] text-muted-foreground hidden sm:inline">{lastLoadedAt ? `آخر تحديث ${lastLoadedAt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}` : ''}</span><Button variant="outline" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`ml-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />تحديث</Button><Button onClick={() => downloadIPC('xlsx', true)}><Download className="ml-2 h-4 w-4" />IPC Excel</Button></div></div>
    {selectedProject ? <Card className="border-emerald-200 bg-emerald-50/60"><CardContent className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-lg bg-emerald-100 p-2"><Target className="h-5 w-5 text-emerald-700" /></div><div><p className="text-xs text-emerald-700">سياق العمل الحالي</p><p className="font-bold text-emerald-950">{selectedProject.name}</p><p className="text-xs text-emerald-700">{selectedProject.code || `Project #${selectedProject.id}`}</p></div></div><div className="flex items-center gap-4"><div className="text-center"><p className="text-xs text-emerald-700">الإنجاز</p><p className="text-lg font-bold text-emerald-950">{selectedProgress?.completion_pct ?? 0}%</p></div><div className="text-center"><p className="text-xs text-emerald-700">الوحدات</p><p className="text-lg font-bold text-emerald-950">{selectedProject.totalUnits ?? selectedProject.units?.length ?? '—'}</p></div></div></div></CardContent></Card> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">لم يتم اختيار مشروع. اختر مشروعاً من الشريط العلوي حتى يبقى سياق العمل واضحاً أثناء التنقل.</div>}
    {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">تعذر تحميل جزء من بيانات مركز التشغيل: {error}</div>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['المشاريع',summary?.total_projects],['أوامر العمل',summary?.total_work_orders],['ملاحظات مفتوحة',summary?.open_remarks],['حالات حرجة',summary?.critical_remarks]].map(([k,v]) => <Card key={String(k)}><CardContent className="p-4"><span className="text-xs text-muted-foreground">{k}</span><p className="text-2xl font-bold mt-2">{v ?? 0}</p></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" />Unit 360 — الرادار التشغيلي</CardTitle></CardHeader><CardContent className="space-y-4"><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" /><Input className="pr-9" value={unitSearch} onChange={e => setUnitSearch(e.target.value)} placeholder="ابحث عن وحدة..." /></div><Badge variant="outline" className="self-center">{units.length} وحدة</Badge></div><div className="grid lg:grid-cols-[280px_1fr] gap-4"><div className="border rounded-lg max-h-96 overflow-auto">{units.map((u: any) => { const active = String(u.id) === String(selectedUnit?.id); const p = Number(u.completionPct ?? u.completion_pct ?? 0); return <button key={u.id} onClick={() => setSelectedUnitId(String(u.id))} className={`w-full text-right p-3 border-b last:border-b-0 ${active ? 'bg-emerald-50 border-r-4 border-r-emerald-500' : 'hover:bg-gray-50'}`}><div className="font-medium">{u.name}</div><div className="text-[10px] text-gray-500">{u.code || `#${u.id}`} · {p}%</div></button> })}{!units.length && <p className="p-5 text-center text-sm text-gray-500">لا توجد وحدات مطابقة أو بيانات الوحدات غير متاحة في سياق المشروع الحالي.</p>}</div>{selectedUnit && unitDetail ? <div className="border rounded-lg p-4 space-y-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs text-emerald-700">الوحدة المحددة</p><h3 className="text-xl font-bold">{selectedUnit.name}</h3><p className="text-xs text-gray-500">{selectedUnit.code || `#${selectedUnit.id}`}</p></div><div className="text-center"><p className="text-xs text-gray-500">التقدم</p><p className="text-2xl font-bold text-emerald-700">{unitDetail.progress}%</p></div></div><div className="grid grid-cols-2 md:grid-cols-4 gap-2"><Card><CardContent className="p-3"><p className="text-[11px] text-gray-500">البنود</p><b>{unitDetail.total}</b></CardContent></Card><Card><CardContent className="p-3"><p className="text-[11px] text-gray-500">مكتمل</p><b>{unitDetail.completed}</b></CardContent></Card><Card><CardContent className="p-3"><p className="text-[11px] text-gray-500">قيد التنفيذ</p><b>{unitDetail.inProgress}</b></CardContent></Card><Card><CardContent className="p-3"><p className="text-[11px] text-gray-500">ملاحظات مفتوحة</p><b>{unitDetail.openRemarks}</b>{unitDetail.critical > 0 && <Badge variant="destructive" className="mr-2">{unitDetail.critical} حرجة/كبرى</Badge>}</CardContent></Card></div><div className="flex flex-wrap gap-2"><Badge variant="outline"><ClipboardCheck className="h-3 w-3 ml-1" />{unitDetail.critical ? 'تحتاج اهتماماً' : 'لا توجد ملاحظات حرجة'}</Badge><Badge variant="outline">{unitDetail.completed}/{unitDetail.total} مكتمل</Badge><Badge variant="outline">{unitDetail.pending} لم يبدأ</Badge></div><div className="overflow-auto border rounded-lg"><table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="p-2 text-right">BOQ</th><th className="p-2 text-right">التقدم</th><th className="p-2 text-right">الحالة</th><th className="p-2 text-right">الجودة</th><th className="p-2 text-right">المنفذ/المخطط</th></tr></thead><tbody>{unitDetail.boq.map((b: any) => <tr key={b.id} className="border-t"><td className="p-2 font-medium">{b.code}<div className="text-[10px] text-gray-500">{b.name}</div></td><td className="p-2">{b.progress}%</td><td className="p-2">{String(b.status)}</td><td className="p-2">{String(b.quality)}</td><td className="p-2">{b.achieved ?? '—'} / {b.planned ?? '—'}</td></tr>)}</tbody></table></div></div> : <div className="flex items-center justify-center text-sm text-gray-500">اختر وحدة لعرض حالتها وتفصيل البنود.</div>}</div></CardContent></Card>
    <div className="grid lg:grid-cols-2 gap-4"><Card><CardHeader><CardTitle>تقدم المشاريع</CardTitle></CardHeader><CardContent className="space-y-2">{projects?.items?.map((p:any) => <div key={p.project_id} className={`flex justify-between border-b p-2 rounded ${selectedProject && String(p.project_id) === String(selectedProject.id) ? 'bg-emerald-50 font-semibold' : ''}`}><span>{p.project_name}</span><b>{p.completion_pct}%</b></div>)}</CardContent></Card><Card><CardHeader><CardTitle>أوامر العمل</CardTitle></CardHeader><CardContent className="space-y-2">{workOrders?.breakdown?.map((w:any) => <div key={w.status} className="flex justify-between border-b p-2"><Badge variant="outline">{w.status}</Badge><b>{w.count}</b></div>)}</CardContent></Card></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />سجل أحداث التنفيذ <Badge variant="outline">{filteredEvents.length}</Badge></CardTitle></CardHeader><CardContent><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في الأحداث..." /><div className="mt-4 space-y-2">{filteredEvents.map(e => <div key={e.event_id} className="border rounded-lg p-3 flex flex-wrap justify-between gap-2"><div><Badge variant="outline">{e.event_type}</Badge><span className="mr-2 text-xs font-mono">{e.entity_type}:{e.entity_id}</span></div><span className="text-xs text-muted-foreground">{e.reason || 'بدون سبب'}</span></div>)}{!filteredEvents.length && <p className="text-center text-sm text-muted-foreground py-6">لا توجد أحداث.</p>}</div></CardContent></Card>
  </div>
}
