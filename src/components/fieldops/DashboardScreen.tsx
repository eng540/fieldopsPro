'use client'

import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Building2, Grid3X3, TrendingUp, AlertTriangle, Users, Zap, Camera,
  FileSpreadsheet, Activity, ArrowLeft, Clock, CheckCircle2,
  WifiOff, Wifi, BarChart3, MapPin, Shield,
} from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts'

// ============================================================
// Types
// ============================================================

interface ProjectData {
  id: string; orgId: string; name: string; code: string; status: string;
  location: string | null; totalUnits: number; completionPct: number; isActive: boolean;
  units: UnitData[]; boqItems?: BoqItemData[]; assignments: { user: { id: string; name: string; email: string }; role: { name: string } }[]; executionSummary?: { overallProgressPct?: number; trackedBoqItems?: number } | null
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

interface RemarkData {
  id: string; orgId: string; unitId: string; unit: { id: string; name: string; code: string };
  workOrderId: string | null; templateId: string | null; customIssue: string | null;
  severity: string; status: string; photos: string[]; gpsTag: Record<string, unknown> | null;
  resolutionNotes: string | null; createdBy: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string
}

interface AuditLogData {
  id: string; user: { name: string; email: string } | null; action: string;
  resourceType: string; resourceId: string | null; details: Record<string, unknown>;
  createdAt: string
}

interface DictionaryData {
  id: string; orgId: string; name: string; category: string; description: string | null;
  isActive: boolean; createdBy: string | null; items: DictionaryItemData[]
}

interface DictionaryItemData {
  id: string; dictionaryId: string; trade: string; description: string;
  quantity: number; unitOfMeasure: string; sortOrder: number
}

interface UserData {
  id: string; orgId: string; email: string; name: string; isActive: boolean;
  assignments: { id: string; projectId: string; project: { id: string; name: string; code: string }; role: { id: string; name: string } }[]
}

interface DashboardScreenProps {
  projects: ProjectData[]
  selectedProject: ProjectData | null
  users: UserData[]
  remarks: RemarkData[]
  auditLogs: AuditLogData[]
  dictionaries: DictionaryData[]
  onNavigate: (tab: string) => void
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

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  MINOR: { label: 'ثانوية', color: 'text-amber-700', bg: 'bg-amber-100', border: 'border-amber-300' },
  MAJOR: { label: 'رئيسية', color: 'text-orange-700', bg: 'bg-orange-100', border: 'border-orange-300' },
  CRITICAL: { label: 'حرجة', color: 'text-red-700', bg: 'bg-red-100', border: 'border-red-300' },
}

const UNIT_TYPE_LABELS: Record<string, string> = {
  RESIDENTIAL: 'سكني',
  COMMERCIAL: 'تجاري',
  MIXED_USE: 'متعدد الاستخدام',
  VILLA: 'فيلا',
  OFFICE: 'مكتبي',
  RETAIL: 'تجزئة',
  PARKING: 'موقف',
  AMENITY: 'مرافق',
  STUDIO: 'استوديو',
  PENTHOUSE: 'بنتهاوس',
  MEZZANINE: 'ميزانين',
}

const UNIT_TYPE_COLORS: Record<string, string> = {
  RESIDENTIAL: '#10b981',
  COMMERCIAL: '#3b82f6',
  MIXED_USE: '#8b5cf6',
  VILLA: '#f59e0b',
  OFFICE: '#06b6d4',
  RETAIL: '#ec4899',
  PARKING: '#6b7280',
  AMENITY: '#14b8a6',
  STUDIO: '#a855f7',
  PENTHOUSE: '#f97316',
  MEZZANINE: '#84cc16',
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'نشط',
  ON_HOLD: 'معلق',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
  NOT_STARTED: 'لم يبدأ',
  IN_PROGRESS: 'قيد التنفيذ',
}

// ============================================================
// Animation Variants
// ============================================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: 'easeOut' as const },
  },
}

const kpiVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: 'easeOut' as const },
  },
}

