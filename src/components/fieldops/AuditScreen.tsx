// FieldOps V4 — Audit Screen
// Enhanced audit log viewer with virtualized rendering, search, filters, and export

'use client'

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import {
  History, Search, Filter, Download, ChevronDown, ChevronUp,
  Shield, Building2, User, BookOpen, Camera, Zap, FileText,
  Lock, Database, Clock, AlertCircle, Loader2, RefreshCw,
  Activity, Eye, FileSpreadsheet, Users, Settings, Trash2
} from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'

// ============================================================
// Types
// ============================================================

interface AuditLogData {
  id: string; user: { name: string; email: string } | null; action: string;
  resourceType: string; resourceId: string | null; details: Record<string, unknown>;
  createdAt: string
}

interface AuditScreenProps {
  auditLogs: AuditLogData[]
  orgId: string
  onRefresh: () => void
}

// ============================================================
// Constants
// ============================================================

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'تسجيل دخول',
  CREATE_PROJECT: 'إنشاء مشروع',
  UPDATE_PROGRESS: 'تحديث الإنجاز',
  UPLOAD_PHOTO: 'رفع صورة',
  ASSIGN_ROLE: 'تعيين صلاحية',
  BULK_IMPORT: 'استيراد جماعي',
  CREATE_REMARK: 'إنشاء ملاحظة',
  CHANGE_PERMISSIONS: 'تغيير الصلاحيات',
  REGISTER_USER: 'تسجيل مستخدم',
  CREATE_DICTIONARY: 'إنشاء قاموس',
  BULK_PROGRESS_UPDATE: 'تحديث جماعي',
}

const RESOURCE_LABELS: Record<string, string> = {
  auth: 'المصادقة',
  project: 'مشروع',
  unit: 'وحدة',
  remark: 'ملاحظة',
  user: 'مستخدم',
  dictionary: 'قاموس',
  execution: 'تنفيذ',
}

const ACTION_COLORS: Record<string, string> = {
  LOGIN: 'bg-gray-100 text-gray-700 border-gray-200',
  CREATE_PROJECT: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  UPDATE_PROGRESS: 'bg-blue-100 text-blue-700 border-blue-200',
  UPLOAD_PHOTO: 'bg-purple-100 text-purple-700 border-purple-200',
  ASSIGN_ROLE: 'bg-amber-100 text-amber-700 border-amber-200',
  BULK_IMPORT: 'bg-teal-100 text-teal-700 border-teal-200',
  CREATE_REMARK: 'bg-orange-100 text-orange-700 border-orange-200',
  CHANGE_PERMISSIONS: 'bg-red-100 text-red-700 border-red-200',
  REGISTER_USER: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  CREATE_DICTIONARY: 'bg-pink-100 text-pink-700 border-pink-200',
  BULK_PROGRESS_UPDATE: 'bg-indigo-100 text-indigo-700 border-indigo-200',
}

const RESOURCE_ICONS: Record<string, React.ElementType> = {
  auth: Lock,
  project: Building2,
  unit: FileText,
  remark: Camera,
  user: User,
  dictionary: BookOpen,
  execution: Zap,
}

const PAGE_SIZE = 50

// ============================================================
// Relative Timestamp in Arabic
// ============================================================

