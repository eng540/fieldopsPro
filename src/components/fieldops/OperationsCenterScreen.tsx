'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Download, History, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { getOrgSummary, getProjectProgress, getWorkOrderSummary, getExecutionEvents, downloadIPC } from '@/lib/operations-client'

export function OperationsCenterScreen({ selectedProject }: { selectedProject: { id: string; name: string } | null }) {
  const [summary, setSummary] = useState<any>(null)
  const [projects, setProjects] = useState<any>(null)
  const [workOrders, setWorkOrders] = useState<any>(null)
  const [events, setEvents] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const [s, p, w, e] = await Promise.all([getOrgSummary(), getProjectProgress(), getWorkOrderSummary(), getExecutionEvents({ page: 1, page_size: 100 })])
    if (s.error || p.error || w.error || e.error) setError([s.error, p.error, w.error, e.error].filter(Boolean).join(' • '))
    setSummary(s.data); setProjects(p.data); setWorkOrders(w.data); setEvents(e.data?.items || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = events.filter(e => `${e.event_type} ${e.entity_id} ${e.reason || ''}`.toLowerCase().includes(search.toLowerCase()))
  if (loading && !summary) return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>

  return <div className="space-y-6" dir="rtl">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-bold">مركز التشغيل والتقارير</h2><p className="text-sm text-muted-foreground">مؤشرات التشغيل وسجل أحداث التنفيذ والتقارير.</p></div><div className="flex gap-2"><Button variant="outline" onClick={load}><RefreshCw className="ml-2 h-4 w-4" />تحديث</Button><Button onClick={() => downloadIPC('xlsx', true)}><Download className="ml-2 h-4 w-4" />IPC Excel</Button></div></div>
    {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">تعذر تحميل جزء من بيانات مركز التشغيل: {error}</div>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['المشاريع',summary?.total_projects],['أوامر العمل',summary?.total_work_orders],['ملاحظات مفتوحة',summary?.open_remarks],['حالات حرجة',summary?.critical_remarks]].map(([k,v]) => <Card key={String(k)}><CardContent className="p-4"><span className="text-xs text-muted-foreground">{k}</span><p className="text-2xl font-bold mt-2">{v ?? 0}</p></CardContent></Card>)}</div>
    <div className="grid lg:grid-cols-2 gap-4"><Card><CardHeader><CardTitle>تقدم المشاريع</CardTitle></CardHeader><CardContent className="space-y-2">{projects?.items?.map((p:any) => <div key={p.project_id} className="flex justify-between border-b p-2"><span>{p.project_name}</span><b>{p.completion_pct}%</b></div>)}</CardContent></Card><Card><CardHeader><CardTitle>أوامر العمل</CardTitle></CardHeader><CardContent className="space-y-2">{workOrders?.breakdown?.map((w:any) => <div key={w.status} className="flex justify-between border-b p-2"><Badge variant="outline">{w.status}</Badge><b>{w.count}</b></div>)}</CardContent></Card></div>
    {selectedProject && <Card><CardHeader><CardTitle>المشروع الحالي: {selectedProject.name}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">المشروع محدد من الشريط العلوي.</p></CardContent></Card>}
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />سجل أحداث التنفيذ <Badge variant="outline">{events.length}</Badge></CardTitle></CardHeader><CardContent><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في الأحداث..." /><div className="mt-4 space-y-2">{filtered.map(e => <div key={e.event_id} className="border rounded-lg p-3 flex flex-wrap justify-between gap-2"><div><Badge variant="outline">{e.event_type}</Badge><span className="mr-2 text-xs font-mono">{e.entity_type}:{e.entity_id}</span></div><span className="text-xs text-muted-foreground">{e.reason || 'بدون سبب'}</span></div>)}{!filtered.length && <p className="text-center text-sm text-muted-foreground py-6">لا توجد أحداث.</p>}</div></CardContent></Card>
  </div>
}
