'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Layers3, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

interface Props {
  /** Units currently visible in the Fast Entry grid (already filtered by search). */
  units: any[]
  selectedUnitIds: Set<number>
  executionStates: Record<string, { completion_pct: number; state_version: number }>
  onApply: (unitIds: number[], boqIds: number[], value: number) => void
  disabled?: boolean
}

type Selection = 'ALL_ITEMS' | `ITEM:${number}` | `GROUP:${string}`
type Scope = 'SELECTED' | 'VISIBLE'

function itemId(item: any): number {
  return Number(item.id)
}

function itemCode(item: any): string {
  return String(item.code ?? item.boqCode ?? item.boq_code ?? `BOQ-${itemId(item)}`)
}

function itemLabel(item: any): string {
  const code = itemCode(item)
  const description = String(item.description ?? item.name ?? '').trim()
  const trade = String(item.trade ?? '').trim()
  const uom = String(item.unitOfMeasure ?? item.unit_of_measure ?? '').trim()
  return [code, description, trade ? `(${trade})` : '', uom ? `· ${uom}` : ''].filter(Boolean).join(' — ')
}

function groupKey(item: any): string {
  const code = itemCode(item)
  if (code.includes('-')) return code.split('-')[0].toUpperCase()
  if (/^[A-Za-z]/.test(code)) return code[0].toUpperCase()
  return 'OTHER'
}

/**
 * V4 bulk workflow: select an explicit project BOQ item (or an intentionally
 * named group/all scope), then create drafts. Persistence remains in the
 * parent Event Pipeline and its online/offline safeguards.
 */
