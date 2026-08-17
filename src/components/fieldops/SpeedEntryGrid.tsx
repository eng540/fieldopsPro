'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AlertTriangle, CheckCircle2, Loader2, Save, Search, RotateCcw } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getExecutionState, listExecutionState, submitProgressEvent, queueProgressOffline } from '@/lib/execution-client'
import { isOnline } from '@/lib/api-client'
import { BulkExecutionActions } from './BulkExecutionActions'

interface Props { project: any | null; orgId: string; onRefresh: () => void }
interface Cell { unitId: number; boqId: number; value: number; original: number }

/** Project BOQ is the definition; Unit x BOQ execution state is the operational value. */
export function SpeedEntryGrid({ project, orgId, onRefresh }: Props) {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [selectedUnits, setSelectedUnits] = useState<Set<number>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, Cell>>({})
  const [executionStates, setExecutionStates] = useState<Record<string, { completion_pct: number; state_version: number }>>({})
  const [busy, setBusy] = useState(false)
  const [loadingState, setLoadingState] = useState(false)
  const [rework, setRework] = useState<{ key: string; cell: Cell; next: number } | null>(null)
  const [reason, setReason] = useState('')

  const units = useMemo(() => {
    const raw = Array.isArray(project?.units) ? project.units : []
    const q = search.trim().toLowerCase()
    return raw.filter((u:any) => !q || `${u.name??''} ${u.code??''}`.toLowerCase().includes(q))
  }, [project, search])

  const boqColumns = useMemo(() => {
    const source = Array.isArray(project?.boqItems) ? project.boqItems : []
    if (source.length) return source
    const map = new Map<number,any>()
    for (const u of units) for (const i of u.boqItems || []) if (!map.has(Number(i.id))) map.set(Number(i.id), i)
    return Array.from(map.values())
  }, [project, units])

  useEffect(() => {
    let active = true
    async function load() {
      if (!project?.id) { setExecutionStates({}); return }
      setLoadingState(true)
      try {
        const result = await listExecutionState(project.id, 500)
        if (!active) return
        const next: Record<string, { completion_pct: number; state_version: number }> = {}
        for (const row of result.items || []) next[`${row.unit_id}:${row.boq_item_id}`] = { completion_pct: Number(row.completion_pct || 0), state_version: Number(row.state_version || 1) }
        setExecutionStates(next)
      } catch {
        if (active) toast({ title: 'تعذر تحميل حالة التنفيذ', description: 'سيتم استخدام الحالة المحلية حتى تتوفر البيانات.', variant: 'destructive' })
      } finally {
        if (active) setLoadingState(false)
      }
    }
    load()
    return () => { active = false }
  }, [project?.id, toast])

  const keyFor = (unitId:number, boqId:number) => `${unitId}:${boqId}`
  const getCell = (u:any, b:any):Cell => {
    const key = keyFor(Number(u.id), Number(b.id))
    if (drafts[key]) return drafts[key]
    const state = executionStates[key]
    const v = Number(state?.completion_pct ?? 0)
    return { unitId:Number(u.id), boqId:Number(b.id), value:v, original:v }
  }
  const setCell = (u:any,b:any,raw:string) => {
    const v = Math.max(0, Math.min(100, Number(raw) || 0))
    const c = getCell(u,b)
    setDrafts(d => ({ ...d, [keyFor(c.unitId,c.boqId)]: { ...c, value:v } }))
  }
  const visibleCells = useMemo(() => {
    const a:Cell[] = []
    for (const u of units) for (const b of boqColumns) if ((u.boqItems || []).some((x:any) => Number(x.id) === Number(b.id))) a.push(getCell(u,b))
    return a
  }, [units, boqColumns, drafts, executionStates])
  const dirtyCells = visibleCells.filter(c => c.value !== c.original)
  const toggleUnit = (id:number) => setSelectedUnits(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelectedUnits(prev => prev.size === units.length ? new Set() : new Set(units.map((u:any) => Number(u.id))))
  const applyBulk = (unitIds:number[],boqIds:number[],value:number) => setDrafts(current => {
    const next = {...current}
    for (const u of units) if (unitIds.includes(Number(u.id))) for (const b of (u.boqItems || [])) if (boqIds.includes(Number(b.id))) { const c=getCell(u,b); next[keyFor(c.unitId,c.boqId)]={...c,value} }
    return next
  })

  const saveCell = async (c:Cell) => {
    if (c.value === c.original) return
    if (c.value < c.original) { setRework({key:keyFor(c.unitId,c.boqId),cell:c,next:c.value}); return }
    try {
      const state = await getExecutionState(c.unitId,c.boqId)
      await submitProgressEvent({unitId:c.unitId,boqItemId:c.boqId,expectedVersion:Number(state?.state_version ?? executionStates[keyFor(c.unitId,c.boqId)]?.state_version ?? 1),completionPct:c.value,currentPct:Number(state?.completion_pct ?? c.original)})
    } catch (error) {
      if (!isOnline()) { await queueProgressOffline(orgId,{unitId:String(c.unitId),boqItemId:String(c.boqId),completionPct:c.value,reworkFlag:false,reworkReason:''}); return }
      throw error
    }
  }
  const saveAll = async () => {
    if (!dirtyCells.length || busy) return
    setBusy(true)
    try { for (const c of dirtyCells) await saveCell(c); setDrafts({}); await onRefresh(); toast({title:'تم حفظ الإدخال السريع',description:`${dirtyCells.length} تغيير`}) }
    catch (error) { toast({title:'تعذر حفظ الإدخال السريع',description:String(error),variant:'destructive'}) }
    finally { setBusy(false) }
  }
  const confirmRework = async () => {
    if (!rework || reason.trim().length < 20 || busy) return
    setBusy(true)
    try {
      const s = await getExecutionState(rework.cell.unitId,rework.cell.boqId)
      await submitProgressEvent({unitId:rework.cell.unitId,boqItemId:rework.cell.boqId,expectedVersion:Number(s?.state_version ?? 1),completionPct:rework.next,currentPct:Number(s?.completion_pct ?? rework.cell.original),reworkReason:reason.trim()})
      setDrafts(d => ({...d,[rework.key]:{...rework.cell,value:rework.next,original:rework.next}})); setRework(null); setReason(''); await onRefresh(); toast({title:'تم تسجيل إعادة التنفيذ'})
    } catch(error) { toast({title:'تعذر تسجيل إعادة التنفيذ',description:String(error),variant:'destructive'}) }
    finally { setBusy(false) }
  }

  if (!project) return <Card className="border-dashed"><CardContent className="p-10 text-center text-gray-500">اختر مشروعاً لبدء الإدخال السريع</CardContent></Card>
  return <div className="space-y-3" dir="rtl">
    <Alert><AlertTriangle className="h-4 w-4"/><AlertDescription>بنود المشروع معرفة مرة واحدة في BOQ. القيم في الجدول هي حالة تنفيذ البند لكل وحدة، وليست بنوداً مكررة.</AlertDescription></Alert>
    <Card><CardContent className="p-3"><div className="flex flex-col lg:flex-row gap-2 lg:items-center"><div className="relative flex-1"><Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400"/><Input className="pr-9" value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث بالوحدة..."/></div><div className="flex gap-2 items-center"><Button variant="outline" onClick={toggleAll}>{selectedUnits.size===units.length&&units.length?'إلغاء تحديد الكل':'تحديد الكل'}</Button><Button onClick={saveAll} disabled={busy||loadingState||!dirtyCells.length}>{busy?<Loader2 className="h-4 w-4 ml-1 animate-spin"/>:<Save className="h-4 w-4 ml-1"/>}حفظ {dirtyCells.length?`(${dirtyCells.length})`:''}</Button></div></div><div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500"><Badge variant="outline">{units.length} وحدة</Badge><Badge variant="outline">{boqColumns.length} بند مشروع</Badge><Badge variant="outline">{selectedUnits.size} محدد</Badge><Badge variant="outline">{dirtyCells.length} غير محفوظ</Badge></div></CardContent></Card>
    <BulkExecutionActions units={units} selectedUnitIds={selectedUnits} onApply={applyBulk} disabled={busy||loadingState}/>
    <Card><CardHeader className="py-3"><CardTitle className="text-base">الوحدات × بنود المشروع — الإدخال السريع</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-auto max-h-[68vh]"><table className="w-full text-xs min-w-[900px] border-collapse"><thead className="sticky top-0 z-20 bg-white"><tr className="border-b"><th className="sticky right-0 z-30 bg-white p-2 w-10"><Checkbox checked={units.length>0&&selectedUnits.size===units.length} onCheckedChange={toggleAll}/></th><th className="sticky right-10 z-30 bg-white p-2 text-right min-w-[150px]">الوحدة</th>{boqColumns.map((b:any)=><th key={b.id} className="p-2 text-right min-w-[120px] border-r">{b.code||b.description||`BOQ #${b.id}`}<div className="text-[10px] text-gray-400">{b.unitOfMeasure||''}</div></th>)}</tr></thead><tbody>{units.map((u:any)=><tr key={u.id} className="border-b hover:bg-gray-50"><td className="sticky right-0 z-10 bg-white p-2"><Checkbox checked={selectedUnits.has(Number(u.id))} onCheckedChange={()=>toggleUnit(Number(u.id))}/></td><td className="sticky right-10 z-10 bg-white p-2 font-medium">{u.name}<div className="text-[10px] text-gray-400">{u.code||`#${u.id}`}</div></td>{boqColumns.map((b:any)=>{const exists=(u.boqItems||[]).some((x:any)=>Number(x.id)===Number(b.id));if(!exists)return <td key={b.id} className="p-2 border-r text-center text-gray-300">—</td>;const c=getCell(u,b);const dirty=c.value!==c.original;return <td key={b.id} className={`p-1 border-r ${dirty?'bg-amber-50':''}`}><div className="flex items-center gap-1"><Input className="h-8 w-20 text-center" type="number" min="0" max="100" value={c.value} onChange={e=>setCell(u,b,e.target.value)}/>{c.value>=100&&<CheckCircle2 className="h-3.5 w-3.5 text-green-600"/>}</div>{dirty&&<div className="text-[9px] text-amber-700 text-center mt-0.5">{c.original}% → {c.value}%</div>}</td>})}</tr>)}</tbody></table></div></CardContent></Card>
    <div className="flex items-center gap-2 text-xs text-gray-500"><RotateCcw className="h-3.5 w-3.5"/>خفض الإنجاز لا يتم كحذف صامت؛ يدخل مسار إعادة التنفيذ مع سبب واضح.</div>
    <Dialog open={!!rework} onOpenChange={open=>{if(!open)setRework(null)}}><DialogContent><DialogHeader><DialogTitle>تأكيد إعادة التنفيذ</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-sm">سيتم خفض الإنجاز من {rework?.cell.original}% إلى {rework?.next}%.</p><Label>سبب إعادة التنفيذ — 20 حرفاً على الأقل</Label><Textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="اذكر سبب الإعادة والإجراء المطلوب..."/><p className="text-xs text-gray-500">{reason.trim().length}/20</p></div><DialogFooter><Button variant="outline" onClick={()=>setRework(null)}>إلغاء</Button><Button disabled={busy||reason.trim().length<20} onClick={confirmRework}>تأكيد</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