function getRelativeTimeArabic(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  const diffWeek = Math.floor(diffDay / 7)
  const diffMonth = Math.floor(diffDay / 30)
  const diffYear = Math.floor(diffDay / 365)

  if (diffSec < 10) return 'الآن'
  if (diffSec < 60) return `منذ ${diffSec} ثانية`
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`
  if (diffHour < 24) return `منذ ${diffHour} ساعة`
  if (diffDay < 7) return `منذ ${diffDay} يوم`
  if (diffWeek < 4) return `منذ ${diffWeek} أسبوع`
  if (diffMonth < 12) return `منذ ${diffMonth} شهر`
  return `منذ ${diffYear} سنة`
}

// ============================================================
// Component
// ============================================================

export function AuditScreen({ auditLogs, orgId, onRefresh }: AuditScreenProps) {
  const { toast } = useToast()

  // Filter state
  const [searchTerm, setSearchTerm] = useState('')
  const [filterAction, setFilterAction] = useState<string>('all')
  const [filterResource, setFilterResource] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)

  // Expand state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [isExporting, setIsExporting] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Virtualizer ref
  const parentRef = useRef<HTMLDivElement>(null)

  // ============================================================
  // Filtered Data
  // ============================================================

  const filteredLogs = useMemo(() => {
    return auditLogs.filter(log => {
      // Action filter
      if (filterAction !== 'all' && log.action !== filterAction) return false

      // Resource type filter
      if (filterResource !== 'all' && log.resourceType !== filterResource) return false

      // Date range filter
      if (dateFrom) {
        const logDate = new Date(log.createdAt)
        const fromDate = new Date(dateFrom)
        if (logDate < fromDate) return false
      }
      if (dateTo) {
        const logDate = new Date(log.createdAt)
        const toDate = new Date(dateTo)
        toDate.setHours(23, 59, 59, 999)
        if (logDate > toDate) return false
      }

      // Search filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        const nameMatch = log.user?.name?.toLowerCase().includes(term)
        const emailMatch = log.user?.email?.toLowerCase().includes(term)
        const actionMatch = (ACTION_LABELS[log.action] || log.action).toLowerCase().includes(term)
        const resourceMatch = (RESOURCE_LABELS[log.resourceType] || log.resourceType).toLowerCase().includes(term)
        const detailMatch = JSON.stringify(log.details).toLowerCase().includes(term)
        if (!nameMatch && !emailMatch && !actionMatch && !resourceMatch && !detailMatch) return false
      }

      return true
    })
  }, [auditLogs, filterAction, filterResource, searchTerm, dateFrom, dateTo])

  // ============================================================
  // Pagination
  // ============================================================

  const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE)
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredLogs.slice(start, start + PAGE_SIZE)
  }, [filteredLogs, currentPage])

  // ============================================================
  // Virtualizer
  // ============================================================

  const virtualizer = useVirtualizer({
    count: paginatedLogs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  })

  // ============================================================
  // Expand/Collapse
  // ============================================================

  const toggleExpand = useCallback((id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ============================================================
  // Unique filter values
  // ============================================================

  const uniqueActions = useMemo(() => [...new Set(auditLogs.map(l => l.action))], [auditLogs])
  const uniqueResources = useMemo(() => [...new Set(auditLogs.map(l => l.resourceType))], [auditLogs])

  // ============================================================
  // Export to CSV
  // ============================================================

  const handleExportCSV = useCallback(async () => {
    setIsExporting(true)
    try {
      const Papa = (await import('papaparse')).default
      const exportData = filteredLogs.map(log => ({
        'المستخدم': log.user?.name || 'النظام',
        'البريد الإلكتروني': log.user?.email || '',
        'العملية': ACTION_LABELS[log.action] || log.action,
        'رمز العملية': log.action,
        'نوع العنصر': RESOURCE_LABELS[log.resourceType] || log.resourceType,
        'معرف العنصر': log.resourceId || '',
        'التفاصيل': JSON.stringify(log.details),
        'التاريخ': new Date(log.createdAt).toLocaleString('ar-SA'),
        'التاريخ (ISO)': log.createdAt,
      }))

      const csv = Papa.unparse(exportData)
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`
      link.click()
      URL.revokeObjectURL(url)

      toast({ title: 'تم التصدير', description: `تم تصدير ${filteredLogs.length} سجل` })
    } catch (err) {
      toast({ title: 'خطأ في التصدير', description: 'فشل تصدير البيانات', variant: 'destructive' })
    } finally {
      setIsExporting(false)
    }
  }, [filteredLogs, toast])

  // ============================================================
  // Load more (for pagination)
  // ============================================================

  const handleLoadMore = useCallback(() => {
    setIsLoadingMore(true)
    setTimeout(() => {
      setCurrentPage(prev => Math.min(prev + 1, totalPages))
      setIsLoadingMore(false)
    }, 300)
  }, [totalPages])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, filterAction, filterResource, dateFrom, dateTo])

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">سجل التدقيق والنشاط</h2>
          <p className="text-sm text-gray-500 mt-1">تتبع جميع العمليات والتغييرات في النظام</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={onRefresh}>
            <RefreshCw className="w-3.5 h-3.5 ml-1" />
            تحديث
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={handleExportCSV}
            disabled={isExporting || filteredLogs.length === 0}
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <Download className="w-3.5 h-3.5 ml-1" />}
            تصدير CSV
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-3">
            {/* Search Bar */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  className="pr-9"
                  placeholder="بحث بالاسم أو العملية أو التفاصيل..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <Button
                variant={showFilters ? 'default' : 'outline'}
                size="sm"
                className="text-xs"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="w-3.5 h-3.5 ml-1" />
                فلاتر
              </Button>
              <Badge variant="outline" className="text-xs bg-gray-50">
                {filteredLogs.length} سجل
              </Badge>
            </div>

            {/* Expandable Filters */}
            {showFilters && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-gray-100">
                <div>
                  <Label className="text-xs text-gray-600 mb-1.5 block">نوع العملية</Label>
                  <Select value={filterAction} onValueChange={setFilterAction}>
                    <SelectTrigger className="text-xs h-9">
                      <SelectValue placeholder="جميع العمليات" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">جميع العمليات</SelectItem>
                      {uniqueActions.map(a => (
                        <SelectItem key={a} value={a}>{ACTION_LABELS[a] || a}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-gray-600 mb-1.5 block">نوع العنصر</Label>
                  <Select value={filterResource} onValueChange={setFilterResource}>
                    <SelectTrigger className="text-xs h-9">
                      <SelectValue placeholder="جميع العناصر" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">جميع العناصر</SelectItem>
                      {uniqueResources.map(r => (
                        <SelectItem key={r} value={r}>{RESOURCE_LABELS[r] || r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-gray-600 mb-1.5 block">من تاريخ</Label>
                  <Input
                    type="date"
                    className="text-xs h-9"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                  />
                </div>

                <div>
                  <Label className="text-xs text-gray-600 mb-1.5 block">إلى تاريخ</Label>
                  <Input
                    type="date"
                    className="text-xs h-9"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                  />
                </div>

                <div className="col-span-2 md:col-span-4 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setFilterAction('all')
                      setFilterResource('all')
                      setDateFrom('')
                      setDateTo('')
                      setSearchTerm('')
                    }}
                  >
                    <Trash2 className="w-3 h-3 ml-1" />
                    مسح الفلاتر
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Virtualized Table */}
      <Card>
        <CardContent className="p-0">
          <div ref={parentRef} className="max-h-[600px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-white z-10 shadow-sm">
                <TableRow>
                  <TableHead className="text-xs w-10"></TableHead>
                  <TableHead className="text-xs">المستخدم</TableHead>
                  <TableHead className="text-xs">العملية</TableHead>
                  <TableHead className="text-xs">نوع العنصر</TableHead>
                  <TableHead className="text-xs">التاريخ</TableHead>
                  <TableHead className="text-xs">معرف العنصر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12">
                      <div className="flex flex-col items-center text-gray-500">
                        <History className="w-12 h-12 text-gray-300 mb-3" />
                        <p className="text-sm font-medium">لا توجد سجلات تطابق البحث</p>
                        <p className="text-xs mt-1">جرّب تغيير معايير البحث أو الفلاتر</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedLogs.map(log => {
                    const isExpanded = expandedRows.has(log.id)
                    const ResourceIcon = RESOURCE_ICONS[log.resourceType] || Activity
                    const actionColor = ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-700 border-gray-200'

                    return (
                      <React.Fragment key={log.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-gray-50 transition-colors"
                          onClick={() => toggleExpand(log.id)}
                        >
                          <TableCell className="text-xs">
                            <button className="p-1 hover:bg-gray-100 rounded">
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-medium text-gray-600">
                                  {log.user?.name?.charAt(0) || '؟'}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {log.user?.name || 'النظام'}
                                </p>
                                {log.user?.email && (
                                  <p className="text-xs text-gray-500 truncate">{log.user.email}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${actionColor}`}>
                              {ACTION_LABELS[log.action] || log.action}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <ResourceIcon className="w-3.5 h-3.5 text-gray-500" />
                              <Badge variant="outline" className="text-xs bg-gray-50">
                                {RESOURCE_LABELS[log.resourceType] || log.resourceType}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-0.5">
                              <p className="text-xs text-gray-600 font-medium" title={new Date(log.createdAt).toLocaleString('ar-SA')}>
                                {getRelativeTimeArabic(log.createdAt)}
                              </p>
                              <p className="text-[10px] text-gray-400">
                                {new Date(log.createdAt).toLocaleDateString('ar-SA')}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-gray-500 font-mono">
                            {log.resourceId ? (
                              <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">
                                {log.resourceId.substring(0, 12)}...
                              </span>
                            ) : '—'}
                          </TableCell>
                        </TableRow>

                        {/* Expanded Detail Row */}
                        {isExpanded && (
                          <TableRow className="bg-gray-50/50">
                            <TableCell colSpan={6} className="p-4">
                              <div className="space-y-3">
                                <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                  <Eye className="w-4 h-4" />
                                  تفاصيل السجل
                                </div>
                                <Separator />
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                  <div className="bg-white rounded-lg p-3 border">
                                    <p className="text-xs text-gray-500 mb-1">المستخدم</p>
                                    <p className="text-sm font-medium">{log.user?.name || 'النظام'}</p>
                                    {log.user?.email && (
                                      <p className="text-xs text-gray-400">{log.user.email}</p>
                                    )}
                                  </div>
                                  <div className="bg-white rounded-lg p-3 border">
                                    <p className="text-xs text-gray-500 mb-1">العملية</p>
                                    <Badge variant="outline" className={`text-xs ${actionColor}`}>
                                      {ACTION_LABELS[log.action] || log.action}
                                    </Badge>
                                  </div>
                                  <div className="bg-white rounded-lg p-3 border">
                                    <p className="text-xs text-gray-500 mb-1">التاريخ الكامل</p>
                                    <p className="text-sm font-medium">
                                      {new Date(log.createdAt).toLocaleString('ar-SA', {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                      })}
                                    </p>
                                  </div>
                                </div>

                                {/* JSON Details */}
                                {log.details && Object.keys(log.details).length > 0 && (
                                  <div className="bg-white rounded-lg border p-3">
                                    <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                                      <Database className="w-3 h-3" />
                                      بيانات إضافية (JSON)
                                    </p>
                                    <pre
                                      className="text-xs text-gray-700 bg-gray-50 p-3 rounded-lg overflow-x-auto max-h-48 overflow-y-auto font-mono leading-relaxed"
                                      dir="ltr"
                                    >
                                      {JSON.stringify(log.details, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">
            عرض {((currentPage - 1) * PAGE_SIZE) + 1} - {Math.min(currentPage * PAGE_SIZE, filteredLogs.length)} من {filteredLogs.length}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(1)}
            >
              الأولى
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            >
              السابقة
            </Button>

            {/* Page numbers */}
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (currentPage <= 3) {
                  pageNum = i + 1
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = currentPage - 2 + i
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
                      currentPage === pageNum
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            >
              التالية
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              الأخيرة
            </Button>
          </div>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-gray-200">
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-gray-800">{auditLogs.length}</p>
            <p className="text-xs text-gray-500">إجمالي السجلات</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-emerald-800">{uniqueActions.length}</p>
            <p className="text-xs text-emerald-600">أنواع العمليات</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/30">
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-blue-800">{uniqueResources.length}</p>
            <p className="text-xs text-blue-600">أنواع العناصر</p>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/30">
          <CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-amber-800">
              {auditLogs.filter(l => {
                const diff = Date.now() - new Date(l.createdAt).getTime()
                return diff < 24 * 60 * 60 * 1000
              }).length}
            </p>
            <p className="text-xs text-amber-600">آخر 24 ساعة</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
