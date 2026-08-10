// FieldOps V4 — Projects Screen
// Sprint 5 Phase 3 — Enterprise Project & Unit Management with BoQ Dictionary

'use client'

import React, { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogTrigger, DialogDescription
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Building2, Plus, Search, Filter, Trash2, Eye, Edit3, Grid3X3,
  ChevronDown, ChevronUp, MapPin, Users, ArrowLeft, CheckCircle2,
  AlertCircle, WifiOff, Loader2, BookOpen, FileText
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// ============================================================
// Types
// ============================================================

interface ProjectData {
  id: string; orgId: string; name: string; code: string; status: string;
  location: string | null; totalUnits: number; completionPct: number; isActive: boolean;
  units: UnitData[]; assignments: { user: { id: string; name: string; email: string }; role: { name: string } }[]
}

interface UnitData {
  id: string; orgId: string; projectId: string; name: string; code: string;
  unitType: string; floor: string | null; areaSqm: number | null; status: string;
  completionPct: number; boqItems: BoqItemData[]
}

interface BoqItemData {
  id: string; orgId: string; unitId: string; trade: string; description: string;
  quantity: number; unitOfMeasure: string; completionPct: number
}

interface DictionaryData {
  id: string; orgId: string; name: string; category: string; description: string | null;
  isActive: boolean; createdBy: string | null; items: DictionaryItemData[]
}

interface DictionaryItemData {
  id: string; dictionaryId: string; trade: string; description: string;
  quantity: number; unitOfMeasure: string; sortOrder: number
}

interface ProjectsScreenProps {
  projects: ProjectData[]
  selectedProject: ProjectData | null
  onSelectProject: (p: ProjectData) => void
  orgId: string
  onRefresh: () => void
  dictionaries: DictionaryData[]
}

// ============================================================
// Constants
// ============================================================

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ON_HOLD: 'bg-amber-100 text-amber-800 border-amber-200',
  COMPLETED: 'bg-blue-100 text-blue-800 border-blue-200',
  CANCELLED: 'bg-red-100 text-red-800 border-red-200',
  NOT_STARTED: 'bg-gray-100 text-gray-800 border-gray-200',
  IN_PROGRESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'نشط',
  ON_HOLD: 'معلق',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغى',
  NOT_STARTED: 'لم يبدأ',
  IN_PROGRESS: 'قيد التنفيذ',
}

const UNIT_TYPE_LABELS: Record<string, string> = {
  RESIDENTIAL: 'سكني',
  COMMERCIAL: 'تجاري',
  COMMON: 'مشترك',
  MECHANICAL: 'ميكانيكي',
  ELECTRICAL: 'كهربائي',
  PLUMBING: 'سباكة',
  FINISHING: 'تشطيب',
}

const UNIT_TYPE_OPTIONS = [
  { value: 'RESIDENTIAL', label: 'سكني' },
  { value: 'COMMERCIAL', label: 'تجاري' },
  { value: 'COMMON', label: 'مشترك' },
  { value: 'MECHANICAL', label: 'ميكانيكي' },
  { value: 'ELECTRICAL', label: 'كهربائي' },
  { value: 'PLUMBING', label: 'سباكة' },
  { value: 'FINISHING', label: 'تشطيب' },
]

// ============================================================
// Offline Indicator
// ============================================================

function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true)

  useState(() => {
    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine)
      const handleOnline = () => setIsOnline(true)
      const handleOffline = () => setIsOnline(false)
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
      return () => {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
      }
    }
  })

  if (isOnline) return null

  return (
    <Alert className="border-amber-200 bg-amber-50 mb-4" dir="rtl">
      <WifiOff className="h-4 w-4 text-amber-600" />
      <AlertDescription className="text-amber-800 font-medium">
        أنت تعمل في وضع عدم الاتصال — سيتم مزامنة التغييرات عند استعادة الاتصال
      </AlertDescription>
    </Alert>
  )
}

