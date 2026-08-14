'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Save, RefreshCw, AlertTriangle, Search, RotateCcw, CheckCircle2, Clock3, XCircle, ClipboardCheck } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getExecutionState, queueProgressOffline, submitProgressEvent } from '@/lib/execution-client'
import { isOnline } from '@/lib/api-client'

const STATUS: Record<string, { label: string; pct: number; icon: any }> = {
  NOT_STARTED: { label: 'لم يبدأ', pct: 0, icon: Clock3 },
  IN_PROGRESS: { label: 'قيد العمل', pct: 50, icon: Clock3 },
  COMPLETE: { label: 'مكتمل', pct: 100, icon: CheckCircle2 },
  INSPECTION: { label: 'بانتظار الفحص', pct: 100, icon: ClipboardCheck },
  ACCEPTED: { label: 'مقبول', pct: 100, icon: CheckCircle2 },
  REWORK: { label: 'إعادة تنفيذ', pct: 0, icon: RotateCcw },
  REJECTED: { label: 'مرفوض', pct: 0, icon: XCircle },
}

interface Props { project: any | null; orgId: string; onRefresh: () => void }

export function ExecutionProgressScreen({ project, orgId, onRefresh }: Props) {
  const { toast } = useToast()
  const [values, setValues] = useState<Record<string, number>>({})
  const [versions, setVersions] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [rework, setRework] = useState<{ key: string; unitId: number; boqId: number; current: number; next: number } | null>(null)
  const [reason, setReason] = useState('')
  const [bulkValue, setBulkValue] = useState('')

  const rows = useMemo(() => project?.units?.flatMap((u: any) => (u.boqItems || []).map((b: any) => ({ unit: u, boq: b, key: `${u.id}:${b.id}` }))) || [], [project])

  const load = useCallback(async () => {
    if (!rows.length) return
    const next: Record<string, number> = {}; const vers: Record<string, number> = {}; const sts: Record<string, string> = {}
    for (const r of rows) {
      try {
        const s = await getExecutionState(Number(r.unit.id), Number(r.boq.id))
        const pct = s?.completion_pct ?? r.boq.completionPct ?? 0
        next[r.key] = pct; vers[r.key] = s?.state_version ?? 1
        sts[r.key] = pct >= 100 ? 'COMPLETE' : pct > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'
      } catch { next[r.key] = r.boq.completionPct ?? 0; vers[r.key] = 1; sts[r.key] = 'NOT_STARTED' }
    }
    setValues(next); setDrafts(next); setVersions(vers); setStatus(sts)
  }, [rows])

  useEffect(() => { load() }, [load])

  const visibleRows = useMemo(() => rows.filter((r: any) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || String(r.unit.name || '').toLowerCase().includes(q) || String(r.unit.code || '').toLowerCase().includes(q) || String(r.boq.description || '').toLowerCase().includes(q)
    const matchesStatus = filter === 'ALL' || status[r.key] === filter
    return matchesSearch && matchesStatus
  }), [rows, search, filter, status])

  const dirtyRows = rows.filter((r: any) => drafts[r.key] !== values[r.key])

  const saveOne = async (r: any, next: number) => {
    const current = values[r.key] ?? 0
    if (next === current) return
    if (next < current) { setRework({ key: r.key, unitId: Number(r.unit.id), boqId: Number(r.boq.id), current, next }); return }
    await submitProgressEvent({ unitId: Number(r.unit.id), boqItemId: Number(r.boq.id), expectedVersion: versions[r.key] || 1, completionPct: next, currentPct: current })
    setValues(v => ({ ...v, [r.key]: next })); setDrafts(v => ({ ...v, [r.key]: next })); setStatus(v => ({ ...v, [r.key]: next >= 100 ? 'COMPLETE' : 'IN_PROGRESS' }));
  }

  const saveAll = async () => {
    if (!dirtyRows.length) return
    setBusy(true); let saved = 0
    try {
      for (const r of dirtyRows) {
        try { await saveOne(r, drafts[r.key] ?? 0); saved++ }
        catch (e) {
          if (!isOnline()) { await queueProgressOffline(orgId, { unitId: String(r.unit.id), boqItemId: String(r.boq.id), completionPct: drafts[r.key] ?? 0, reworkFlag: false, reworkReason: '' }); setValues(v => ({ ...v, [r.key]: drafts[r.key] ?? 0 })); setStatus(v => ({ ...v, [r.key]: 'IN_PROGRESS' })); saved++ }
          else throw e
        }
      }
      await load(); onRefresh(); toast({ title: saved === dirtyRows.length ? 'تم حفظ التغييرات' : 'تم حفظ جزء من التغييرات', description: `${saved} بند` })
    } catch (e) { toast({ title: 'تعذر إكمال الحفظ', description: String(e), variant: 'destructive' }) }
    finally { setBusy(false) }
  }

  const applyBulk = () => {
    const n = Number(bulkValue)
    if (!Number.isFinite(n) || n < 0 || n > 100) return
    setDrafts(d => { const copy = { ...d }; visibleRows.forEach((r: any) => { copy[r.key] = n }); return copy })
  }

  const setRowStatus = (r: any, key: string) => {
    const item = STATUS[key]; if (!item) return
    setStatus(s => ({ ...s, [r.key]: key })); setDrafts(d => ({ ...d, [r.key]: item.pct }))
  }

  const confirmRework = async () => {
    if (!rework || reason.trim().length < 20) return
    setBusy(true)
    try {
      await submitProgressEvent({ unitId: rework.unitId, boqItemId: rework.boqId, expectedVersion: versions[rework.key] || 1, completionPct: rework.next, currentPct: rework.current, reworkReason: reason.trim() })
      setValues(v => ({ ...v, [rework.key]: rework.next })); setDrafts(v => ({ ...v, [rework.key]: rework.next })); setStatus(v => ({ ...v, [rework.key]: 'REWORK' }))
      setRework(null); setReason(''); await load(); onRefresh(); toast({ title: 'تم تسجيل إعادة التنفيذ' })
    } catch (e) { toast({ title: 'تعذر تسجيل إعادة التنفيذ', description: String(e), variant: 'destructive' }) }
    finally { setBusy(false) }
  }

  if (!project) return <Card className="border-dashed"><CardContent className="p-10 text-center text-gray-500">اختر مشروعاً لبدء تسجيل التنفيذ</CardContent></Card>

  return <div className="space-y-4">
    <Alert><AlertTriangle className="w-4 h-4" /><AlertDescription>الإدخال السريع يدعم التعديل الجماعي والحفظ الموحد، مع بقاء كل تغيير داخل Event Pipeline وOptimistic Locking. خفض الإنجاز يتطلب سبب إعادة تنفيذ.</AlertDescription></Alert>
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
      <div><h2 className="text-2xl font-bold">مصفوفة الإدخال السريع</h2><p className="text-sm text-gray-500">{project.name} — {rows.length} بنداً في {project.units?.length || 0} وحدة</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={load} disabled={busy}><RefreshCw className="w-4 h-4 ml-1" />تحديث</Button><Button onClick={saveAll} disabled={busy || !dirtyRows.length}>{busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Save className="w-4 h-4 ml-1" />}حفظ {dirtyRows.length ? `(${dirtyRows.length})` : ''}</Button></div>
    </div>
    <Card><CardContent className="p-3"><div className="grid grid-cols-1 md:grid-cols-4 gap-2"><div className="relative md:col-span-2"><Search className="absolute right-3 top-2.5 w-4 h-4 text-gray-400" /><Input className="pr-9" placeholder="بحث بالوحدة أو البند..." value={search} onChange={e => setSearch(e.target.value)} /></div><Select value={filter} onValueChange={setFilter}><SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger><SelectContent><SelectItem value="ALL">كل الحالات</SelectItem>{Object.entries(STATUS).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select><div className="flex gap-2"><Input type="number" min="0" max="100" placeholder="% جماعي" value={bulkValue} onChange={e => setBulkValue(e.target.value)} /><Button variant="outline" onClick={applyBulk} disabled={!bulkValue}>تطبيق</Button></div></div></CardContent></Card>
    <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center justify-between"><span>سجل التشغيل</span><Badge variant="outline">{visibleRows.length} معروض</Badge></CardTitle></CardHeader><CardContent><div className="overflow-auto max-h-[65vh]"><table className="w-full text-sm min-w-[900px]"><thead className="sticky top-0 bg-white z-10"><tr className="border-b text-right"><th className="p-2">الوحدة</th><th className="p-2">البند</th><th className="p-2">الكمية</th><th className="p-2 w-28">الإنجاز %</th><th className="p-2 w-44">الحالة</th><th className="p-2">التغيير</th></tr></thead><tbody>{visibleRows.map((r: any) => { const current = values[r.key] ?? 0; const draft = drafts[r.key] ?? current; const dirty = draft !== current; const S = STATUS[status[r.key] || 'NOT_STARTED']; const Icon = S?.icon || Clock3; return <tr key={r.key} className={`border-b hover:bg-gray-50 ${dirty ? 'bg-amber-50' : ''}`}><td className="p-2 font-medium">{r.unit.name}<div className="text-[10px] text-gray-400">{r.unit.code || `#${r.unit.id}`}</div></td><td className="p-2 max-w-[320px]">{r.boq.description}</td><td className="p-2">{r.boq.quantity} {r.boq.unitOfMeasure}</td><td className="p-2"><Input type="number" min="0" max="100" value={draft} onChange={e => setDrafts(v => ({ ...v, [r.key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} className="w-24" /></td><td className="p-2"><Select value={status[r.key] || 'NOT_STARTED'} onValueChange={v => setRowStatus(r, v)}><SelectTrigger className="h-8"><div className="flex items-center gap-1"><Icon className="w-3.5 h-3.5" /><span>{S?.label}</span></div></SelectTrigger><SelectContent>{Object.entries(STATUS).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></td><td className="p-2"><span className={`text-xs ${dirty ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>{dirty ? `${current}% → ${draft}%` : 'لا تغيير'}</span></td></tr> })}</tbody></table></div></CardContent></Card>
    <div className="flex flex-wrap gap-2 text-xs text-gray-500"><span>المعروض: {visibleRows.length}</span><span>•</span><span>تعديلات غير محفوظة: {dirtyRows.length}</span><span>•</span><span>المشروع: {project.name}</span></div>
    <Dialog open={!!rework} onOpenChange={v => !v && setRework(null)}><DialogContent><DialogHeader><DialogTitle>تأكيد إعادة التنفيذ</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-sm">سيتم خفض الإنجاز من {rework?.current}% إلى {rework?.next}%.</p><Label>سبب إعادة التنفيذ — 20 حرفاً على الأقل</Label><Textarea value={reason} onChange={e => setReason(e.target.value)} /><p className="text-xs text-gray-500">{reason.trim().length}/20</p></div><DialogFooter><Button variant="outline" onClick={() => setRework(null)}>إلغاء</Button><Button disabled={busy || reason.trim().length < 20} onClick={confirmRework}>تأكيد</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
