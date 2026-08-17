'use client'

import React, { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileText, TrendingUp, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Remark { id: string; unitId: string; severity: string; status: string; customIssue?: string | null }
interface Unit { id: string; name: string; code: string; completionPct: number; boqItems?: { completionPct: number }[] }
interface Project { id: string; name: string; code: string; completionPct: number; executionSummary?: { overallProgressPct?: number; trackedBoqItems?: number } | null; units?: Unit[] }

interface Props {
  project: Project | null
  remarks: Remark[]
  onNavigate: (tab: string) => void
}

const OPEN = new Set(['OPEN', 'IN_REVIEW'])
const BLOCKING = new Set(['MAJOR', 'CRITICAL'])

export function ProjectWorkflowBridge({ project, remarks, onNavigate }: Props) {
  const data = useMemo(() => {
    const units = project?.units || []
    const projectRemarks = remarks.filter(r => units.some(u => u.id === r.unitId))
    const open = projectRemarks.filter(r => OPEN.has(r.status))
    const blocking = open.filter(r => BLOCKING.has(r.severity))
    const resolved = projectRemarks.filter(r => ['RESOLVED', 'CLOSED'].includes(r.status))
    const unitsWithBlocking = new Set(blocking.map(r => r.unitId)).size
    const unitsWithOpen = new Set(open.map(r => r.unitId)).size
    const qualityClosure = projectRemarks.length ? Math.round((resolved.length / projectRemarks.length) * 100) : 100
    const acceptedUnits = units.filter(u => u.completionPct >= 100 && !open.some(r => r.unitId === u.id)).length
    const progressFromBoq = units.flatMap(u => u.boqItems || [])
    const boqProgress = Number(project?.executionSummary?.overallProgressPct ?? (progressFromBoq.length
      ? Math.round(progressFromBoq.reduce((s, b) => s + Number(b.completionPct || 0), 0) / progressFromBoq.length)
      : Number(project?.completionPct || 0)))
    const projectProgress = Number(project?.executionSummary?.overallProgressPct ?? project?.completionPct ?? 0)
    const rollup = Math.round((projectProgress * 0.7) + (boqProgress * 0.3))
    return { open, blocking, resolved, unitsWithBlocking, unitsWithOpen, qualityClosure, acceptedUnits, boqProgress, rollup }
  }, [project, remarks])

  if (!project) return null

  const gatePass = data.blocking.length === 0
  const qualityReady = gatePass && data.open.length === 0

  return (
    <div className="space-y-4 mb-6" dir="rtl">
      <Card className="border-0 shadow-sm bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              <CardTitle className="text-base">دورة المشروع — الإنجاز → الجودة → الاعتماد</CardTitle>
            </div>
            <Badge variant="outline" className="text-xs">{project.code}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="إنجاز المشروع" value={`${Number(project.executionSummary?.overallProgressPct ?? project.completionPct ?? 0)}%`} />
            <Metric label="إنجاز BOQ" value={`${data.boqProgress}%`} />
            <Metric label="إغلاق الجودة" value={`${data.qualityClosure}%`} />
            <Metric label="Roll-up" value={`${data.rollup}%`} />
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <GateCard
              title="Quality Gate"
              icon={<ClipboardCheck className="w-4 h-4" />}
              ok={gatePass}
              text={gatePass ? 'لا توجد ملاحظات رئيسية/حرجة مفتوحة' : `${data.blocking.length} ملاحظة تعيق الاعتماد`}
              action="فتح الجودة"
              onClick={() => onNavigate('quality')}
            />
            <GateCard
              title="وحدات جاهزة"
              icon={<CheckCircle2 className="w-4 h-4" />}
              ok={data.acceptedUnits > 0}
              text={`${data.acceptedUnits} وحدة مكتملة بدون ملاحظات مفتوحة`}
              action="الإدخال السريع"
              onClick={() => onNavigate('speed-entry')}
            />
            <GateCard
              title="الحالة التشغيلية"
              icon={data.open.length ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              ok={!data.open.length}
              text={data.open.length ? `${data.unitsWithOpen} وحدة لديها ملاحظات مفتوحة` : 'لا توجد ملاحظات مفتوحة'}
              action="التقارير"
              onClick={() => onNavigate('reports')}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge className={gatePass ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-red-100 text-red-800 border-red-200'} variant="outline">
              {gatePass ? 'بوابة الجودة: PASS' : 'بوابة الجودة: BLOCKED'}
            </Badge>
            <Badge variant="outline">ملاحظات مفتوحة: {data.open.length}</Badge>
            <Badge variant="outline">رئيسية/حرجة: {data.blocking.length}</Badge>
            <Badge variant="outline">وحدات متأثرة: {data.unitsWithOpen}</Badge>
            <span className="text-xs text-gray-400 mr-auto">الاعتماد النهائي يتطلب إغلاق الملاحظات المفتوحة.</span>
            {qualityReady && <Button size="sm" variant="outline" onClick={() => onNavigate('reports')}><FileText className="w-3.5 h-3.5 ml-1" />جاهز للتقرير</Button>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-gray-50 p-3"><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold mt-1">{value}</p></div>
}

function GateCard({ title, icon, ok, text, action, onClick }: { title: string; icon: React.ReactNode; ok: boolean; text: string; action: string; onClick: () => void }) {
  return (
    <div className={`rounded-xl border p-3 ${ok ? 'border-emerald-100 bg-emerald-50/40' : 'border-amber-100 bg-amber-50/40'}`}>
      <div className="flex items-center gap-2 font-semibold text-sm">{icon}{title}</div>
      <p className="text-xs text-gray-600 mt-2 min-h-8">{text}</p>
      <Button variant="ghost" size="sm" className="h-7 px-0 text-xs" onClick={onClick}>{action}</Button>
    </div>
  )
}
