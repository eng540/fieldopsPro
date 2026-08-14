'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Download, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getReportingSummary, getProjectProgress, getWorkOrderSummary, downloadIPC } from '@/lib/legacy-capabilities-api'

export function LegacyReportsScreen() {
  const [summary, setSummary] = useState<any>(null)
  const [projects, setProjects] = useState<any>(null)
  const [workOrders, setWorkOrders] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const load = async () => { setLoading(true); try { const [a,b,c] = await Promise.all([getReportingSummary(), getProjectProgress(), getWorkOrderSummary()]); setSummary(a); setProjects(b); setWorkOrders(c) } finally { setLoading(false) } }
  useEffect(() => { load().catch(console.error) }, [])

  const exportIPC = async (format: 'csv'|'xlsx') => { setExporting(true); try { const { blob, filename } = await downloadIPC(format); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url) } finally { setExporting(false) } }

  if (loading) return <div className="flex justify-center p-12"><RefreshCw className="animate-spin"/></div>
  const cards = summary ? [['المشاريع',summary.total_projects],['المشاريع النشطة',summary.active_projects],['أوامر العمل',summary.total_work_orders],['الأعمال المكتملة',summary.completed_work_orders],['الملاحظات المفتوحة',summary.open_remarks],['ملاحظات حرجة',summary.critical_remarks],['حالات HOLD',summary.governance_holds]] : []

  return <div className="space-y-5">
    <div className="flex items-center justify-between"><div><h2 className="text-2xl font-bold">التقارير والتحليلات</h2><p className="text-sm text-gray-500 mt-1">لوحة تنفيذية + تقدم المشاريع + أوامر العمل + IPC</p></div><Button variant="outline" onClick={()=>load()}><RefreshCw className="w-4 h-4 ml-1"/>تحديث</Button></div>
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">{cards.map(([label,value])=><div key={String(label)} className="bg-white border rounded-xl p-4"><p className="text-xs text-gray-500">{label}</p><p className="text-2xl font-bold mt-1">{value}</p></div>)}</div>
    <div className="grid lg:grid-cols-2 gap-4"><div className="bg-white border rounded-xl p-5"><div className="flex justify-between mb-4"><h3 className="font-bold">تقدم المشاريع</h3><Badge variant="outline">متوسط {projects?.org_avg_completion ?? 0}%</Badge></div><div className="space-y-3">{(projects?.items || []).map((p:any)=><div key={p.project_id}><div className="flex justify-between text-xs mb-1"><span>{p.project_name}</span><b>{p.completion_pct}%</b></div><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{width:`${Math.min(100,p.completion_pct)}%`}}/></div><div className="text-[10px] text-gray-500 mt-1">{p.open_remarks} ملاحظات مفتوحة · {p.active_work_orders} أوامر قيد التنفيذ</div></div>)}</div></div>
    <div className="bg-white border rounded-xl p-5"><h3 className="font-bold mb-4">حالة أوامر العمل</h3><div className="space-y-2">{(workOrders?.breakdown || []).map((w:any)=><div key={w.status} className="flex items-center justify-between border rounded-lg p-3"><span>{w.status}</span><div className="flex gap-3"><Badge>{w.count}</Badge><span className="text-xs text-gray-500">متوسط {w.avg_completion_pct}%</span></div></div>)}</div></div></div>
    <div className="bg-white border rounded-xl p-5"><div className="flex items-center gap-2 mb-4"><BarChart3 className="w-5 h-5 text-emerald-600"/><h3 className="font-bold">التصدير التشغيلي والمالي</h3></div><p className="text-sm text-gray-500 mb-4">تصدير IPC مبني على قرارات الحوكمة، مع إبقاء حالات HOLD ظاهرة ومعلّمة.</p><div className="flex flex-wrap gap-2"><Button onClick={()=>exportIPC('xlsx')} disabled={exporting}><FileSpreadsheet className="w-4 h-4 ml-1"/>IPC Excel</Button><Button variant="outline" onClick={()=>exportIPC('csv')} disabled={exporting}><FileText className="w-4 h-4 ml-1"/>IPC CSV</Button><Button variant="outline" disabled><Download className="w-4 h-4 ml-1"/>PDF التنفيذي — المرحلة التالية</Button></div></div>
  </div>
}
