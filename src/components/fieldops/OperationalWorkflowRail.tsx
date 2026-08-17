'use client'

import React, { useMemo } from 'react'
import { ArrowLeft, ClipboardCheck, FileSpreadsheet, FileText, ListChecks, Plus, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface ProjectLike {
  id: string
  name: string
  code: string
  completionPct: number
  executionSummary?: { overallProgressPct?: number; trackedBoqItems?: number } | null
  units?: Array<{ id: string; completionPct: number; boqItems?: Array<{ completionPct: number }> }>
}

interface RemarkLike { unitId: string; status: string; severity: string }

interface Props {
  project: ProjectLike | null
  remarks: RemarkLike[]
  online: boolean
  pendingCount: number
  onNavigate: (tab: string) => void
}

const OPEN = new Set(['OPEN', 'IN_REVIEW'])
const BLOCKING = new Set(['MAJOR', 'CRITICAL'])

/**
 * Unified field workflow inspired by the legacy Ncrpro110 interaction model.
 * It deliberately orchestrates existing V4 screens instead of replacing them:
 * select project -> enter progress -> record diary -> inspect/resolve quality -> report.
 */
export function OperationalWorkflowRail({ project, remarks, online, pendingCount, onNavigate }: Props) {
  const metrics = useMemo(() => {
    const unitIds = new Set((project?.units || []).map(u => u.id))
    const scoped = remarks.filter(r => unitIds.has(r.unitId))
    const open = scoped.filter(r => OPEN.has(r.status))
    const blocking = open.filter(r => BLOCKING.has(r.severity))
    const boq = (project?.units || []).flatMap(u => u.boqItems || [])
    const boqProgress = Number(project?.executionSummary?.overallProgressPct ?? (boq.length ? Math.round(boq.reduce((sum, x) => sum + Number(x.completionPct || 0), 0) / boq.length) : Number(project?.completionPct || 0)))
    return { open: open.length, blocking: blocking.length, boqProgress }
  }, [project, remarks])

  if (!project) {
    return <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">اختر مشروعاً من الشريط العلوي لبدء دورة التشغيل.</div>
  }

  return (
    <section className="mb-5 rounded-2xl border bg-white shadow-sm" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-emerald-600"/><h2 className="font-bold">مسار التشغيل الموحّد</h2><Badge variant="outline">{project.code}</Badge></div>
          <p className="mt-1 text-xs text-gray-500">من الإدخال الميداني إلى الجودة ثم التقرير — كل العمليات مرتبطة بالمشروع الحالي.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {online ? <Badge variant="outline" className="text-emerald-700"><Wifi className="ml-1 h-3 w-3"/>متصل</Badge> : <Badge variant="outline" className="text-amber-700"><WifiOff className="ml-1 h-3 w-3"/>أوفلاين</Badge>}
          {pendingCount > 0 && <Badge variant="outline">طابور: {pendingCount}</Badge>}
        </div>
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <Step index="1" title="الإدخال السريع" detail={`${metrics.boqProgress}% BOQ`} icon={<Plus className="h-4 w-4"/>} onClick={() => onNavigate('speed-entry')} primary />
        <Step index="2" title="سجل الموقع" detail="اليوم + GPS + مسودة" icon={<FileText className="h-4 w-4"/>} onClick={() => onNavigate('diary')} />
        <Step index="3" title="الجودة" detail={metrics.open ? `${metrics.open} مفتوحة` : 'لا توجد مفتوحة'} icon={<ClipboardCheck className="h-4 w-4"/>} onClick={() => onNavigate('quality')} danger={metrics.blocking > 0} />
        <Step index="4" title="الاستيراد الجماعي" detail="Bulk / Excel" icon={<FileSpreadsheet className="h-4 w-4"/>} onClick={() => onNavigate('bulk-import')} />
        <Step index="5" title="التقرير" detail="Progress / Quality / IPC" icon={<ArrowLeft className="h-4 w-4"/>} onClick={() => onNavigate('reports')} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t bg-gray-50 px-4 py-2 text-[11px] text-gray-600">
        <span>الإنجاز: <b>{project.completionPct}%</b></span><span>•</span><span>BOQ: <b>{metrics.boqProgress}%</b></span><span>•</span><span>جودة مفتوحة: <b>{metrics.open}</b></span><span>•</span><span>حرجة/رئيسية: <b>{metrics.blocking}</b></span>
        <Button variant="ghost" size="sm" className="mr-auto h-6 px-2 text-[11px]" onClick={() => onNavigate('mobile')}><RefreshCw className="ml-1 h-3 w-3"/>المزامنة والميدان</Button>
      </div>
    </section>
  )
}

function Step({ index, title, detail, icon, onClick, primary = false, danger = false }: { index: string; title: string; detail: string; icon: React.ReactNode; onClick: () => void; primary?: boolean; danger?: boolean }) {
  return <Button type="button" variant="outline" onClick={onClick} className={`h-auto min-h-[72px] justify-start gap-3 rounded-xl px-3 py-2 text-right ${primary ? 'border-emerald-300 bg-emerald-50/60' : ''} ${danger ? 'border-red-200 bg-red-50/50' : ''}`}>
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold">{index}</span>
    <span className="min-w-0"><span className="flex items-center gap-1 text-sm font-semibold">{icon}{title}</span><span className="mt-1 block truncate text-[11px] font-normal text-gray-500">{detail}</span></span>
  </Button>
}