// ============================================================
// Helper Functions
// ============================================================

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'الآن'
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`
  if (diffHours < 24) return `منذ ${diffHours} ساعة`
  if (diffDays < 7) return `منذ ${diffDays} يوم`
  return date.toLocaleDateString('ar-SA')
}

function getCompletionColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500'
  if (pct >= 50) return 'bg-amber-500'
  if (pct >= 25) return 'bg-orange-500'
  return 'bg-red-500'
}

function getCompletionTextColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-700'
  if (pct >= 50) return 'text-amber-700'
  if (pct >= 25) return 'text-orange-700'
  return 'text-red-700'
}

// ============================================================
// Sub-components
// ============================================================

function KpiCard({
  title,
  value,
  icon: Icon,
  subtitle,
  colorClass,
  index,
}: {
  title: string
  value: string | number
  icon: React.ElementType
  subtitle?: string
  colorClass: string
  index: number
}) {
  return (
    <motion.div
      variants={kpiVariants}
      initial="hidden"
      animate="visible"
      transition={{ delay: index * 0.1 }}
    >
      <Card className="relative overflow-hidden border-0 shadow-md hover:shadow-lg transition-shadow duration-300">
        <div className={`absolute top-0 right-0 w-24 h-24 rounded-full -translate-y-8 translate-x-8 opacity-10 ${colorClass}`} />
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm text-gray-500 font-medium">{title}</p>
              <p className="text-3xl font-bold tracking-tight">{value}</p>
              {subtitle && (
                <p className="text-xs text-gray-400">{subtitle}</p>
              )}
            </div>
            <div className={`p-3 rounded-xl ${colorClass}`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function ProjectProgressBar({ project }: { project: ProjectData }) {
  const completedUnits = project.units.filter(
    (u) => u.completionPct >= 100
  ).length
  const inProgressUnits = project.units.filter(
    (u) => u.completionPct > 0 && u.completionPct < 100
  ).length

  return (
    <motion.div
      variants={itemVariants}
      className="group p-4 rounded-xl bg-white border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all duration-200"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-900">{project.name}</h4>
            <p className="text-xs text-gray-400">{project.code} • {project.location || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-[10px] px-2 py-0 ${STATUS_COLORS[project.status] || 'bg-gray-100 text-gray-700'}`}
          >
            {STATUS_LABELS[project.status] || project.status}
          </Badge>
          <span className={`text-sm font-bold ${getCompletionTextColor(project.completionPct)}`}>
            {project.completionPct}%
          </span>
        </div>
      </div>

      <div className="relative h-2.5 bg-gray-100 rounded-full overflow-hidden mb-2">
        <motion.div
          className={`absolute top-0 right-0 h-full rounded-full ${getCompletionColor(project.completionPct)}`}
          initial={{ width: 0 }}
          animate={{ width: `${project.completionPct}%` }}
          transition={{ duration: 1, ease: 'easeOut' as const, delay: 0.3 }}
        />
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span>{project.totalUnits} وحدة</span>
        <span>{completedUnits} مكتملة</span>
        <span>{inProgressUnits} جارية</span>
        <span className="mr-auto">{project.assignments.length} مُعَيّن</span>
      </div>
    </motion.div>
  )
}

