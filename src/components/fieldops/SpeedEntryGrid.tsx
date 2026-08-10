// FieldOps V4 — Virtualized Speed Entry Grid
// Sprint 5 Phase 2 — Performance-optimized grid with @tanstack/react-virtual

'use client'

import React, { useState, useCallback, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Zap, Save, AlertTriangle, AlertCircle, Loader2, Keyboard, ArrowUpDown
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { saveBulkProgressOffline } from '@/lib/offline-db'

// ============================================================
// Types
// ============================================================

interface BoqItemData {
  id: string; orgId: string; unitId: string; trade: string; description: string;
  quantity: number; unitOfMeasure: string; completionPct: number
}

interface UnitData {
  id: string; orgId: string; projectId: string; name: string; code: string;
  unitType: string; floor: string | null; areaSqm: number | null; status: string;
  completionPct: number; boqItems: BoqItemData[]
}

interface SpeedEntryGridProps {
  project: { id: string; name: string; units: UnitData[] } | null
  orgId: string
  onRefresh: () => void
}

// ============================================================
// Main Component
// ============================================================

export function SpeedEntryGrid({ project, orgId, onRefresh }: SpeedEntryGridProps) {
  const [editingCell, setEditingCell] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [progressData, setProgressData] = useState<Record<string, number>>({})
  const [reworkDialog, setReworkDialog] = useState<{ unitId: string; boqItemId: string; currentPct: number; newPct: number } | null>(null)
  const [reworkReason, setReworkReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingChanges, setPendingChanges] = useState<Record<string, { unitId: string; boqItemId: string; completionPct: number; reworkFlag: boolean; reworkReason: string }>>({})
  const [sortField, setSortField] = useState<'name' | 'completion'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const { toast } = useToast()

  const parentRef = useRef<HTMLDivElement>(null)

  // Initialize progress data
  React.useEffect(() => {
    if (project?.units) {
      const data: Record<string, number> = {}
      project.units.forEach(unit => {
        unit.boqItems?.forEach(boq => {
          data[`${unit.id}-${boq.id}`] = boq.completionPct
        })
      })
      setProgressData(data)
    }
  }, [project])

  // Get unique trades for columns
  const boqTrades = useMemo(() => {
    if (!project?.units) return []
    return [...new Set(project.units.flatMap(u => (u.boqItems || []).map(b => b.trade)))]
  }, [project])

  // Sort units
  const sortedUnits = useMemo(() => {
    if (!project?.units) return []
    const units = [...project.units]
    units.sort((a, b) => {
      if (sortField === 'name') {
        const cmp = a.name.localeCompare(b.name, 'ar')
        return sortDir === 'asc' ? cmp : -cmp
      }
      const avgA = a.boqItems?.length > 0 ? a.boqItems.reduce((s, b) => s + (progressData[`${a.id}-${b.id}`] ?? b.completionPct), 0) / a.boqItems.length : 0
      const avgB = b.boqItems?.length > 0 ? b.boqItems.reduce((s, b) => s + (progressData[`${b.id}-${b.id}`] ?? b.completionPct), 0) / b.boqItems.length : 0
      return sortDir === 'asc' ? avgA - avgB : avgB - avgA
    })
    return units
  }, [project, sortField, sortDir, progressData])

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: sortedUnits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  })

  const handleCellEdit = useCallback((unitId: string, boqItemId: string, currentPct: number, newValue: string) => {
    const numVal = Math.min(100, Math.max(0, parseInt(newValue) || 0))
    const key = `${unitId}-${boqItemId}`

    if (numVal < currentPct) {
      setReworkDialog({ unitId, boqItemId, currentPct, newPct: numVal })
    } else {
      setProgressData(prev => ({ ...prev, [key]: numVal }))
      setPendingChanges(prev => ({
        ...prev,
        [key]: { unitId, boqItemId, completionPct: numVal, reworkFlag: false, reworkReason: '' }
      }))
    }
    setEditingCell(null)
  }, [])

  const handleReworkConfirm = useCallback(() => {
    if (!reworkDialog || reworkReason.length < 20) return
    const key = `${reworkDialog.unitId}-${reworkDialog.boqItemId}`
    setProgressData(prev => ({ ...prev, [key]: reworkDialog.newPct }))
    setPendingChanges(prev => ({
      ...prev,
      [key]: { unitId: reworkDialog.unitId, boqItemId: reworkDialog.boqItemId, completionPct: reworkDialog.newPct, reworkFlag: true, reworkReason }
    }))
    setReworkDialog(null)
    setReworkReason('')
  }, [reworkDialog, reworkReason])

  const handleSaveAll = useCallback(async () => {
    setSaving(true)
    try {
      const updates = Object.values(pendingChanges)
      if (updates.length === 0) {
        toast({ title: 'لا توجد تغييرات', description: 'لم يتم تعديل أي قيم' })
        setSaving(false)
        return
      }

      // Save offline first
      await saveBulkProgressOffline(orgId, updates, 'current-user')

      // Then try online
      const res = await fetch('/api/execution/bulk-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, updates, updatedBy: 'current-user' })
      })
      const data = await res.json()

      if (data.success) {
        toast({ title: 'تم الحفظ بنجاح', description: `تم تحديث ${data.updated} سجل ومزامنته` })
        setPendingChanges({})
        onRefresh()
      } else if (data.reworkRequired) {
        toast({ title: 'تحذير', description: `${data.reworkRequired.length} سجلات تحتاج تأكيد إعادة`, variant: 'destructive' })
      }
    } catch (err) {
      toast({ title: 'تم الحفظ محلياً', description: 'سيتم المزامنة عند الاتصال' })
      setPendingChanges({})
    } finally {
      setSaving(false)
    }
  }, [pendingChanges, orgId, onRefresh, toast])

  const getProgressColor = (pct: number) => {
    if (pct >= 100) return 'bg-emerald-500 text-white'
    if (pct >= 75) return 'bg-emerald-100 text-emerald-800'
    if (pct >= 50) return 'bg-amber-100 text-amber-800'
    if (pct >= 25) return 'bg-orange-100 text-orange-800'
    return 'bg-gray-100 text-gray-800'
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Zap className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">اختر مشروعاً من القائمة أعلاه</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ADR-003 Notice */}
      <Alert className="border-amber-200 bg-amber-50">
        <AlertCircle className="w-4 h-4 text-amber-600" />
        <AlertDescription className="text-xs text-amber-800">
          <strong>سياسة الإنجاز الأحادي (ADR-003):</strong> عند خفض نسبة الإنجاز، سيُطلب منك تأكيد السبب وإدخال سبب الإعادة (20 حرف كحد أدنى). التغييرات تُحفظ محلياً أولاً ثم تُزامن.
        </AlertDescription>
      </Alert>

      {/* Performance Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Keyboard className="w-3.5 h-3.5" />
          <span><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Enter</kbd> تأكيد</span>
          <span><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Esc</kbd> إلغاء</span>
          <span><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Tab</kbd> التالي</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
            }}
          >
            <ArrowUpDown className="w-3 h-3 ml-1" />
            ترتيب
          </Button>
        </div>
      </div>

      {/* Virtualized Grid */}
      <Card>
        <CardContent className="p-0">
          <div ref={parentRef} className="overflow-auto max-h-[600px]">
            {/* Sticky Header */}
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr className="border-b">
                  <th className="px-3 py-2.5 text-right font-medium text-gray-600 sticky right-0 bg-gray-50 z-20 min-w-[120px]">
                    الوحدة
                  </th>
                  {boqTrades.map(trade => (
                    <th key={trade} className="px-2 py-2.5 text-center font-medium text-gray-600 min-w-[100px]">
                      <div className="truncate">{trade}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-center font-medium text-gray-600 min-w-[80px]">المتوسط</th>
                </tr>
              </thead>
              <tbody>
                {rowVirtualizer.getVirtualItems().map(virtualRow => {
                  const unit = sortedUnits[virtualRow.index]
                  if (!unit) return null

                  const unitBoqItems = unit.boqItems || []
                  const avgPct = unitBoqItems.length > 0
                    ? Math.round(unitBoqItems.reduce((sum, b) => sum + (progressData[`${unit.id}-${b.id}`] ?? b.completionPct), 0) / unitBoqItems.length)
                    : 0

                  return (
                    <tr
                      key={unit.id}
                      className="border-b hover:bg-gray-50/50"
                      style={{
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start - rowVirtualizer.scrollOffset}px)`,
                      }}
                    >
                      <td className="px-3 py-2 sticky right-0 bg-white z-10 border-l">
                        <div className="font-medium text-gray-900">{unit.name}</div>
                        <div className="text-gray-400 text-[10px]">{unit.code} • {unit.unitType}</div>
                      </td>
                      {boqTrades.map(trade => {
                        const boqItem = unitBoqItems.find(b => b.trade === trade)
                        if (!boqItem) return <td key={trade} className="px-1 py-1 text-center text-gray-300">—</td>

                        const cellKey = `${unit.id}-${boqItem.id}`
                        const currentPct = progressData[cellKey] ?? boqItem.completionPct
                        const isEditing = editingCell === cellKey
                        const hasChange = pendingChanges[cellKey]

                        return (
                          <td key={trade} className="px-1 py-1 text-center">
                            {isEditing ? (
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => handleCellEdit(unit.id, boqItem.id, boqItem.completionPct, editValue)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleCellEdit(unit.id, boqItem.id, boqItem.completionPct, editValue)
                                  if (e.key === 'Escape') setEditingCell(null)
                                }}
                                className="w-16 h-7 text-center text-xs border border-emerald-400 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                autoFocus
                              />
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingCell(cellKey)
                                  setEditValue(String(currentPct))
                                }}
                                className={`w-16 h-7 rounded text-xs font-medium transition-colors cursor-pointer hover:ring-2 hover:ring-emerald-400 ${getProgressColor(currentPct)} ${hasChange ? 'ring-2 ring-amber-400' : ''}`}
                              >
                                {currentPct}%
                              </button>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-2 py-1 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${getProgressColor(avgPct)}`}>
                          {avgPct}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Rework Dialog */}
      <Dialog open={!!reworkDialog} onOpenChange={() => setReworkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              تأكيد خفض الإنجاز
            </DialogTitle>
            <DialogDescription>
              وفقاً لسياسة ADR-003، خفض نسبة الإنجاز يتطلب إدخال سبب الإعادة.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm">
                <span>النسبة الحالية</span>
                <span className="font-bold text-amber-800">{reworkDialog?.currentPct}%</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-1">
                <span>النسبة الجديدة</span>
                <span className="font-bold text-red-800">{reworkDialog?.newPct}%</span>
              </div>
            </div>
            <div>
              <Label>سبب الإعادة (20 حرف كحد أدنى)</Label>
              <Textarea
                value={reworkReason}
                onChange={e => setReworkReason(e.target.value)}
                placeholder="أدخل سبب خفض نسبة الإنجاز بالتفصيل..."
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">{reworkReason.length}/20 حرف كحد أدنى</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReworkDialog(null)}>إلغاء</Button>
            <Button
              onClick={handleReworkConfirm}
              disabled={reworkReason.length < 20}
              className="bg-amber-600 hover:bg-amber-700"
            >
              تأكيد الإعادة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
