'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Layers3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

interface Props {
  units: any[]
  selectedUnitIds: Set<number>
  onApply: (unitIds: number[], boqIds: number[], value: number) => void
  disabled?: boolean
}

/** V4 adaptation of the legacy BulkUpdate/GroupToggle workflow.
 * It deliberately emits drafts only; persistence remains in the V4 execution pipeline.
 */
export function BulkExecutionActions({ units, selectedUnitIds, onApply, disabled }: Props) {
  const [group, setGroup] = useState('ALL')
  const [value, setValue] = useState('')

  const groups = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const unit of units) for (const item of unit.boqItems || []) {
      const code = String(item.code ?? item.boqCode ?? item.boq_code ?? item.id)
      const key = code.includes('-') ? code.split('-')[0] : /^[A-Za-z]/.test(code) ? code[0].toUpperCase() : 'OTHER'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [units])

  const targetItems = useMemo(() => {
    const selected = units.filter(u => selectedUnitIds.has(Number(u.id)))
    if (group === 'ALL') return Array.from(new Map(selected.flatMap(u => (u.boqItems || []).map((i: any) => [Number(i.id), i]))).keys())
    return Array.from(new Map(selected.flatMap(u => (u.boqItems || []).filter((i: any) => {
      const code = String(i.code ?? i.boqCode ?? i.boq_code ?? i.id)
      const key = code.includes('-') ? code.split('-')[0] : /^[A-Za-z]/.test(code) ? code[0].toUpperCase() : 'OTHER'
      return key === group
    }).map((i: any) => [Number(i.id), i])).keys())
  }, [units, selectedUnitIds, group])

  const apply = () => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 100 || !selectedUnitIds.size || !targetItems.length) return
    onApply(Array.from(selectedUnitIds), targetItems, n)
  }

  return <Card className="border-dashed">
    <CardContent className="p-3 space-y-3">
      <div className="flex items-center gap-2"><Layers3 className="h-4 w-4" /><b className="text-sm">Bulk Action — منطق التشغيل الجماعي</b><Badge variant="outline">V4 Draft</Badge></div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_auto] gap-2 items-end">
        <div><Label className="text-xs">مجموعة البنود</Label><Select value={group} onValueChange={setGroup}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">كل البنود</SelectItem>{groups.map(([key, items]) => <SelectItem key={key} value={key}>مجموعة {key} ({items.length} بند)</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">نسبة الإنجاز</Label><Input type="number" min="0" max="100" value={value} onChange={e => setValue(e.target.value)} placeholder="0–100" /></div>
        <Button onClick={apply} disabled={disabled || !selectedUnitIds.size || !targetItems.length || value === ''}>تطبيق على المحدد</Button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" />التطبيق ينشئ Drafts فقط. الحفظ يمر عبر Event Pipeline وفحص الإصدار، ولا يتم تعديل قاعدة البيانات مباشرة.</div>
    </CardContent>
  </Card>
}
