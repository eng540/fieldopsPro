// FieldOps V4 — Enhanced Quality Screen
// Arabic RTL interface for managing quality remarks, observations, and photo documentation

'use client'

import React, { useState, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Camera,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  ImageIcon,
  Eye,
  Trash2,
  XCircle,
  WifiOff,
  Loader2,
  ArrowLeft,
  ImagePlus,
  Navigation,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useOnlineStatus } from '@/lib/sync-hooks'
import { saveRemarkOffline } from '@/lib/offline-db'
import { MediaUploadPanel } from '@/components/fieldops/MediaUploadPanel'

// ============================================================
// Types
// ============================================================

interface ProjectData {
  id: string
  orgId: string
  name: string
  code: string
  status: string
  location: string | null
  totalUnits: number
  completionPct: number
  isActive: boolean
  units: UnitData[]
  assignments: { user: { id: string; name: string; email: string }; role: { name: string } }[]
}

interface UnitData {
  id: string
  orgId: string
  projectId: string
  name: string
  code: string
  unitType: string
  floor: string | null
  areaSqm: number | null
  status: string
  completionPct: number
  boqItems: BoqItemData[]
}

interface BoqItemData {
  id: string
  orgId: string
  unitId: string
  trade: string
  description: string
  quantity: number
  unitOfMeasure: string
  completionPct: number
}