// ============================================================
// Progress Bar with Label
// ============================================================

function ProgressWithLabel({ value, label }: { value: number; label?: string }) {
  const displayValue = Math.min(100, Math.max(0, Math.round(value)))
  const colorClass =
    displayValue >= 80 ? 'text-emerald-700' :
    displayValue >= 50 ? 'text-amber-700' :
    'text-red-600'

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label || 'نسبة الإنجاز'}</span>
        <span className={`font-bold ${colorClass}`}>{displayValue}%</span>
      </div>
      <Progress value={displayValue} className="h-2" />
    </div>
  )
}

// ============================================================
// Project Card
// ============================================================

function ProjectCard({
  project,
  isSelected,
  onClick,
}: {
  project: ProjectData
  isSelected: boolean
  onClick: () => void
}) {
  const statusColor = STATUS_COLORS[project.status] || STATUS_COLORS.NOT_STARTED
  const statusLabel = STATUS_LABELS[project.status] || project.status

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      whileHover={{ scale: 1.015, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}
      whileTap={{ scale: 0.985 }}
    >
      <Card
        className={`cursor-pointer transition-all duration-200 border-2 overflow-hidden ${
          isSelected
            ? 'border-emerald-500 ring-2 ring-emerald-200 shadow-lg shadow-emerald-100'
            : 'border-transparent hover:border-emerald-200'
        }`}
        onClick={onClick}
        dir="rtl"
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base font-bold truncate text-right">
                {project.name}
              </CardTitle>
              <CardDescription className="text-xs mt-1 font-mono text-right">
                {project.code}
              </CardDescription>
            </div>
            <Badge className={`${statusColor} border text-xs shrink-0`}>
              {statusLabel}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {project.location && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{project.location}</span>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Grid3X3 className="h-3.5 w-3.5 shrink-0" />
              <span>{project.totalUnits} وحدة</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span>{project.assignments.length} عضو</span>
            </div>
          </div>

          <ProgressWithLabel value={project.completionPct} />

          {project.assignments.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {project.assignments.slice(0, 3).map((a, i) => (
                <Badge key={i} variant="outline" className="text-[10px] py-0 px-1.5">
                  {a.user.name}
                </Badge>
              ))}
              {project.assignments.length > 3 && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                  +{project.assignments.length - 3}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ============================================================
// BoQ Item Row
// ============================================================

function BoqItemRow({ item }: { item: BoqItemData }) {
  const pctColor =
    item.completionPct >= 80 ? 'text-emerald-700' :
    item.completionPct >= 50 ? 'text-amber-700' :
    'text-red-600'

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors text-sm" dir="rtl">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">
            {item.trade}
          </Badge>
          <span className="truncate text-xs font-medium">{item.description}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{item.quantity} {item.unitOfMeasure}</span>
        </div>
      </div>
      <div className="shrink-0 w-20">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-muted-foreground">الإنجاز</span>
          <span className={`font-bold ${pctColor}`}>{Math.round(item.completionPct)}%</span>
        </div>
        <Progress value={item.completionPct} className="h-1.5" />
      </div>
    </div>
  )
}

// ============================================================
// Unit Card (in detail view)
// ============================================================

function UnitCard({ unit }: { unit: UnitData }) {
  const [expanded, setExpanded] = useState(false)
  const statusColor = STATUS_COLORS[unit.status] || STATUS_COLORS.NOT_STARTED
  const statusLabel = STATUS_LABELS[unit.status] || unit.status
  const unitTypeLabel = UNIT_TYPE_LABELS[unit.unitType] || unit.unitType

  return (
    <Card className="border overflow-hidden" dir="rtl">
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-sm truncate">{unit.name}</span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">
              {unit.code}
            </Badge>
            <Badge className={`${statusColor} border text-[10px] py-0 px-1.5 shrink-0`}>
              {statusLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{unitTypeLabel}</span>
            {unit.floor && <span>الطابق: {unit.floor}</span>}
            {unit.areaSqm && <span>{unit.areaSqm} م²</span>}
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {unit.boqItems.length} بند
            </span>
          </div>
        </div>
        <div className="shrink-0 w-28">
          <ProgressWithLabel value={unit.completionPct} />
        </div>
        <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Separator />
            <div className="p-3">
              {unit.boqItems.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>لا توجد بنود جدول كميات لهذه الوحدة</p>
                </div>
              ) : (
                <ScrollArea className="max-h-64">
                  <div className="space-y-0.5">
                    {unit.boqItems.map((item) => (
                      <BoqItemRow key={item.id} item={item} />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

// ============================================================
// Create Project Dialog
// ============================================================

function CreateProjectDialog({
  orgId,
  onCreated,
}: {
  orgId: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [location, setLocation] = useState('')
  const [totalUnits, setTotalUnits] = useState('')
  const { toast } = useToast()

  const handleSubmit = async () => {
    if (!name.trim() || !code.trim()) {
      toast({ title: 'خطأ', description: 'يرجى ملء جميع الحقول المطلوبة', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          name: name.trim(),
          code: code.trim(),
          location: location.trim() || null,
          totalUnits: parseInt(totalUnits) || 0,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'فشل في إنشاء المشروع')
      }

      toast({ title: 'تم بنجاح', description: 'تم إنشاء المشروع بنجاح' })
      setName('')
      setCode('')
      setLocation('')
      setTotalUnits('')
      setOpen(false)
      onCreated()
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message || 'فشل في إنشاء المشروع', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" dir="rtl">
          <Plus className="h-4 w-4" />
          مشروع جديد
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-lg font-bold">إنشاء مشروع جديد</DialogTitle>
          <DialogDescription className="text-right">
            أدخل بيانات المشروع الجديد لبدء إدارة العمليات الميدانية
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-right block">اسم المشروع *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: مجمع الأندلس السكني"
              className="text-right"
              dir="rtl"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-right block">رمز المشروع *</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="مثال: PRJ-001"
              className="text-right font-mono"
              dir="rtl"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-right block">الموقع</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="مثال: الرياض — حي الملقا"
              className="text-right"
              dir="rtl"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-right block">عدد الوحدات المتوقعة</Label>
            <Input
              type="number"
              value={totalUnits}
              onChange={(e) => setTotalUnits(e.target.value)}
              placeholder="0"
              className="text-right"
              dir="rtl"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            إلغاء
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !code.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            إنشاء المشروع
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Create Unit Dialog
// ============================================================

function CreateUnitDialog({
  projectId,
  orgId,
  dictionaries,
  onCreated,
}: {
  projectId: string
  orgId: string
  dictionaries: DictionaryData[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [unitType, setUnitType] = useState('')
  const [floor, setFloor] = useState('')
  const [areaSqm, setAreaSqm] = useState('')
  const [dictionaryId, setDictionaryId] = useState('')
  const { toast } = useToast()

  const selectedDict = dictionaries.find((d) => d.id === dictionaryId)

  const handleSubmit = async () => {
    if (!name.trim() || !code.trim() || !unitType) {
      toast({ title: 'خطأ', description: 'يرجى ملء جميع الحقول المطلوبة', variant: 'destructive' })
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          projectId,
          name: name.trim(),
          code: code.trim(),
          unitType,
          floor: floor.trim() || null,
          areaSqm: areaSqm || null,
          dictionaryId: dictionaryId || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'فشل في إنشاء الوحدة')
      }

      toast({
        title: 'تم بنجاح',
        description: dictionaryId
          ? `تم إنشاء الوحدة مع تطبيق قاموس جدول الكميات (${selectedDict?.items.length || 0} بند)`
          : 'تم إنشاء الوحدة بنجاح',
      })
      setName('')
      setCode('')
      setUnitType('')
      setFloor('')
      setAreaSqm('')
      setDictionaryId('')
      setOpen(false)
      onCreated()
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message || 'فشل في إنشاء الوحدة', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" size="sm" dir="rtl">
          <Plus className="h-4 w-4" />
          وحدة جديدة
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-lg font-bold">إنشاء وحدة جديدة</DialogTitle>
          <DialogDescription className="text-right">
            أضف وحدة جديدة للمشروع مع إمكانية تطبيق قاموس جدول الكميات
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 py-2 px-1">
            <div className="space-y-2">
              <Label className="text-right block">اسم الوحدة *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: شقة A-101"
                className="text-right"
                dir="rtl"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-right block">رمز الوحدة *</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="مثال: UNIT-A101"
                className="text-right font-mono"
                dir="rtl"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-right block">نوع الوحدة *</Label>
              <Select value={unitType} onValueChange={setUnitType} dir="rtl">
                <SelectTrigger className="text-right">
                  <SelectValue placeholder="اختر نوع الوحدة" />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-right block">الطابق</Label>
                <Input
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                  placeholder="مثال: 3"
                  className="text-right"
                  dir="rtl"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-right block">المساحة (م²)</Label>
                <Input
                  type="number"
                  value={areaSqm}
                  onChange={(e) => setAreaSqm(e.target.value)}
                  placeholder="0"
                  className="text-right"
                  dir="rtl"
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-emerald-600" />
                <Label className="text-right font-bold">تطبيق قاموس جدول الكميات</Label>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                اختر قاموسًا لتعبئة بنود جدول الكميات تلقائيًا عند إنشاء الوحدة
              </p>
              <Select value={dictionaryId} onValueChange={setDictionaryId} dir="rtl">
                <SelectTrigger className="text-right">
                  <SelectValue placeholder="بدون قاموس — إدخال يدوي" />
                </SelectTrigger>
                <SelectContent>
                  {dictionaries.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      لا توجد قواميس متاحة
                    </SelectItem>
                  ) : (
                    dictionaries.map((dict) => (
                      <SelectItem key={dict.id} value={dict.id}>
                        {dict.name} — {dict.items.length} بند
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>

              {selectedDict && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-emerald-800">
                      {selectedDict.name}
                    </span>
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                      {selectedDict.items.length} بند
                    </Badge>
                  </div>
                  {selectedDict.description && (
                    <p className="text-xs text-muted-foreground mb-2">{selectedDict.description}</p>
                  )}
                  <ScrollArea className="max-h-32">
                    <div className="space-y-1">
                      {selectedDict.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-white/60">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Badge variant="outline" className="text-[9px] py-0 px-1 shrink-0">
                              {item.trade}
                            </Badge>
                            <span className="truncate">{item.description}</span>
                          </div>
                          <span className="shrink-0 text-muted-foreground">
                            {item.quantity} {item.unitOfMeasure}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </motion.div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            إلغاء
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !code.trim() || !unitType}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            إنشاء الوحدة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Delete Project Dialog
// ============================================================

function DeleteProjectDialog({
  project,
  onDeleted,
}: {
  project: ProjectData
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const handleDelete = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects?id=${project.id}`, { method: 'DELETE' })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'فشل في حذف المشروع')
      }

      toast({ title: 'تم بنجاح', description: 'تم حذف المشروع وجميع بياناته' })
      setOpen(false)
      onDeleted()
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message || 'فشل في حذف المشروع', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2 text-red-700">
            <AlertCircle className="h-5 w-5" />
            تأكيد حذف المشروع
          </DialogTitle>
          <DialogDescription className="text-right">
            هل أنت متأكد من حذف المشروع &quot;{project.name}&quot;؟
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" dir="rtl">
          <p className="font-bold mb-2">تحذير: هذا الإجراء لا يمكن التراجع عنه!</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>سيتم حذف جميع الوحدات ({project.units.length} وحدة)</li>
            <li>سيتم حذف جميع بنود جدول الكميات</li>
            <li>سيتم حذف جميع تعيينات الفريق</li>
            <li>سيتم حذف أوامر العمل والملاحظات المرتبطة</li>
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            إلغاء
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading}
            className="gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            حذف المشروع نهائيًا
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Project Detail View
// ============================================================

function ProjectDetailView({
  project,
  orgId,
  dictionaries,
  onBack,
  onRefresh,
}: {
  project: ProjectData
  orgId: string
  dictionaries: DictionaryData[]
  onBack: () => void
  onRefresh: () => void
}) {
  const statusColor = STATUS_COLORS[project.status] || STATUS_COLORS.NOT_STARTED
  const statusLabel = STATUS_LABELS[project.status] || project.status

  // Compute summary stats
  const totalBoqItems = project.units.reduce((sum, u) => sum + u.boqItems.length, 0)
  const completedUnits = project.units.filter((u) => u.status === 'COMPLETED').length
  const avgCompletion =
    project.units.length > 0
      ? Math.round(project.units.reduce((s, u) => s + u.completionPct, 0) / project.units.length)
      : 0

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{project.name}</h2>
              <Badge className={`${statusColor} border text-xs`}>{statusLabel}</Badge>
            </div>
            <p className="text-sm text-muted-foreground font-mono">{project.code}</p>
          </div>
        </div>
        <DeleteProjectDialog project={project} onDeleted={onRefresh} />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-emerald-100 bg-emerald-50/50">
          <CardContent className="p-4 text-center">
            <Grid3X3 className="h-5 w-5 mx-auto mb-1 text-emerald-600" />
            <div className="text-2xl font-bold text-emerald-700">{project.totalUnits}</div>
            <div className="text-xs text-muted-foreground">إجمالي الوحدات</div>
          </CardContent>
        </Card>
        <Card className="border-blue-100 bg-blue-50/50">
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-blue-600" />
            <div className="text-2xl font-bold text-blue-700">{completedUnits}</div>
            <div className="text-xs text-muted-foreground">وحدات مكتملة</div>
          </CardContent>
        </Card>
        <Card className="border-amber-100 bg-amber-50/50">
          <CardContent className="p-4 text-center">
            <FileText className="h-5 w-5 mx-auto mb-1 text-amber-600" />
            <div className="text-2xl font-bold text-amber-700">{totalBoqItems}</div>
            <div className="text-xs text-muted-foreground">بنود جدول الكميات</div>
          </CardContent>
        </Card>
        <Card className="border-purple-100 bg-purple-50/50">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-purple-700">{avgCompletion}%</div>
            <div className="text-xs text-muted-foreground">متوسط الإنجاز</div>
            <Progress value={avgCompletion} className="h-1.5 mt-1" />
          </CardContent>
        </Card>
      </div>

      {/* Project Info */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            {project.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="text-muted-foreground">الموقع:</span>
                <span className="font-medium">{project.location}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="text-muted-foreground">الفريق:</span>
              <span className="font-medium">{project.assignments.length} عضو</span>
            </div>
            <div>
              <ProgressWithLabel value={project.completionPct} label="نسبة الإنجاز الإجمالية" />
            </div>
          </div>

          {project.assignments.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex flex-wrap gap-2">
                {project.assignments.map((a, i) => (
                  <Badge key={i} variant="secondary" className="text-xs gap-1">
                    <Users className="h-3 w-3" />
                    {a.user.name}
                    <span className="text-muted-foreground">({a.role.name})</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Units Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3X3 className="h-5 w-5 text-emerald-600" />
          <h3 className="text-lg font-bold">الوحدات</h3>
          <Badge variant="outline" className="text-xs">{project.units.length}</Badge>
        </div>
        <CreateUnitDialog
          projectId={project.id}
          orgId={orgId}
          dictionaries={dictionaries}
          onCreated={onRefresh}
        />
      </div>

      {/* Units List */}
      {project.units.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Grid3X3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground mb-1">لا توجد وحدات بعد</p>
            <p className="text-xs text-muted-foreground">
              ابدأ بإضافة وحدات جديدة مع تطبيق قواميس جدول الكميات
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {project.units.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Main ProjectsScreen Component
// ============================================================

export function ProjectsScreen({
  projects,
  selectedProject,
  onSelectProject,
  orgId,
  onRefresh,
  dictionaries,
}: ProjectsScreenProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [showFilters, setShowFilters] = useState(false)

  // Filter projects
  const filteredProjects = useMemo(() => {
    let result = projects

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          (p.location && p.location.toLowerCase().includes(q))
      )
    }

    // Status filter
    if (statusFilter && statusFilter !== 'ALL') {
      result = result.filter((p) => p.status === statusFilter)
    }

    return result
  }, [projects, searchQuery, statusFilter])

  // Status counts for filter
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: projects.length }
    projects.forEach((p) => {
      counts[p.status] = (counts[p.status] || 0) + 1
    })
    return counts
  }, [projects])

  const selectedProjectId = selectedProject?.id ?? null

  const handleBack = useCallback(() => {
    // Deselect by calling onSelectProject with a no-op or clearing
    // Since we can't clear selection from here, we'll use a workaround
    // The parent component should handle this
    onRefresh()
  }, [onRefresh])

  // If a project is selected, show detail view
  if (selectedProject) {
    return (
      <div className="space-y-4">
        <OfflineIndicator />
        <ProjectDetailView
          project={selectedProject}
          orgId={orgId}
          dictionaries={dictionaries}
          onBack={handleBack}
          onRefresh={onRefresh}
        />
      </div>
    )
  }

  // Otherwise show project list
  return (
    <div className="space-y-4" dir="rtl">
      <OfflineIndicator />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">المشاريع</h1>
          <Badge variant="outline" className="text-xs">
            {projects.length} مشروع
          </Badge>
        </div>
        <CreateProjectDialog orgId={orgId} onCreated={onRefresh} />
      </div>

      {/* Search & Filter */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث عن مشروع بالاسم أو الرمز أو الموقع..."
              className="pr-9 text-right"
              dir="rtl"
            />
          </div>
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="icon"
            onClick={() => setShowFilters(!showFilters)}
            className={showFilters ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
          >
            <Filter className="h-4 w-4" />
          </Button>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground ml-1">الحالة:</span>
                {[
                  { value: 'ALL', label: 'الكل' },
                  { value: 'ACTIVE', label: 'نشط' },
                  { value: 'IN_PROGRESS', label: 'قيد التنفيذ' },
                  { value: 'ON_HOLD', label: 'معلق' },
                  { value: 'COMPLETED', label: 'مكتمل' },
                  { value: 'CANCELLED', label: 'ملغى' },
                ].map((opt) => (
                  <Button
                    key={opt.value}
                    variant={statusFilter === opt.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter(opt.value)}
                    className={
                      statusFilter === opt.value
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7'
                        : 'text-xs h-7'
                    }
                  >
                    {opt.label}
                    {statusCounts[opt.value] !== undefined && (
                      <span className="mr-1 opacity-70">({statusCounts[opt.value]})</span>
                    )}
                  </Button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Project Grid */}
      {filteredProjects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <Building2 className="h-14 w-14 mx-auto mb-3 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground mb-1">
              {searchQuery || statusFilter !== 'ALL'
                ? 'لا توجد نتائج مطابقة للبحث'
                : 'لا توجد مشاريع بعد'}
            </p>
            <p className="text-xs text-muted-foreground">
              {searchQuery || statusFilter !== 'ALL'
                ? 'جرّب تغيير معايير البحث أو الفلتر'
                : 'ابدأ بإنشاء مشروع جديد لإدارة العمليات الميدانية'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isSelected={selectedProjectId === project.id}
              onClick={() => onSelectProject(project)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
