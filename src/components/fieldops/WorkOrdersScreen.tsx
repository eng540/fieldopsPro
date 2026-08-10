// FieldOps V4 — Work Orders Screen
// Sprint 5 Phase 3 — Enterprise Work Order Management

'use client'

import React, { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Clipboard, Plus, Search, Filter, Eye, Edit3, Trash2,
  AlertTriangle, CheckCircle2, Clock, Loader2, ArrowUpDown,
  MoreHorizontal, ChevronDown, ChevronUp, Calendar, User,
  MapPin, FileText, ArrowRight, Wrench, Shield, Zap
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// ============================================================
// Types
// ============================================================

interface WorkOrderData {
  id: string
  orgId: string
  projectId: string
  unitId: string
  title: string
  description: string | null
  woType: string
  priority: string
  status: string
  completionPct: number
  reworkFlag: boolean
  reworkReason: string | null
  locationData: string | null
  assignments: Array<{ id: string; userId: string; userName: string; status: string }>
  statusHistory: Array<{ id: string; fromStatus: string; toStatus: string; changedBy: string; reason: string | null; createdAt: string }>
  createdAt: string
  updatedAt: string
}

interface WorkOrdersScreenProps {
  project: any | null
  orgId: string
  onRefresh: () => void
}

// ============================================================
// Status/Priority Colors
// ============================================================

const WO_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800 border-gray-200',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800 border-amber-200',
  APPROVED: 'bg-blue-100 text-blue-800 border-blue-200',
  IN_PROGRESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  COMPLETED: 'bg-green-100 text-green-800 border-green-200',
  CANCELLED: 'bg-red-100 text-red-800 border-red-200',
}

const WO_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'مسودة',
  PENDING_APPROVAL: 'بانتظار الموافقة',
  APPROVED: 'تمت الموافقة',
  IN_PROGRESS: 'قيد التنفيذ',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-700 border-slate-200',
  MEDIUM: 'bg-blue-100 text-blue-700 border-blue-200',
  HIGH: 'bg-orange-100 text-orange-700 border-orange-200',
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
}

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'منخفض',
  MEDIUM: 'متوسط',
  HIGH: 'مرتفع',
  CRITICAL: 'حرج',
}

const WO_TYPE_LABELS: Record<string, string> = {
  CONSTRUCTION: 'إنشاء',
  INSPECTION: 'تفتيش',
  MAINTENANCE: 'صيانة',
  REWORK: 'إعادة تنفيذ',
}

// ============================================================
// Demo Work Orders Data
// ============================================================

function generateDemoWorkOrders(project: any): WorkOrderData[] {
  if (!project) return []

  const units = project.units || []
  const workOrders: WorkOrderData[] = []

  const woTemplates = [
    { title: 'أعمال البناء الأساسية', woType: 'CONSTRUCTION', priority: 'HIGH' },
    { title: 'أعمال التشطيبات الداخلية', woType: 'CONSTRUCTION', priority: 'MEDIUM' },
    { title: 'تفتيش أعمال السباكة', woType: 'INSPECTION', priority: 'HIGH' },
    { title: 'أعمال الكهرباء', woType: 'CONSTRUCTION', priority: 'MEDIUM' },
    { title: 'صيانة نظام التكييف', woType: 'MAINTENANCE', priority: 'LOW' },
    { title: 'إعادة تنفيذ أعمال الدهان', woType: 'REWORK', priority: 'CRITICAL' },
    { title: 'تفتيش أعمال العزل', woType: 'INSPECTION', priority: 'MEDIUM' },
    { title: 'أعمال الأرضيات', woType: 'CONSTRUCTION', priority: 'MEDIUM' },
  ]

  const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'COMPLETED']

  units.forEach((unit: any, uIdx: number) => {
    woTemplates.forEach((tpl, wIdx) => {
      const status = statuses[(uIdx + wIdx) % statuses.length]
      const completionMap: Record<string, number> = {
        DRAFT: 0, PENDING_APPROVAL: 0, APPROVED: 5, IN_PROGRESS: 40 + (wIdx * 10), COMPLETED: 100,
      }

      workOrders.push({
        id: `wo-${project.id}-${unit.id}-${wIdx}`,
        orgId: project.orgId,
        projectId: project.id,
        unitId: unit.id,
        title: `${tpl.title} — ${unit.name}`,
        description: `أمر عمل ${WO_TYPE_LABELS[tpl.woType]} للوحدة ${unit.name}`,
        woType: tpl.woType,
        priority: tpl.priority,
        status,
        completionPct: completionMap[status],
        reworkFlag: tpl.woType === 'REWORK',
        reworkReason: tpl.woType === 'REWORK' ? 'عدم مطابقة المواصفات — يتطلب إعادة التنفيذ' : null,
        locationData: null,
        assignments: status !== 'DRAFT' ? [{
          id: `assign-${uIdx}-${wIdx}`,
          userId: `user-${(uIdx + wIdx) % 5}`,
          userName: ['أحمد محمد', 'سارة علي', 'خالد حسن', 'نورة سعد', 'عمر فهد'][(uIdx + wIdx) % 5],
          status: status === 'COMPLETED' ? 'COMPLETED' : 'ASSIGNED',
        }] : [],
        statusHistory: [
          {
            id: `hist-${uIdx}-${wIdx}-1`,
            fromStatus: 'DRAFT',
            toStatus: status,
            changedBy: 'مدير المشروع',
            reason: null,
            createdAt: new Date(Date.now() - (5 - wIdx) * 86400000).toISOString(),
          },
        ],
        createdAt: new Date(Date.now() - (5 - wIdx) * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - wIdx * 86400000).toISOString(),
      })
    })
  })

  return workOrders
}