interface RemarkData {
  id: string
  orgId: string
  unitId: string
  unit: { id: string; name: string; code: string }
  workOrderId: string | null
  templateId: string | null
  customIssue: string | null
  severity: string
  status: string
  photos: string[]
  gpsTag: Record<string, unknown> | null
  resolutionNotes: string | null
  createdBy: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

interface QualityScreenProps {
  project: ProjectData | null
  remarks: RemarkData[]
  orgId: string
  onRefresh: () => void
}

// ============================================================
// Constants
// ============================================================

const SEVERITY_COLORS: Record<string, string> = {
  MINOR: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  MAJOR: 'bg-orange-100 text-orange-800 border-orange-200',
  CRITICAL: 'bg-red-100 text-red-800 border-red-200',
}

const SEVERITY_AR: Record<string, string> = {
  MINOR: 'ثانوي',
  MAJOR: 'رئيسي',
  CRITICAL: 'حرج',
}

const STATUS_AR: Record<string, string> = {
  OPEN: 'مفتوح',
  IN_REVIEW: 'قيد المراجعة',
  RESOLVED: 'تم الحل',
  CLOSED: 'مغلق',
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-red-100 text-red-700 border-red-200',
  IN_REVIEW: 'bg-amber-100 text-amber-700 border-amber-200',
  RESOLVED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-gray-100 text-gray-700 border-gray-200',
}

// ============================================================
// Helper Functions
// ============================================================

function formatDateAr(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function formatRelativeTime(dateStr: string): string {
  try {
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    const diffMs = now - then
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr = Math.floor(diffMs / 3600000)
    const diffDay = Math.floor(diffMs / 86400000)

    if (diffMin < 1) return 'الآن'
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`
    if (diffHr < 24) return `منذ ${diffHr} ساعة`
    if (diffDay < 7) return `منذ ${diffDay} يوم`
    return formatDateAr(dateStr)
  } catch {
    return dateStr
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'OPEN':
      return <AlertTriangle className="w-3.5 h-3.5" />
    case 'IN_REVIEW':
      return <Clock className="w-3.5 h-3.5" />
    case 'RESOLVED':
      return <CheckCircle2 className="w-3.5 h-3.5" />
    case 'CLOSED':
      return <XCircle className="w-3.5 h-3.5" />
    default:
      return <AlertCircle className="w-3.5 h-3.5" />
  }
}

// ============================================================
// Main Component
// ============================================================

export function QualityScreen({ project, remarks, orgId, onRefresh }: QualityScreenProps) {
  const isOnline = useOnlineStatus()
  const { toast } = useToast()

  // ---- State ----
  const [searchText, setSearchText] = useState('')
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL')
  const [filterStatus, setFilterStatus] = useState<string>('ALL')
  const [filterUnit, setFilterUnit] = useState<string>('ALL')

  // Create remark dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [createUnitId, setCreateUnitId] = useState('')
  const [createSeverity, setCreateSeverity] = useState<string>('MINOR')
  const [createIssue, setCreateIssue] = useState('')
  const [createGps, setCreateGps] = useState<Record<string, unknown> | null>(null)
  const [createGpsCapturing, setCreateGpsCapturing] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)
  const [newRemarkId, setNewRemarkId] = useState<string | null>(null)

  // Detail view
  const [selectedRemark, setSelectedRemark] = useState<RemarkData | null>(null)

  // Resolve dialog
  const [resolveOpen, setResolveOpen] = useState(false)
  const [resolveRemarkId, setResolveRemarkId] = useState<string | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [resolveSaving, setResolveSaving] = useState(false)

  // Photo preview
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('')

  // ---- Derived ----
  const units = project?.units || []

  const filteredRemarks = useMemo(() => {
    let result = remarks

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      result = result.filter(
        (r) =>
          (r.customIssue && r.customIssue.toLowerCase().includes(q)) ||
          r.unit.name.toLowerCase().includes(q) ||
          r.unit.code.toLowerCase().includes(q) ||
          r.severity.toLowerCase().includes(q)
      )
    }

    if (filterSeverity !== 'ALL') {
      result = result.filter((r) => r.severity === filterSeverity)
    }

    if (filterStatus !== 'ALL') {
      result = result.filter((r) => r.status === filterStatus)
    }

    if (filterUnit !== 'ALL') {
      result = result.filter((r) => r.unitId === filterUnit)
    }

    return result
  }, [remarks, searchText, filterSeverity, filterStatus, filterUnit])

  // Stats
  const stats = useMemo(() => {
    const openCount = remarks.filter((r) => r.status === 'OPEN').length
    const criticalCount = remarks.filter(
      (r) => r.severity === 'CRITICAL' && r.status === 'OPEN'
    ).length
    const majorCount = remarks.filter(
      (r) => r.severity === 'MAJOR' && r.status === 'OPEN'
    ).length
    const resolvedCount = remarks.filter((r) => r.status === 'RESOLVED').length
    return { openCount, criticalCount, majorCount, resolvedCount }
  }, [remarks])

  // ---- GPS Capture ----
  const handleCaptureGps = useCallback(() => {
    if (!navigator.geolocation) {
      toast({
        title: 'غير متاح',
        description: 'خدمة تحديد الموقع غير متاحة على هذا الجهاز',
        variant: 'destructive',
      })
      return
    }

    setCreateGpsCapturing(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCreateGps({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          timestamp: position.timestamp,
        })
        setCreateGpsCapturing(false)
        toast({
          title: 'تم التقاط الموقع',
          description: `خط العرض: ${position.coords.latitude.toFixed(4)}، خط الطول: ${position.coords.longitude.toFixed(4)}`,
        })
      },
      (error) => {
        setCreateGpsCapturing(false)
        toast({
          title: 'خطأ في تحديد الموقع',
          description:
            error.code === 1
              ? 'تم رفض إذن تحديد الموقع'
              : 'تعذر تحديد الموقع الحالي',
          variant: 'destructive',
        })
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }, [toast])

  // ---- Create Remark ----
  const handleCreateRemark = useCallback(async () => {
    if (!createUnitId) {
      toast({
        title: 'بيانات ناقصة',
        description: 'الرجاء اختيار الوحدة',
        variant: 'destructive',
      })
      return
    }

    if (!createIssue.trim()) {
      toast({
        title: 'بيانات ناقصة',
        description: 'الرجاء إدخال وصف المشكلة',
        variant: 'destructive',
      })
      return
    }

    setCreateSaving(true)

    try {
      if (isOnline) {
        const res = await fetch('/api/quality/remarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            unitId: createUnitId,
            severity: createSeverity,
            customIssue: createIssue.trim(),
            photos: [],
            gpsTag: createGps,
            createdBy: 'current-user',
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'فشل إنشاء الملاحظة')
        }

        const data = await res.json()
        const remarkId = data.remark?.id || data.id
        setNewRemarkId(remarkId)

        toast({
          title: 'تم إنشاء الملاحظة',
          description: 'تم إنشاء ملاحظة الجودة بنجاح',
        })
      } else {
        // Offline-first save
        const remarkId = await saveRemarkOffline(
          orgId,
          createUnitId,
          createSeverity,
          createIssue.trim(),
          [],
          createGps
        )
        setNewRemarkId(remarkId)

        toast({
          title: 'تم الحفظ محلياً',
          description: 'تم حفظ الملاحظة محلياً وستُرسل عند الاتصال',
        })
      }

      onRefresh()
    } catch (error) {
      toast({
        title: 'خطأ',
        description: error instanceof Error ? error.message : 'فشل إنشاء الملاحظة',
        variant: 'destructive',
      })
    } finally {
      setCreateSaving(false)
    }
  }, [orgId, createUnitId, createSeverity, createIssue, createGps, isOnline, onRefresh, toast])

  // ---- Resolve Remark ----
  const handleResolveRemark = useCallback(async () => {
    if (!resolveRemarkId) return

    if (!resolutionNotes.trim()) {
      toast({
        title: 'بيانات ناقصة',
        description: 'الرجاء إدخال ملاحظات الحل',
        variant: 'destructive',
      })
      return
    }

    setResolveSaving(true)

    try {
      if (isOnline) {
        const res = await fetch(`/api/quality/remarks?id=${resolveRemarkId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'RESOLVED',
            resolutionNotes: resolutionNotes.trim(),
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'فشل حل الملاحظة')
        }

        toast({
          title: 'تم الحل',
          description: 'تم حل ملاحظة الجودة بنجاح',
        })
      } else {
        // Save resolution offline
        await saveRemarkOffline(
          orgId,
          resolveRemarkId,
          'RESOLVED',
          resolutionNotes.trim()
        )
        toast({
          title: 'تم الحفظ محلياً',
          description: 'تم حفظ الحل محلياً وسيُرسل عند الاتصال',
        })
      }

      setResolveOpen(false)
      setResolveRemarkId(null)
      setResolutionNotes('')
      setSelectedRemark(null)
      onRefresh()
    } catch (error) {
      toast({
        title: 'خطأ',
        description: error instanceof Error ? error.message : 'فشل حل الملاحظة',
        variant: 'destructive',
      })
    } finally {
      setResolveSaving(false)
    }
  }, [resolveRemarkId, resolutionNotes, isOnline, orgId, onRefresh, toast])

  // ---- Open Resolve Dialog ----
  const openResolveDialog = useCallback(
    (remarkId: string) => {
      setResolveRemarkId(remarkId)
      setResolutionNotes('')
      setResolveOpen(true)
    },
    []
  )

  // ---- Photo Preview ----
  const openPhotoPreview = useCallback((url: string) => {
    setPhotoPreviewUrl(url)
    setPhotoPreviewOpen(true)
  }, [])

  // ---- Reset Create Form ----
  const resetCreateForm = useCallback(() => {
    setCreateUnitId('')
    setCreateSeverity('MINOR')
    setCreateIssue('')
    setCreateGps(null)
    setCreateGpsCapturing(false)
    setNewRemarkId(null)
  }, [])

  // ============================================================
  // Render
  // ============================================================

  return (
    <div dir="rtl" className="flex flex-col h-full min-h-screen bg-gray-50">
      {/* ========== Header ========== */}
      <div className="sticky top-0 z-20 bg-white border-b border-emerald-100 shadow-sm">
        <div className="px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-900">
                  مراقبة الجودة
                </h1>
                <p className="text-xs text-gray-500 mt-0.5">
                  {project ? project.name : 'جميع المشاريع'} — {remarks.length} ملاحظة
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Offline Badge */}
              {!isOnline && (
                <Badge
                  variant="outline"
                  className="border-amber-300 text-amber-700 bg-amber-50 gap-1 text-xs"
                >
                  <WifiOff className="w-3 h-3" />
                  غير متصل
                </Badge>
              )}

              {/* Stats Badges */}
              {stats.criticalCount > 0 && (
                <Badge className="bg-red-100 text-red-700 border border-red-200 text-xs gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {stats.criticalCount} حرج
                </Badge>
              )}

              {/* New Remark Button */}
              <Dialog
                open={createOpen}
                onOpenChange={(open) => {
                  setCreateOpen(open)
                  if (!open) resetCreateForm()
                }}
              >
                <DialogTrigger asChild>
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-md">
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">ملاحظة جديدة</span>
                    <span className="sm:hidden">جديد</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
                  <DialogHeader>
                    <DialogTitle className="text-right text-emerald-800">
                      إنشاء ملاحظة جودة جديدة
                    </DialogTitle>
                    <DialogDescription className="text-right">
                      سجّل ملاحظة أو مشكلة جودة مع الصور والموقع
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 mt-2">
                    {/* Unit Selector */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-700">
                        الوحدة <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={createUnitId}
                        onValueChange={setCreateUnitId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="اختر الوحدة" />
                        </SelectTrigger>
                        <SelectContent>
                          {units.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} ({u.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Severity Selector */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-700">
                        درجة الخطورة <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={createSeverity}
                        onValueChange={setCreateSeverity}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="اختر درجة الخطورة" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MINOR">
                            <span className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-yellow-500" />
                              ثانوي
                            </span>
                          </SelectItem>
                          <SelectItem value="MAJOR">
                            <span className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-orange-500" />
                              رئيسي
                            </span>
                          </SelectItem>
                          <SelectItem value="CRITICAL">
                            <span className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-red-500" />
                              حرج
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {(createSeverity === 'CRITICAL' || createSeverity === 'MAJOR') && (
                        <Alert className="border-red-200 bg-red-50">
                          <AlertTriangle className="w-4 h-4 text-red-600" />
                          <AlertDescription className="text-red-700 text-xs">
                            سيتم تفعيل إيقاف الحوكمة تلقائياً لهذه الدرجة
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>

                    {/* Custom Issue */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-700">
                        وصف المشكلة <span className="text-red-500">*</span>
                      </Label>
                      <Textarea
                        value={createIssue}
                        onChange={(e) => setCreateIssue(e.target.value)}
                        placeholder="صف المشكلة أو الملاحظة بالتفصيل..."
                        rows={4}
                        className="resize-none"
                      />
                    </div>

                    {/* GPS Capture */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-700">
                        الموقع الجغرافي
                      </Label>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCaptureGps}
                          disabled={createGpsCapturing}
                          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 gap-2"
                        >
                          {createGpsCapturing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Navigation className="w-4 h-4" />
                          )}
                          {createGpsCapturing ? 'جاري التحديد...' : 'التقاط الموقع'}
                        </Button>
                        {createGps && (
                          <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs gap-1">
                            <MapPin className="w-3 h-3" />
                            {(createGps.lat as number).toFixed(4)},{' '}
                            {(createGps.lng as number).toFixed(4)}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Media Upload (after remark is created) */}
                    {newRemarkId && (
                      <div className="space-y-2">
                        <Separator />
                        <Label className="text-sm font-medium text-gray-700">
                          إضافة صور
                        </Label>
                        <MediaUploadPanel
                          remarkId={newRemarkId}
                          orgId={orgId}
                          onUploadComplete={() => onRefresh()}
                        />
                      </div>
                    )}

                    {/* Offline Notice */}
                    {!isOnline && (
                      <Alert className="border-amber-200 bg-amber-50">
                        <WifiOff className="w-4 h-4 text-amber-600" />
                        <AlertDescription className="text-amber-700 text-xs">
                          وضع عدم الاتصال — سيتم حفظ الملاحظة محلياً وستُرسل عند الاتصال
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>

                  <DialogFooter className="gap-2 sm:gap-0 mt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCreateOpen(false)
                        resetCreateForm()
                      }}
                      className="border-gray-300"
                    >
                      إلغاء
                    </Button>
                    <Button
                      type="button"
                      onClick={handleCreateRemark}
                      disabled={createSaving || !createUnitId || !createIssue.trim()}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 min-w-[120px]"
                    >
                      {createSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          جاري الحفظ...
                        </>
                      ) : isOnline ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          إنشاء الملاحظة
                        </>
                      ) : (
                        <>
                          <WifiOff className="w-4 h-4" />
                          حفظ محلياً
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex items-center gap-3 mt-3 overflow-x-auto pb-1">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100 shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
              <span className="text-xs font-medium text-red-700">{stats.openCount} مفتوح</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-100 shrink-0">
              <AlertCircle className="w-3.5 h-3.5 text-orange-600" />
              <span className="text-xs font-medium text-orange-700">{stats.majorCount} رئيسي</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-medium text-emerald-700">{stats.resolvedCount} تم الحل</span>
            </div>
          </div>
        </div>
      </div>

      {/* ========== Filter Bar ========== */}
      <div className="px-4 sm:px-6 py-3 bg-white border-b border-gray-100">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="بحث في الملاحظات..."
              className="pr-10 pl-4 h-9 text-sm"
            />
          </div>

          {/* Severity Filter */}
          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-[130px] h-9 text-sm">
              <Filter className="w-3.5 h-3.5 ml-1 text-gray-400" />
              <SelectValue placeholder="الخطورة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">الكل</SelectItem>
              <SelectItem value="MINOR">ثانوي</SelectItem>
              <SelectItem value="MAJOR">رئيسي</SelectItem>
              <SelectItem value="CRITICAL">حرج</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px] h-9 text-sm">
              <Clock className="w-3.5 h-3.5 ml-1 text-gray-400" />
              <SelectValue placeholder="الحالة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">الكل</SelectItem>
              <SelectItem value="OPEN">مفتوح</SelectItem>
              <SelectItem value="IN_REVIEW">قيد المراجعة</SelectItem>
              <SelectItem value="RESOLVED">تم الحل</SelectItem>
              <SelectItem value="CLOSED">مغلق</SelectItem>
            </SelectContent>
          </Select>

          {/* Unit Filter */}
          <Select value={filterUnit} onValueChange={setFilterUnit}>
            <SelectTrigger className="w-[150px] h-9 text-sm">
              <MapPin className="w-3.5 h-3.5 ml-1 text-gray-400" />
              <SelectValue placeholder="الوحدة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">جميع الوحدات</SelectItem>
              {units.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ========== Main Content ========== */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Remarks List */}
        <div
          className={`flex-1 ${
            selectedRemark ? 'hidden lg:block lg:w-1/2' : 'w-full'
          }`}
        >
          <ScrollArea className="h-[calc(100vh-220px)]">
            <div className="p-4 sm:p-6 space-y-3">
              {filteredRemarks.length === 0 ? (
                <Card className="border-gray-200 bg-white">
                  <CardContent className="p-12 text-center">
                    <CheckCircle2 className="w-16 h-16 text-emerald-200 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">
                      لا توجد ملاحظات
                    </h3>
                    <p className="text-sm text-gray-500">
                      {searchText || filterSeverity !== 'ALL' || filterStatus !== 'ALL'
                        ? 'لم يتم العثور على نتائج مطابقة للبحث'
                        : 'الجودة ممتازة! لا توجد ملاحظات مسجلة'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                filteredRemarks.map((remark) => (
                  <RemarkCard
                    key={remark.id}
                    remark={remark}
                    isSelected={selectedRemark?.id === remark.id}
                    onClick={() => setSelectedRemark(remark)}
                    onResolve={() => openResolveDialog(remark.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Detail View */}
        {selectedRemark && (
          <div className="lg:w-1/2 border-r border-gray-200 bg-white">
            <RemarkDetailView
              remark={selectedRemark}
              onBack={() => setSelectedRemark(null)}
              onResolve={() => openResolveDialog(selectedRemark.id)}
              onPhotoPreview={openPhotoPreview}
            />
          </div>
        )}
      </div>

      {/* ========== Resolve Dialog ========== */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right text-emerald-800">
              حل الملاحظة
            </DialogTitle>
            <DialogDescription className="text-right">
              أدخل ملاحظات الحل لإغلاق هذه الملاحظة
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">
                ملاحظات الحل <span className="text-red-500">*</span>
              </Label>
              <Textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="صف الإجراءات المتخذة لحل المشكلة..."
                rows={5}
                className="resize-none"
              />
            </div>

            {!isOnline && (
              <Alert className="border-amber-200 bg-amber-50">
                <WifiOff className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-700 text-xs">
                  وضع عدم الاتصال — سيتم حفظ الحل محلياً
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setResolveOpen(false)}
              className="border-gray-300"
            >
              إلغاء
            </Button>
            <Button
              type="button"
              onClick={handleResolveRemark}
              disabled={resolveSaving || !resolutionNotes.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 min-w-[120px]"
            >
              {resolveSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  تأكيد الحل
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== Photo Preview Dialog ========== */}
      <Dialog open={photoPreviewOpen} onOpenChange={setPhotoPreviewOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">معاينة الصورة</DialogTitle>
            <DialogDescription className="text-right">
              عرض الصورة بالحجم الكامل
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center max-h-[70vh]">
            <img
              src={photoPreviewUrl}
              alt="صورة الملاحظة"
              className="w-full h-full object-contain"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPhotoPreviewOpen(false)}
              className="border-gray-300"
            >
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================
// RemarkCard Sub-component
// ============================================================

interface RemarkCardProps {
  remark: RemarkData
  isSelected: boolean
  onClick: () => void
  onResolve: () => void
}

function RemarkCard({ remark, isSelected, onClick, onResolve }: RemarkCardProps) {
  const severityColor = SEVERITY_COLORS[remark.severity] || 'bg-gray-100 text-gray-800 border-gray-200'
  const statusColor = STATUS_COLORS[remark.status] || 'bg-gray-100 text-gray-700 border-gray-200'

  return (
    <Card
      className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
        isSelected
          ? 'border-emerald-400 ring-2 ring-emerald-200 shadow-md'
          : 'border-gray-200 hover:border-emerald-200'
      }`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Badges Row */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <Badge
                className={`text-xs font-semibold px-2 py-0.5 border ${severityColor}`}
              >
                {SEVERITY_AR[remark.severity] || remark.severity}
              </Badge>
              <Badge
                className={`text-xs px-2 py-0.5 border ${statusColor} gap-1`}
              >
                {getStatusIcon(remark.status)}
                {STATUS_AR[remark.status] || remark.status}
              </Badge>
              {remark.photos.length > 0 && (
                <Badge
                  variant="outline"
                  className="text-xs px-2 py-0.5 border-gray-200 text-gray-600 gap-1"
                >
                  <Camera className="w-3 h-3" />
                  {remark.photos.length}
                </Badge>
              )}
              {remark.gpsTag && (
                <Badge
                  variant="outline"
                  className="text-xs px-2 py-0.5 border-emerald-200 text-emerald-600 gap-1"
                >
                  <MapPin className="w-3 h-3" />
                  GPS
                </Badge>
              )}
            </div>

            {/* Issue Text */}
            <p className="text-sm font-medium text-gray-800 leading-relaxed mb-1.5 line-clamp-2">
              {remark.customIssue || 'ملاحظة من القالب'}
            </p>

            {/* Unit & Time */}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {remark.unit.name} ({remark.unit.code})
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatRelativeTime(remark.createdAt)}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-gray-400 hover:text-emerald-600"
              onClick={(e) => {
                e.stopPropagation()
                onClick()
              }}
              aria-label="عرض التفاصيل"
            >
              <Eye className="w-4 h-4" />
            </Button>
            {(remark.status === 'OPEN' || remark.status === 'IN_REVIEW') && (
              <Button
                size="sm"
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2"
                onClick={(e) => {
                  e.stopPropagation()
                  onResolve()
                }}
              >
                <CheckCircle2 className="w-3 h-3 ml-1" />
                حل
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// RemarkDetailView Sub-component
// ============================================================

interface RemarkDetailViewProps {
  remark: RemarkData
  onBack: () => void
  onResolve: () => void
  onPhotoPreview: (url: string) => void
}

function RemarkDetailView({ remark, onBack, onResolve, onPhotoPreview }: RemarkDetailViewProps) {
  const severityColor = SEVERITY_COLORS[remark.severity] || 'bg-gray-100 text-gray-800 border-gray-200'
  const statusColor = STATUS_COLORS[remark.status] || 'bg-gray-100 text-gray-700 border-gray-200'

  return (
    <ScrollArea className="h-[calc(100vh-220px)]">
      <div className="p-4 sm:p-6 space-y-5">
        {/* Back Button */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-gray-600 hover:text-emerald-700 lg:hidden"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4" />
          العودة للقائمة
        </Button>

        {/* Title & Status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge className={`text-xs font-semibold px-2.5 py-1 border ${severityColor}`}>
                {SEVERITY_AR[remark.severity] || remark.severity}
              </Badge>
              <Badge className={`text-xs px-2.5 py-1 border ${statusColor} gap-1`}>
                {getStatusIcon(remark.status)}
                {STATUS_AR[remark.status] || remark.status}
              </Badge>
            </div>
            <h2 className="text-base font-bold text-gray-900 leading-relaxed">
              {remark.customIssue || 'ملاحظة من القالب'}
            </h2>
          </div>
          {(remark.status === 'OPEN' || remark.status === 'IN_REVIEW') && (
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shrink-0"
              onClick={onResolve}
            >
              <CheckCircle2 className="w-4 h-4" />
              حل الملاحظة
            </Button>
          )}
        </div>

        <Separator />

        {/* Unit Info */}
        <Card className="border-gray-200 bg-gray-50">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600" />
              معلومات الوحدة
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">اسم الوحدة</p>
                <p className="font-medium text-gray-900">{remark.unit.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">رمز الوحدة</p>
                <p className="font-medium text-gray-900">{remark.unit.code}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* GPS Info */}
        {remark.gpsTag && (
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <Navigation className="w-4 h-4 text-emerald-600" />
                الموقع الجغرافي
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">خط العرض</p>
                  <p className="font-mono font-medium text-gray-900">
                    {remark.gpsTag.lat as number}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">خط الطول</p>
                  <p className="font-mono font-medium text-gray-900">
                    {remark.gpsTag.lng as number}
                  </p>
                </div>
                {typeof remark.gpsTag.accuracy === 'number' && (
                  <div>
                    <p className="text-xs text-gray-500">الدقة</p>
                    <p className="font-medium text-gray-900">
                      {remark.gpsTag.accuracy as number} متر
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Photo Gallery */}
        {remark.photos.length > 0 && (
          <Card className="border-gray-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-emerald-600" />
                الصور ({remark.photos.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-3 gap-2">
                {remark.photos.map((photoUrl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onPhotoPreview(photoUrl)}
                    className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200 hover:ring-2 hover:ring-emerald-400 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    aria-label={`عرض الصورة ${idx + 1}`}
                  >
                    <img
                      src={photoUrl}
                      alt={`صورة الملاحظة ${idx + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // Show placeholder for broken images
                        const target = e.currentTarget
                        target.style.display = 'none'
                        if (target.parentElement) {
                          target.parentElement.innerHTML = `
                            <div class="flex items-center justify-center w-full h-full bg-gray-100">
                              <svg class="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          `
                        }
                      }}
                    />
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center">
                      <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Media Upload Panel */}
        <Card className="border-gray-200">
          <CardContent className="p-4">
            <MediaUploadPanel
              remarkId={remark.id}
              orgId={remark.orgId}
              onUploadComplete={() => {}}
            />
          </CardContent>
        </Card>

        {/* Resolution Notes */}
        {remark.resolutionNotes && (
          <Card className="border-emerald-200 bg-emerald-50/30">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-emerald-800 mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ملاحظات الحل
              </h3>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {remark.resolutionNotes}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Timeline */}
        <Card className="border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock className="w-4 h-4 text-emerald-600" />
              الجدول الزمني
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-3">
              {/* Created */}
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 mt-2 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-800">تم الإنشاء</p>
                  <p className="text-xs text-gray-500">{formatDateAr(remark.createdAt)}</p>
                </div>
              </div>

              {/* Resolved */}
              {remark.resolvedAt && (
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 mt-2 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">تم الحل</p>
                    <p className="text-xs text-gray-500">{formatDateAr(remark.resolvedAt)}</p>
                  </div>
                </div>
              )}

              {/* Last Updated */}
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-gray-300 mt-2 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-600">آخر تحديث</p>
                  <p className="text-xs text-gray-500">{formatDateAr(remark.updatedAt)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  )
}
