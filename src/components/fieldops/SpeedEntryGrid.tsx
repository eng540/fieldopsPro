'use client'

import { useMemo, useState } from 'react'
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
import { submitProgressEvent, queueProgressOffline } from '@/lib/execution-client'
import { isOnline } from '@/lib/api-client'

interface Props {
  project: any | null
  orgId: string
  onRefresh: () => void
}

interface Cell {
  unitId: number
  boqId: number
  value: number
  original: number
}

/**
 * Operational Speed Entry recovered from Ncrpro110's matrix workflow.
 *
 * This is deliberately a V4 implementation: it uses the V4 execution event
 * pipeline and offline queue instead of the legacy API/IndexedDB model.
 */
export function SpeedEntryGrid({ project, orgId, onRefresh }: Props) {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [selectedUnits, setSelectedUnits] = useState<Set<number>>(new Set())
  const [drafts, setDrafts] = useState<Record<string, Cell>>({})
  const [bulkValue, setBulkValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [rework, setRework] = useState<{ key: string; cell: Cell; next: number } | null>(null)
  const [reason, setReason] = useState('')

  const units = useMemo(() => {
    const raw = Array.isArray(project?.units) ? project.units : []
    const q = search.trim().toLowerCase()
    return raw.filter((u: any) => !q || String(u.name ?? '').toLowerCase().includes(q) || String(u.code ?? '').toLowerCase().includes(q))
  }, [project, search])

  const boqColumns = useMemo(() => {
    const map = new Map<number, any>()
    for (const unit of units) {
      for (const item of unit.boqItems || []) if (!map.has(Number(item.id))) map.set(Number(item.id), item)
    }
    return Array.from(map.values())
  }, [units])

  const keyFor = (unitId: number, boqId: number) => `${unitId}:${boqId}`

  const getCell = (unit: any, boq: any): Cell => {
    const key = keyFor(Number(unit.id), Number(boq.id))
    if (drafts[key]) return drafts[key]
    const source = (unit.boqItems || []).find((x: any) => Number(x.id) === Number(boq.id))
    const value = Number(source?.completionPct ?? source?.completion_pct ?? 0)
    return { unitId: Number(unit.id), boqId: Number(boq.id), value, original: value }
  }

  const setCell = (unit: any, boq: any, raw: string) => {
    const value = Math.max(0, Math.min(100, Number(raw) || 0))
    const cell = getCell(unit, boq)
    setDrafts(d => ({ ...d, [keyFor(cell.unitId, cell.boqId)]: { ...cell, value } }))
  }

  const visibleCells = useMemo(() => {
    const cells: Cell[] = []
    for (const unit of units) for (const boq of boqColumns) {
      if ((unit.boqItems || []).some((x: any) => Number(x.id) === Number(boq.id))) cells.push(getCell(unit, boq))
    }
    return cells
  }, [units, boqColumns, drafts])

  const dirtyCells = visibleCells.filter(c => c.value !== c.original)

  const toggleUnit = (id: number) => {
    setSelectedUnits(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedUnits(prev => prev.size === units.length ? new Set() : new Set(units.map((u: any) => Number(u.id))))
  }

  const applyBulk = () => {
    const value = Number(bulkValue)
    if (!Number.isFinite(value) || value < 0 || value > 100 || selectedUnits.size === 0) return
    setDrafts(current => {
      const next = { ...current }
      for (const unit of units) {
        if (!selectedUnits.has(Number(unit.id))) continue
        for (const boq of unit.boqItems || []) {
          const cell = getCell(unit, boq)
          next[keyFor(cell.unitId, cell.boqId)] = { ...cell, value }
        }
      }
      return next
    })
  }

  const saveCell = async (cell: Cell) => {
    if (cell.value === cell.original) return
    if (cell.value < cell.original) {
      setRework({ key: keyFor(cell.unitId, cell.boqId), cell, next: cell.value })
      return
    }
    try {
      await submitProgressEvent({
        unitId: cell.unitId,
        boqItemId: cell.boqId,
        expectedVersion: 1,
        completionPct: cell.value,
        currentPct: cell.original,
      })
    } catch (error) {
      if (!isOnline()) {
        await queueProgressOffline(orgId, {
          unitId: String(cell.unitId),
          boqItemId: String(cell.boqId),
          completionPct: cell.value,
          reworkFlag: false,
          reworkReason: '',
        })
        return
      }
      throw error
    }
  }

  const saveAll = async () => {
    if (!dirtyCells.length || busy) return
    setBusy(true)
    try {
      for (const cell of dirtyCells) await saveCell(cell)
      setDrafts({})
      await onRefresh()
      toast({ title: 'تم حفظ الإدخال السريع', description: `${dirtyCells.length} تغيير` })
    } catch (error) {
      toast({ title: 'تعذر حفظ الإدخال السريع', description: String(error), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const confirmRework = async () => {
    if (!rework || reason.trim().length < 20 || busy) return
    setBusy(true)
    try {
      await submitProgressEvent({
        unitId: rework.cell.unitId,
        boqItemId: rework.cell.boqId,
        expectedVersion: 1,
        completionPct: rework.next,
        currentPct: rework.cell.original,
        reworkReason: reason.trim(),
      })
      setDrafts(d => ({ ...d, [rework.key]: { ...rework.cell, value: rework.next, original: rework.next } }))
      setRework(null)
      setReason('')
      await onRefresh()
      toast({ title: 'تم تسجيل إعادة التنفيذ' })
    } catch (error) {
      toast({ title: 'تعذر تسجيل إعادة التنفيذ', description: String(error), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (!project) return <Card className="border-dashed"><CardContent className="p-10 text-center text-gray-500">اختر مشروعاً لبدء الإدخال السريع</CardContent></Card>

  return (
    <div className="space-y-3">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          مصفوفة تشغيل ميداني: اختر الوحدات، عدّل البنود مباشرة أو طبّق نسبة جماعية، ثم احفظ عبر Event Pipeline. خفض الإنجاز يتطلب سبب إعادة تنفيذ.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="p-3">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input className="pr-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالوحدة..." />
            </div>
            <div className="flex gap-2 items-center">
              <Input className="w-28" type="number" min="0" max="100" value={bulkValue} onChange={e => setBulkValue(e.target.value)} placeholder="% جماعي" />
              <Button variant="outline" onClick={applyBulk} disabled={!bulkValue || selectedUnits.size === 0}>تطبيق على المحدد</Button>
              <Button onClick={saveAll} disabled={busy || !dirtyCells.length}>
                {busy ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Save className="h-4 w-4 ml-1" />}
                حفظ {dirtyCells.length ? `(${dirtyCells.length})` : ''}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
            <Badge variant="outline">{units.length} وحدة</Badge>
            <Badge variant="outline">{boqColumns.length} بند</Badge>
            <Badge variant="outline">{selectedUnits.size} محدد</Badge>
            <Badge variant="outline">{dirtyCells.length} غير محفوظ</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-base">Unit × BOQ — Speed Entry</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[68vh]">
            <table className="w-full text-xs min-w-[900px] border-collapse">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-b">
                  <th className="sticky right-0 z-30 bg-white p-2 w-10"><Checkbox checked={units.length > 0 && selectedUnits.size === units.length} onCheckedChange={toggleAll} /></th>
                  <th className="sticky right-10 z-30 bg-white p-2 text-right min-w-[150px]">الوحدة</th>
                  {boqColumns.map((boq: any) => <th key={boq.id} className="p-2 text-right min-w-[120px] border-r">{boq.code || boq.description}<div className="text-[10px] text-gray-400">{boq.unitOfMeasure || ''}</div></th>)}
                </tr>
              </thead>
              <tbody>
                {units.map((unit: any) => (
                  <tr key={unit.id} className="border-b hover:bg-gray-50">
                    <td className="sticky right-0 z-10 bg-white p-2"><Checkbox checked={selectedUnits.has(Number(unit.id))} onCheckedChange={() => toggleUnit(Number(unit.id))} /></td>
                    <td className="sticky right-10 z-10 bg-white p-2 font-medium">{unit.name}<div className="text-[10px] text-gray-400">{unit.code || `#${unit.id}`}</div></td>
                    {boqColumns.map((boq: any) => {
                      const exists = (unit.boqItems || []).some((x: any) => Number(x.id) === Number(boq.id))
                      if (!exists) return <td key={boq.id} className="p-2 border-r text-center text-gray-300">—</td>
                      const cell = getCell(unit, boq)
                      const dirty = cell.value !== cell.original
                      return <td key={boq.id} className={`p-1 border-r ${dirty ? 'bg-amber-50' : ''}`}>
                        <div className="flex items-center gap-1">
                          <Input className="h-8 w-20 text-center" type="number" min="0" max="100" value={cell.value} onChange={e => setCell(unit, boq, e.target.value)} />
                          {cell.value >= 100 && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                        </div>
                        {dirty && <div className="text-[9px] text-amber-700 text-center mt-0.5">{cell.original}% → {cell.value}%</div>}
                      </td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <RotateCcw className="h-3.5 w-3.5" /> خفض الإنجاز لا يتم كحذف صامت؛ يدخل مسار إعادة التنفيذ مع سبب واضح.
      </div>

      <Dialog open={!!rework} onOpenChange={open => { if (!open) setRework(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>تأكيد إعادة التنفيذ</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">سيتم خفض الإنجاز من {rework?.cell.original}% إلى {rework?.next}%.</p>
            <Label>سبب إعادة التنفيذ — 20 حرفاً على الأقل</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="اذكر سبب الإعادة والإجراء المطلوب..." />
            <p className="text-xs text-gray-500">{reason.trim().length}/20</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRework(null)}>إلغاء</Button>
            <Button disabled={busy || reason.trim().length < 20} onClick={confirmRework}>تأكيد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