// ============================================================
// Work Orders Screen Component
// ============================================================

export function WorkOrdersScreen({ project, orgId, onRefresh }: WorkOrdersScreenProps) {
  const { toast } = useToast()
  const workOrders = useMemo(() => generateDemoWorkOrders(project), [project])

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL')
  const [typeFilter, setTypeFilter] = useState<string>('ALL')
  const [selectedWO, setSelectedWO] = useState<WorkOrderData | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [sortBy, setSortBy] = useState<string>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Filtered work orders
  const filteredWOs = useMemo(() => {
    let result = [...workOrders]

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(wo =>
        wo.title.toLowerCase().includes(q) ||
        wo.description?.toLowerCase().includes(q)
      )
    }

    if (statusFilter !== 'ALL') result = result.filter(wo => wo.status === statusFilter)
    if (priorityFilter !== 'ALL') result = result.filter(wo => wo.priority === priorityFilter)
    if (typeFilter !== 'ALL') result = result.filter(wo => wo.woType === typeFilter)

    result.sort((a, b) => {
      const aVal = a[sortBy as keyof WorkOrderData] as any
      const bVal = b[sortBy as keyof WorkOrderData] as any
      if (sortDir === 'asc') return aVal > bVal ? 1 : -1
      return aVal < bVal ? 1 : -1
    })

    return result
  }, [workOrders, searchQuery, statusFilter, priorityFilter, typeFilter, sortBy, sortDir])

  // Stats
  const stats = useMemo(() => ({
    total: workOrders.length,
    inProgress: workOrders.filter(w => w.status === 'IN_PROGRESS').length,
    pendingApproval: workOrders.filter(w => w.status === 'PENDING_APPROVAL').length,
    completed: workOrders.filter(w => w.status === 'COMPLETED').length,
    rework: workOrders.filter(w => w.reworkFlag).length,
    critical: workOrders.filter(w => w.priority === 'CRITICAL').length,
  }), [workOrders])

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 text-gray-400" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
  }

  if (!project) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <Clipboard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">اختر مشروعاً لعرض أوامر العمل</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">أوامر العمل</h2>
          <p className="text-sm text-gray-500 mt-1">إدارة وتتبع أوامر العمل — {project.name}</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 ml-1" />
          أمر عمل جديد
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: 'الإجمالي', value: stats.total, color: 'text-gray-800', bg: 'bg-gray-50' },
          { label: 'قيد التنفيذ', value: stats.inProgress, color: 'text-emerald-800', bg: 'bg-emerald-50' },
          { label: 'بانتظار الموافقة', value: stats.pendingApproval, color: 'text-amber-800', bg: 'bg-amber-50' },
          { label: 'مكتمل', value: stats.completed, color: 'text-green-800', bg: 'bg-green-50' },
          { label: 'إعادة تنفيذ', value: stats.rework, color: 'text-orange-800', bg: 'bg-orange-50' },
          { label: 'حرج', value: stats.critical, color: 'text-red-800', bg: 'bg-red-50' },
        ].map((stat, idx) => (
          <Card key={idx} className={`${stat.bg} border-0`}>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-500">{stat.label}</p>
              <p className={`text-xl font-bold ${stat.color} mt-1`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث في أوامر العمل..."
                className="pr-9 h-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 h-9 text-xs">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">جميع الحالات</SelectItem>
                {Object.entries(WO_STATUS_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-36 h-9 text-xs">
                <SelectValue placeholder="الأولوية" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">جميع الأولويات</SelectItem>
                {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36 h-9 text-xs">
                <SelectValue placeholder="النوع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">جميع الأنواع</SelectItem>
                {Object.entries(WO_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Work Orders Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">قائمة أوامر العمل ({filteredWOs.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>
                    <button onClick={() => handleSort('title')} className="flex items-center gap-1 hover:text-gray-900">
                      العنوان <SortIcon field="title" />
                    </button>
                  </TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>
                    <button onClick={() => handleSort('priority')} className="flex items-center gap-1 hover:text-gray-900">
                      الأولوية <SortIcon field="priority" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button onClick={() => handleSort('status')} className="flex items-center gap-1 hover:text-gray-900">
                      الحالة <SortIcon field="status" />
                    </button>
                  </TableHead>
                  <TableHead>الإنجاز</TableHead>
                  <TableHead>المسؤول</TableHead>
                  <TableHead className="w-20">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWOs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      لا توجد أوامر عمل مطابقة
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredWOs.map((wo, idx) => (
                    <TableRow key={wo.id} className="hover:bg-gray-50/50 cursor-pointer" onClick={() => { setSelectedWO(wo); setShowDetail(true) }}>
                      <TableCell className="text-xs text-gray-500">{idx + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {wo.reworkFlag && <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />}
                          <span className="text-sm font-medium text-gray-900">{wo.title}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {WO_TYPE_LABELS[wo.woType] || wo.woType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${PRIORITY_COLORS[wo.priority] || ''}`}>
                          {PRIORITY_LABELS[wo.priority] || wo.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${WO_STATUS_COLORS[wo.status] || ''}`}>
                          {WO_STATUS_LABELS[wo.status] || wo.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[100px]">
                          <Progress value={wo.completionPct} className="h-1.5 flex-1" />
                          <span className="text-xs text-gray-500 w-8 text-left">{wo.completionPct}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {wo.assignments[0]?.userName || '—'}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setSelectedWO(wo); setShowDetail(true) }}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Work Order Detail Dialog */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-2xl" dir="rtl">
          {selectedWO && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                    <Clipboard className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <DialogTitle className="text-lg">{selectedWO.title}</DialogTitle>
                    <DialogDescription className="mt-1">
                      أمر عمل {WO_TYPE_LABELS[selectedWO.woType]} — {selectedWO.id}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {/* Status & Priority */}
                <div className="flex items-center gap-3">
                  <Badge className={WO_STATUS_COLORS[selectedWO.status]}>
                    {WO_STATUS_LABELS[selectedWO.status]}
                  </Badge>
                  <Badge className={PRIORITY_COLORS[selectedWO.priority]}>
                    {PRIORITY_LABELS[selectedWO.priority]}
                  </Badge>
                  {selectedWO.reworkFlag && (
                    <Badge className="bg-orange-100 text-orange-800 border-orange-200">
                      <AlertTriangle className="w-3 h-3 ml-1" />
                      إعادة تنفيذ
                    </Badge>
                  )}
                </div>

                {/* Progress */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">نسبة الإنجاز</span>
                    <span className="text-sm font-bold text-emerald-600">{selectedWO.completionPct}%</span>
                  </div>
                  <Progress value={selectedWO.completionPct} className="h-2" />
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">الوصف</p>
                    <p className="text-sm">{selectedWO.description || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">النوع</p>
                    <p className="text-sm">{WO_TYPE_LABELS[selectedWO.woType]}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">تاريخ الإنشاء</p>
                    <p className="text-sm" dir="ltr">{new Date(selectedWO.createdAt).toLocaleDateString('ar-SA')}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">آخر تحديث</p>
                    <p className="text-sm" dir="ltr">{new Date(selectedWO.updatedAt).toLocaleDateString('ar-SA')}</p>
                  </div>
                </div>

                {/* Rework Info */}
                {selectedWO.reworkFlag && selectedWO.reworkReason && (
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <div className="flex items-center gap-2 text-orange-800 text-sm font-medium mb-1">
                      <AlertTriangle className="w-4 h-4" />
                      سبب إعادة التنفيذ
                    </div>
                    <p className="text-sm text-orange-700">{selectedWO.reworkReason}</p>
                  </div>
                )}

                {/* Assignments */}
                {selectedWO.assignments.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">المعينون</p>
                    <div className="space-y-1">
                      {selectedWO.assignments.map((a) => (
                        <div key={a.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="text-sm">{a.userName}</span>
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {a.status === 'COMPLETED' ? 'مكتمل' : 'معين'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Status History */}
                <div>
                  <p className="text-sm font-medium mb-2">سجل التغييرات</p>
                  <div className="space-y-2">
                    {selectedWO.statusHistory.map((h) => (
                      <div key={h.id} className="flex items-center gap-3 text-xs">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-gray-600">{WO_STATUS_LABELS[h.fromStatus] || h.fromStatus}</span>
                        <ArrowRight className="w-3 h-3 text-gray-400" />
                        <span className="text-gray-900 font-medium">{WO_STATUS_LABELS[h.toStatus] || h.toStatus}</span>
                        <span className="text-gray-400 mr-auto">بواسطة {h.changedBy}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setShowDetail(false)}>إغلاق</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700">
                  <Edit3 className="w-4 h-4 ml-1" />
                  تعديل
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Work Order Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>أمر عمل جديد</DialogTitle>
            <DialogDescription>إنشاء أمر عمل جديد في المشروع {project.name}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>العنوان</Label>
              <Input placeholder="عنوان أمر العمل" />
            </div>

            <div className="space-y-2">
              <Label>الوصف</Label>
              <Textarea placeholder="وصف تفصيلي لأمر العمل..." rows={3} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>النوع</Label>
                <Select defaultValue="CONSTRUCTION">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(WO_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>الأولوية</Label>
                <Select defaultValue="MEDIUM">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>الوحدة</Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="اختر الوحدة" /></SelectTrigger>
                <SelectContent>
                  {(project.units || []).map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowCreate(false)}>إلغاء</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => {
              toast({ title: 'تم إنشاء أمر العمل', description: 'تم إنشاء أمر العمل بنجاح' })
              setShowCreate(false)
            }}>
              <Plus className="w-4 h-4 ml-1" />
              إنشاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