export function BulkExecutionActions({ units, selectedUnitIds, executionStates, onApply, disabled }: Props) {
  const [selection, setSelection] = useState<Selection>('ALL_ITEMS')
  const [scope, setScope] = useState<Scope>('SELECTED')
  const [value, setValue] = useState('')

  const scopedUnitIds = useMemo(() => {
    if (scope === 'VISIBLE') return units.map(unit => Number(unit.id))
    return Array.from(selectedUnitIds)
  }, [scope, units, selectedUnitIds])

  const scopedUnits = useMemo(() => {
    const ids = new Set(scopedUnitIds)
    return units.filter(unit => ids.has(Number(unit.id)))
  }, [units, scopedUnitIds])

  const availableItems = useMemo(() => {
    const unique = new Map<number, any>()
    for (const unit of scopedUnits) {
      for (const item of Array.isArray(unit.boqItems) ? unit.boqItems : []) {
        const id = itemId(item)
        if (Number.isFinite(id) && !unique.has(id)) unique.set(id, item)
      }
    }
    return Array.from(unique.values()).sort((a, b) => itemCode(a).localeCompare(itemCode(b), undefined, { numeric: true }))
  }, [scopedUnits])

  const groups = useMemo(() => {
    const grouped = new Map<string, any[]>()
    for (const item of availableItems) {
      const key = groupKey(item)
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(item)
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [availableItems])

  useEffect(() => {
    if (selection === 'ALL_ITEMS') return
    const [kind, raw] = selection.split(':')
    if (kind === 'ITEM' && !availableItems.some(item => itemId(item) === Number(raw))) setSelection('ALL_ITEMS')
    if (kind === 'GROUP' && !groups.some(([key]) => key === raw)) setSelection('ALL_ITEMS')
  }, [availableItems, groups, selection])

  const targetItems = useMemo(() => {
    if (selection === 'ALL_ITEMS') return availableItems.map(itemId)
    const [kind, raw] = selection.split(':')
    if (kind === 'ITEM') return availableItems.filter(item => itemId(item) === Number(raw)).map(itemId)
    if (kind === 'GROUP') return availableItems.filter(item => groupKey(item) === raw).map(itemId)
    return []
  }, [availableItems, selection])

  const targetPairCount = useMemo(() => {
    const itemIds = new Set(targetItems)
    return scopedUnits.reduce((count, unit) => count + (unit.boqItems || []).filter((item: any) => itemIds.has(itemId(item))).length, 0)
  }, [scopedUnits, targetItems])

  const readyPairCount = useMemo(() => {
    const itemIds = new Set(targetItems)
    return scopedUnits.reduce((count, unit) => count + (unit.boqItems || []).filter((item: any) => itemIds.has(itemId(item)) && executionStates[`${Number(unit.id)}:${itemId(item)}`]).length, 0)
  }, [executionStates, scopedUnits, targetItems])

  const missingStatePairCount = targetPairCount - readyPairCount

  const selectedItem = selection.startsWith('ITEM:')
    ? availableItems.find(item => itemId(item) === Number(selection.slice(5)))
    : null
  const selectedGroup = selection.startsWith('GROUP:') ? selection.slice(6) : null
  const canApply = !disabled && scopedUnitIds.length > 0 && targetItems.length > 0 && readyPairCount > 0 && value !== ''

  const apply = () => {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0 || number > 100 || !canApply) return
    onApply(scopedUnitIds, targetItems, number)
  }

  return <Card className="border-dashed">
    <CardContent className="p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Layers3 className="h-4 w-4" />
        <b className="text-sm">Bulk Action — منطق التشغيل الجماعي</b>
        <Badge variant="outline">Draft عبر Event Pipeline</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[180px_minmax(260px,1fr)_140px_auto] gap-2 items-end">
        <div>
          <Label className="text-xs">نطاق الوحدات</Label>
          <Select value={scope} onValueChange={next => setScope(next as Scope)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SELECTED">الوحدات المحددة ({selectedUnitIds.size})</SelectItem>
              <SelectItem value="VISIBLE">الوحدات الظاهرة ({units.length})</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">البند المستهدف</Label>
          <Select value={selection} onValueChange={next => setSelection(next as Selection)}>
            <SelectTrigger><SelectValue placeholder="اختر بندًا محددًا" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL_ITEMS">كل البنود المطبقة على النطاق ({availableItems.length})</SelectItem>
              {availableItems.map(item => <SelectItem key={`item-${itemId(item)}`} value={`ITEM:${itemId(item)}`}>{itemLabel(item)}</SelectItem>)}
              {groups.map(([key, items]) => <SelectItem key={`group-${key}`} value={`GROUP:${key}`}>مجموعة البنود {key} ({items.length})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">نسبة الإنجاز</Label>
          <Input type="number" min="0" max="100" value={value} onChange={event => setValue(event.target.value)} placeholder="0–100" />
        </div>
        <Button onClick={apply} disabled={!canApply}>تطبيق على المحدد</Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {[0, 25, 50, 75, 100].map(preset => <Button key={preset} type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setValue(String(preset))}>{preset}%</Button>)}
        <Badge variant="outline"><Target className="h-3 w-3 ml-1" />{scopedUnitIds.length} وحدة</Badge>
        <Badge variant="outline">{targetItems.length} بند</Badge>
        <Badge variant="outline">{readyPairCount} جاهز للحفظ</Badge>
        {missingStatePairCount > 0 ? <Badge variant="outline" className="text-amber-700">{missingStatePairCount} يحتاج تهيئة</Badge> : null}
      </div>

      <div className="rounded-md bg-slate-50 border px-3 py-2 text-[11px] text-muted-foreground">
        {selectedItem ? <><strong>{itemCode(selectedItem)}</strong> — {String(selectedItem.description ?? selectedItem.name ?? 'بند بلا وصف')} هو البند الفردي المحدد.</> : selectedGroup ? <>تم تحديد مجموعة <strong>{selectedGroup}</strong> صراحةً؛ يمكنك اختيار بند فردي من نفس القائمة.</> : <>اختر بندًا فرديًا من القائمة أو استخدم «كل البنود المطبقة على النطاق» بوضوح.</>}
      </div>

      {!scopedUnitIds.length || !targetItems.length ? <div className="flex items-center gap-2 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />حدد وحدات وبندًا مطبقًا قبل التطبيق.</div> : null}
      {targetPairCount > 0 && readyPairCount === 0 ? <div className="flex items-center gap-2 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />لا توجد حالات تنفيذ مهيأة ضمن النطاق؛ شغّل «تهيئة الحالات» قبل التطبيق.</div> : null}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Check className="h-3.5 w-3.5" />التطبيق ينشئ Drafts فقط؛ الحفظ يمر عبر Event Pipeline وفحص الإصدار أو طابور Offline، ولا يتم تعديل قاعدة البيانات مباشرة.</div>
    </CardContent>
  </Card>
}
