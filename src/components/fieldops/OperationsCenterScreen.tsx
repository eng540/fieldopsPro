'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, History, Loader2, RefreshCw, Target } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { getOrgSummary, getProjectProgress, getWorkOrderSummary, getExecutionEvents, downloadIPC } from '@/lib/operations-client'

interface SelectedProject {
  id: string
  name: string
  code?: string
  completionPct?: number
  totalUnits?: number
}

export function OperationsCenterScreen({ selectedProject }: { selectedProject: SelectedProject | null }) {
  const [summary, setSummary] = useState<any>(null)
  const [projects, setProjects] = useState<any>(null)
  const [workOrders, setWorkOrders] = useState<any>(null)
  const [events, setEvents] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [s, p, w, e] = await Promise.all([
        getOrgSummary(),
        getProjectProgress(),
        getWorkOrderSummary(),
        getExecutionEvents({ page: 1, page_size: 100 }),
      ])
      const errors = [s.error, p.error, w.error, e.error].filter(Boolean)
      if (errors.length) setError(errors.join(' • '))
      setSummary(s.data)
      setProjects(p.data)
      setWorkOrders(w.data)
      setEvents(e.data?.items || [])
      setLastLoadedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث مركز التشغيل')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const projectEvents = useMemo(() => {
    if (!selectedProject) return events
    // Execution events carry the entity identifier but not every event is project-scoped.
    // Keep events visible rather than silently hiding valid org-level governance events.
    return events
  }, [events, selectedProject])

  const filtered = projectEvents.filter(e => `${e.event_type} ${e.entity_id} ${e.reason || ''}`.toLowerCase().includes(search.toLowerCase()))
  const selectedProgress = useMemo(() => {
    if (!selectedProject || !projects?.items) return null
    return projects.items.find((p: any) => String(p.project_id) === String(selectedProject.id)) || null
  }, [projects, selectedProject])

  if (loading && !summary) return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>

  return <div className="space-y-6" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-2xl font-bold">مركز التشغيل والتقارير</h2><p className="text-sm text-muted-foreground">مؤشرات التشغيل وسجل أحداث التنفيذ والتقارير.</p></div>
      <div className="flex items-center gap-2"><span className="text-[11px] text-muted-foreground hidden sm:inline">{lastLoadedAt ? `آخر تحديث ${lastLoadedAt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}` : ''}</span><Button variant="outline" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`ml-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />تحديث</Button><Button onClick={() => downloadIPC('xlsx', true)}><Download className="ml-2 h-4 w-4" />IPC Excel</Button></div>
    </div>

    {selectedProject ? <Card className="border-emerald-200 bg-emerald-50/60"><CardContent className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-lg bg-emerald-100 p-2"><Target className="h-5 w-5 text-emerald-700" /></div><div><p className="text-xs text-emerald-700">سياق العمل الحالي</p><p className="font-bold text-emerald-950">{selectedProject.name}</p><p className="text-xs text-emerald-700">{selectedProject.code || `Project #${selectedProject.id}`}</p></div></div><div className="flex items-center gap-4"><div className="text-center"><p className="text-xs text-emerald-700">الإنجاز</p><p className="text-lg font-bold text-emerald-950">{selectedProgress?.completion_pct ?? selectedProject.completionPct ?? 0}%</p></div><div className="text-center"><p className="text-xs text-emerald-700">الوحدات</p><p className="text-lg font-bold text-emerald-950">{selectedProject.totalUnits ?? '—'}</p></div></div></div></CardContent></Card> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">لم يتم اختيار مشروع. اختر مشروعاً من الشريط العلوي حتى يبقى سياق العمل واضحاً أثناء التنقل.</div>}

    {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">تعذر تحميل جزء من بيانات مركز التشغيل: {error}</div>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['المشاريع',summary?.total_projects],['أوامر العمل',summary?.total_work_orders],['ملاحظات مفتوحة',summary?.open_remarks],['حالات حرجة',summary?.critical_remarks]].map(([k,v]) => <Card key={String(k)}><CardContent className="p-4"><span className="text-xs text-muted-foreground">{k}</span><p className="text-2xl font-bold mt-2">{v ?? 0}</p></CardContent></Card>)}</div>
    <div className="grid lg:grid-cols-2 gap-4"><Card><CardHeader><CardTitle>تقدم المشاريع</CardTitle></CardHeader><CardContent className="space-y-2">{projects?.items?.map((p:any) => <div key={p.project_id} className={`flex justify-between border-b p-2 rounded ${selectedProject && String(p.project_id) === String(selectedProject.id) ? 'bg-emerald-50 font-semibold' : ''}`}><span>{p.project_name}</span><b>{p.completion_pct}%</b></div>)}</CardContent></Card><Card><CardHeader><CardTitle>أوامر العمل</CardTitle></CardHeader><CardContent className="space-y-2">{workOrders?.breakdown?.map((w:any) => <div key={w.status} className="flex justify-between border-b p-2"><Badge variant="outline">{w.status}</Badge><b>{w.count}</b></div>)}</CardContent></Card></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />سجل أحداث التنفيذ <Badge variant="outline">{filtered.length}</Badge></CardTitle></CardHeader><CardContent><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في الأحداث..." /><div className="mt-4 space-y-2">{filtered.map(e => <div key={e.event_id} className="border rounded-lg p-3 flex flex-wrap justify-between gap-2"><div><Badge variant="outline">{e.event_type}</Badge><span className="mr-2 text-xs font-mono">{e.entity_type}:{e.entity_id}</span></div><span className="text-xs text-muted-foreground">{e.reason || 'بدون سبب'}</span></div>)}{!filtered.length && <p className="text-center text-sm text-muted-foreground py-6">لا توجد أحداث.</p>}</div></CardContent></Card>
  </div>
}