function UnitTypeDistribution({ projects }: { projects: ProjectData[] }) {
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    projects.forEach((p) => {
      p.units.forEach((u) => {
        const t = u.unitType || 'OTHER'
        counts[t] = (counts[t] || 0) + 1
      })
    })
    return counts
  }, [projects])

  const total = Object.values(typeCounts).reduce((a, b) => a + b, 0)
  const chartData = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      name: UNIT_TYPE_LABELS[type] || type,
      value: count,
      type,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))

  return (
    <motion.div variants={itemVariants}>
      <Card className="border-0 shadow-md h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-emerald-600" />
            <CardTitle className="text-base">توزيع أنواع الوحدات</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              لا توجد وحدات
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row items-center gap-4">
              {/* Pie Chart */}
              <div className="w-48 h-48 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {chartData.map((entry) => (
                        <Cell
                          key={entry.type}
                          fill={UNIT_TYPE_COLORS[entry.type] || '#6b7280'}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [`${value} وحدة`, name]}
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        fontSize: '12px',
                        direction: 'rtl',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legend */}
              <div className="flex-1 space-y-2 w-full">
                {chartData.map((item) => (
                  <div key={item.type} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: UNIT_TYPE_COLORS[item.type] || '#6b7280' }}
                    />
                    <span className="text-sm text-gray-700 flex-1">{item.name}</span>
                    <span className="text-sm font-semibold text-gray-900">{item.value}</span>
                    <span className="text-xs text-gray-400 w-10 text-left">{item.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

function RemarksBySeverity({ remarks }: { remarks: RemarkData[] }) {
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { MINOR: 0, MAJOR: 0, CRITICAL: 0 }
    remarks.forEach((r) => {
      const s = r.severity?.toUpperCase()
      if (s && counts[s] !== undefined) counts[s]++
      else if (s) counts[s] = (counts[s] || 0) + 1
    })
    return counts
  }, [remarks])

  const total = Object.values(severityCounts).reduce((a, b) => a + b, 0)
  const openRemarks = remarks.filter((r) => r.status !== 'RESOLVED' && r.status !== 'CLOSED')

  const severityOrder: ('CRITICAL' | 'MAJOR' | 'MINOR')[] = ['CRITICAL', 'MAJOR', 'MINOR']

  return (
    <motion.div variants={itemVariants}>
      <Card className="border-0 shadow-md h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <CardTitle className="text-base">الملاحظات حسب الخطورة</CardTitle>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {openRemarks.length} ملاحظة مفتوحة من إجمالي {total}
          </p>
        </CardHeader>
        <CardContent>
          {total === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              <CheckCircle2 className="w-5 h-5 ml-2" />
              لا توجد ملاحظات
            </div>
          ) : (
            <div className="space-y-4">
              {severityOrder.map((severity) => {
                const count = severityCounts[severity] || 0
                const pct = total > 0 ? Math.round((count / total) * 100) : 0
                const config = SEVERITY_CONFIG[severity]
                if (!config) return null

                return (
                  <div key={severity} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${config.bg} ${config.border} border`} />
                        <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900">{count}</span>
                        <span className="text-xs text-gray-400">({pct}%)</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${severity === 'CRITICAL' ? 'bg-red-500' : severity === 'MAJOR' ? 'bg-orange-500' : 'bg-amber-500'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' as const, delay: 0.2 }}
                      />
                    </div>
                  </div>
                )
              })}

              {/* Summary visual bar */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex h-4 rounded-full overflow-hidden">
                  {severityOrder.map((severity) => {
                    const count = severityCounts[severity] || 0
                    const pct = total > 0 ? (count / total) * 100 : 0
                    if (pct === 0) return null
                    return (
                      <motion.div
                        key={severity}
                        className={`${
                          severity === 'CRITICAL'
                            ? 'bg-red-500'
                            : severity === 'MAJOR'
                            ? 'bg-orange-500'
                            : 'bg-amber-500'
                        }`}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' as const, delay: 0.4 }}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

function QuickActions({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const actions = [
    { icon: Building2, label: 'المشاريع', tab: 'projects', color: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' },
    { icon: Grid3X3, label: 'إدخال الإنجاز', tab: 'speed-entry', color: 'bg-amber-50 text-amber-600 hover:bg-amber-100' },
    { icon: Camera, label: 'الجودة والصور', tab: 'quality', color: 'bg-blue-50 text-blue-600 hover:bg-blue-100' },
    { icon: AlertTriangle, label: 'الملاحظات', tab: 'quality', color: 'bg-red-50 text-red-600 hover:bg-red-100' },
    { icon: Users, label: 'المستخدمون', tab: 'users', color: 'bg-purple-50 text-purple-600 hover:bg-purple-100' },
    { icon: FileSpreadsheet, label: 'القواميس', tab: 'dictionary', color: 'bg-cyan-50 text-cyan-600 hover:bg-cyan-100' },
    { icon: Activity, label: 'أوامر العمل', tab: 'work-orders', color: 'bg-teal-50 text-teal-600 hover:bg-teal-100' },
    { icon: Shield, label: 'الحوكمة', tab: 'governance', color: 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' },
  ]

  return (
    <motion.div variants={itemVariants}>
      <Card className="border-0 shadow-md h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-600" />
            <CardTitle className="text-base">إجراءات سريعة</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {actions.map((action, i) => (
              <motion.button
                key={action.tab}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
                onClick={() => onNavigate(action.tab)}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl transition-all duration-200 ${action.color}`}
              >
                <action.icon className="w-5 h-5" />
                <span className="text-xs font-medium">{action.label}</span>
              </motion.button>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function RecentActivity({ auditLogs }: { auditLogs: AuditLogData[] }) {
  const recentLogs = auditLogs.slice(0, 5)

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'LOGIN': return <Users className="w-3.5 h-3.5" />
      case 'CREATE_PROJECT': return <Building2 className="w-3.5 h-3.5" />
      case 'UPDATE_PROGRESS': return <TrendingUp className="w-3.5 h-3.5" />
      case 'UPLOAD_PHOTO': return <Camera className="w-3.5 h-3.5" />
      case 'ASSIGN_ROLE': return <Shield className="w-3.5 h-3.5" />
      case 'BULK_IMPORT': return <FileSpreadsheet className="w-3.5 h-3.5" />
      case 'CREATE_REMARK': return <AlertTriangle className="w-3.5 h-3.5" />
      case 'CHANGE_PERMISSIONS': return <Shield className="w-3.5 h-3.5" />
      case 'REGISTER_USER': return <Users className="w-3.5 h-3.5" />
      case 'CREATE_DICTIONARY': return <FileSpreadsheet className="w-3.5 h-3.5" />
      case 'BULK_PROGRESS_UPDATE': return <TrendingUp className="w-3.5 h-3.5" />
      default: return <Activity className="w-3.5 h-3.5" />
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE_PROJECT':
      case 'CREATE_DICTIONARY':
        return 'bg-emerald-50 text-emerald-600'
      case 'UPDATE_PROGRESS':
      case 'BULK_PROGRESS_UPDATE':
        return 'bg-blue-50 text-blue-600'
      case 'UPLOAD_PHOTO':
        return 'bg-purple-50 text-purple-600'
      case 'CREATE_REMARK':
        return 'bg-red-50 text-red-600'
      case 'ASSIGN_ROLE':
      case 'CHANGE_PERMISSIONS':
        return 'bg-amber-50 text-amber-600'
      case 'BULK_IMPORT':
        return 'bg-cyan-50 text-cyan-600'
      default:
        return 'bg-gray-50 text-gray-600'
    }
  }

  return (
    <motion.div variants={itemVariants}>
      <Card className="border-0 shadow-md h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600" />
            <CardTitle className="text-base">النشاط الأخير</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              لا يوجد نشاط حديث
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {recentLogs.map((log, i) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.3 }}
                  className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className={`p-2 rounded-lg shrink-0 ${getActionColor(log.action)}`}>
                    {getActionIcon(log.action)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {log.user?.name || 'مستخدم مجهول'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatRelativeTime(log.createdAt)}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

function TradeCompletion({ projects }: { projects: ProjectData[] }) {
  const tradeStats = useMemo(() => {
    const tradeMap: Record<string, { totalPct: number; count: number }> = {}
    projects.forEach((p) => {
      p.units.forEach((u) => {
        u.boqItems.forEach((b) => {
          if (!tradeMap[b.trade]) {
            tradeMap[b.trade] = { totalPct: 0, count: 0 }
          }
          tradeMap[b.trade].totalPct += b.completionPct
          tradeMap[b.trade].count += 1
        })
      })
    })
    return Object.entries(tradeMap)
      .map(([trade, stats]) => ({
        trade,
        avgPct: stats.count > 0 ? Math.round(stats.totalPct / stats.count) : 0,
        itemCount: stats.count,
      }))
      .sort((a, b) => b.avgPct - a.avgPct)
      .slice(0, 8)
  }, [projects])

  return (
    <motion.div variants={itemVariants}>
      <Card className="border-0 shadow-md h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <CardTitle className="text-base">الإنجاز حسب الحرفة</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {tradeStats.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              لا توجد بيانات حرف
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {tradeStats.map((item) => (
                <div key={item.trade} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">{item.trade}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{item.itemCount} بند</span>
                      <span className={`text-sm font-bold ${getCompletionTextColor(item.avgPct)}`}>
                        {item.avgPct}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${getCompletionColor(item.avgPct)}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${item.avgPct}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' as const }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

function ConnectionStatus({ isOnline }: { isOnline: boolean }) {
  const [syncQueueCount] = React.useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const items = localStorage.getItem('syncQueue')
        return items ? JSON.parse(items).length : 0
      } catch {
        return 0
      }
    }
    return 0
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3"
    >
      {/* Online/Offline Status */}
      <div
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
          isOnline
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}
      >
        {isOnline ? (
          <Wifi className="w-3.5 h-3.5" />
        ) : (
          <WifiOff className="w-3.5 h-3.5" />
        )}
        <span>{isOnline ? 'متصل' : 'غير متصل'}</span>
        {!isOnline && (
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        )}
      </div>

      {/* Sync Queue */}
      {syncQueueCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{syncQueueCount} معلق مزامنة</span>
        </div>
      )}
    </motion.div>
  )
}

// ============================================================
// Main Component
// ============================================================

export function DashboardScreen({
  projects,
  selectedProject,
  users,
  remarks,
  auditLogs,
  dictionaries,
  onNavigate,
}: DashboardScreenProps) {
  // ---- Derived Data ----
  const activeProjects = projects.filter((p) => p.isActive)
  const allUnits = projects.flatMap((p) => p.units)
  const totalUnits = allUnits.length
  const avgCompletion =
    projects.length > 0
      ? Math.round(projects.reduce((sum, p) => sum + p.completionPct, 0) / projects.length)
      : 0
  const criticalRemarks = remarks.filter(
    (r) => r.severity === 'CRITICAL' && r.status !== 'RESOLVED' && r.status !== 'CLOSED'
  ).length

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

  // ---- Computed KPIs ----
  const kpis = [
    {
      title: 'المشاريع النشطة',
      value: activeProjects.length,
      icon: Building2,
      subtitle: `من ${projects.length} مشروع`,
      colorClass: 'bg-emerald-500',
    },
    {
      title: 'إجمالي الوحدات',
      value: totalUnits,
      icon: Grid3X3,
      subtitle: `${allUnits.filter((u) => u.completionPct >= 100).length} مكتملة`,
      colorClass: 'bg-amber-500',
    },
    {
      title: 'متوسط الإنجاز',
      value: `${avgCompletion}%`,
      icon: TrendingUp,
      subtitle: selectedProject ? `المشروع: ${selectedProject.name}` : 'جميع المشاريع',
      colorClass: 'bg-blue-500',
    },
    {
      title: 'ملاحظات حرجة',
      value: criticalRemarks,
      icon: AlertTriangle,
      subtitle: `${remarks.filter((r) => r.status !== 'RESOLVED' && r.status !== 'CLOSED').length} مفتوحة`,
      colorClass: 'bg-red-500',
    },
  ]

  // ---- Selected Project Filtered Data ----
  const displayProjects = selectedProject ? [selectedProject] : projects
  const displayRemarks = selectedProject
    ? remarks.filter((r) =>
        selectedProject.units.some((u) => u.id === r.unitId)
      )
    : remarks

  return (
    <div dir="rtl" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">لوحة التحكم</h2>
          <p className="text-sm text-gray-500 mt-1">
            {selectedProject
              ? `مشروع: ${selectedProject.name}`
              : `إجمالي ${projects.length} مشاريع • ${users.length} مستخدم`}
          </p>
        </div>
        <ConnectionStatus isOnline={isOnline} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <KpiCard
            key={kpi.title}
            title={kpi.title}
            value={kpi.value}
            icon={kpi.icon}
            subtitle={kpi.subtitle}
            colorClass={kpi.colorClass}
            index={i}
          />
        ))}
      </div>

      {/* Project Progress Section */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="w-4 h-4 text-emerald-600" />
          <h3 className="text-lg font-semibold text-gray-900">تقدم المشاريع</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {displayProjects.map((project) => (
            <ProjectProgressBar key={project.id} project={project} />
          ))}
        </div>
        {displayProjects.length === 0 && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-8 text-center text-gray-400">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>لا توجد مشاريع لعرضها</p>
            </CardContent>
          </Card>
        )}
      </motion.div>

      {/* Middle Row: Unit Type Distribution + Remarks by Severity */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <UnitTypeDistribution projects={displayProjects} />
          <RemarksBySeverity remarks={displayRemarks} />
        </div>
      </motion.div>

      {/* Quick Actions */}
      <QuickActions onNavigate={onNavigate} />

      {/* Bottom Row: Trade Completion + Recent Activity */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TradeCompletion projects={displayProjects} />
          <RecentActivity auditLogs={auditLogs} />
        </div>
      </motion.div>

      {/* Footer summary */}
      <div className="flex items-center justify-center gap-4 py-4 text-xs text-gray-400">
        <span>FieldOps V4</span>
        <span>•</span>
        <span>{dictionaries.length} قاموس</span>
        <span>•</span>
        <span>{users.filter((u) => u.isActive).length} مستخدم نشط</span>
        <span>•</span>
        <span>{auditLogs.length} سجل</span>
      </div>
    </div>
  )
}
