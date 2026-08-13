'use client'

import React, { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Activity, BarChart3, BookOpen, Building2, ClipboardCheck, FileSpreadsheet, History, LayoutDashboard, LogOut, RefreshCw, Settings, Shield, UploadCloud, Users, WifiOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { SyncStatusBar } from '@/components/fieldops/SyncStatusBar'
import { SyncNotifications } from '@/components/fieldops/SyncNotifications'
import { getPendingSyncItems, type SyncQueueItem } from '@/lib/offline-db'
import { useOnlineStatus } from '@/lib/sync-hooks'
import { useAuthStore } from '@/lib/auth-store'
import { getProjectsHybrid, getRemarksHybrid, getUsersHybrid, getAuditLogsHybrid, getDictionariesHybrid, fullDataSync, processSyncQueue } from '@/lib/api-client'
import { registerServiceWorker, triggerBackgroundSync } from '@/lib/sw-register'

const ScreenFallback = () => <div className="flex flex-col items-center justify-center h-[60vh] text-emerald-600"><Loader2 className="w-8 h-8 animate-spin mb-4" /><p className="text-sm text-gray-500">جاري تحميل الشاشة...</p></div>
const DashboardScreen = dynamic(() => import('@/components/fieldops/DashboardScreen').then(m => m.DashboardScreen), { loading: ScreenFallback })
const ProjectsScreen = dynamic(() => import('@/components/fieldops/ProjectsScreen').then(m => m.ProjectsScreen), { loading: ScreenFallback })
const SpeedEntryGrid = dynamic(() => import('@/components/fieldops/SpeedEntryGrid').then(m => m.SpeedEntryGrid), { loading: ScreenFallback })
const BulkImportScreen = dynamic(() => import('@/components/fieldops/BulkImportScreen').then(m => m.BulkImportScreen), { loading: ScreenFallback })
const WorkOrdersScreen = dynamic(() => import('@/components/fieldops/WorkOrdersScreen').then(m => m.WorkOrdersScreen), { loading: ScreenFallback })
const QualityScreen = dynamic(() => import('@/components/fieldops/QualityScreen').then(m => m.QualityScreen), { loading: ScreenFallback })
const GovernanceScreen = dynamic(() => import('@/components/fieldops/GovernanceScreen').then(m => m.GovernanceScreen), { loading: ScreenFallback })
const UsersScreen = dynamic(() => import('@/components/fieldops/UsersScreen').then(m => m.UsersScreen), { loading: ScreenFallback })
const DictionaryScreen = dynamic(() => import('@/components/fieldops/DictionaryScreen').then(m => m.DictionaryScreen), { loading: ScreenFallback })
const AuditScreen = dynamic(() => import('@/components/fieldops/AuditScreen').then(m => m.AuditScreen), { loading: ScreenFallback })
const SettingsScreen = dynamic(() => import('@/components/fieldops/SettingsScreen').then(m => m.SettingsScreen), { loading: ScreenFallback })
const ConflictResolutionPanel = dynamic(() => import('@/components/fieldops/ConflictResolutionPanel').then(m => m.ConflictResolutionPanel), { loading: ScreenFallback })
const OperationsCenterScreen = dynamic(() => import('@/components/fieldops/OperationsCenterScreen').then(m => m.OperationsCenterScreen), { loading: ScreenFallback })

interface ProjectData { id: string; orgId: string; name: string; code: string; status: string; location: string | null; totalUnits: number; completionPct: number; isActive: boolean; units: any[]; assignments: any[] }
interface UserData { id: string; orgId: string; email: string; name: string; isActive: boolean; assignments: any[] }
interface RemarkData { id: string; orgId: string; unitId: string; unit: any; workOrderId: string | null; templateId: string | null; customIssue: string | null; severity: string; status: string; photos: string[]; gpsTag: Record<string, unknown> | null; resolutionNotes: string | null; createdBy: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string }
interface AuditLogData { id: string; user: any | null; action: string; resourceType: string; resourceId: string | null; details: Record<string, unknown>; createdAt: string }
interface DictionaryData { id: string; orgId: string; name: string; category: string; description: string | null; isActive: boolean; createdBy: string | null; items: any[] }
interface NavItem { id: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string; requireRole?: string[] }

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'operations', label: 'مركز التشغيل والتقارير', icon: BarChart3, badge: 'جديد' },
  { id: 'projects', label: 'المشاريع والوحدات', icon: Building2 },
  { id: 'speed-entry', label: 'الإدخال السريع', icon: Activity, badge: 'أوفلاين' },
  { id: 'bulk-import', label: 'الاستيراد من Excel', icon: FileSpreadsheet },
  { id: 'work-orders', label: 'أوامر العمل', icon: ClipboardCheck },
  { id: 'quality', label: 'الجودة والملاحظات', icon: Shield, badge: 'GPS' },
  { id: 'governance', label: 'الحوكمة والاعتماد', icon: Shield },
  { id: 'users', label: 'إدارة المستخدمين', icon: Users, requireRole: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  { id: 'dictionary', label: 'قاموس البنود', icon: BookOpen },
  { id: 'audit', label: 'سجل التدقيق', icon: History },
  { id: 'settings', label: 'الإعدادات والمزامنة', icon: Settings },
]

export default function FieldOpsApp() {
  const router = useRouter()
  const { isAuthenticated, user, logout } = useAuthStore()
  const { toast } = useToast()
  const isOnline = useOnlineStatus()
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isSyncing, setIsSyncing] = useState(false)
  const [orgId, setOrgId] = useState('demo')
  const [conflicts, setConflicts] = useState<SyncQueueItem[]>([])
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [selectedProject, setSelectedProject] = useState<ProjectData | null>(null)
  const [users, setUsers] = useState<UserData[]>([])
  const [remarks, setRemarks] = useState<RemarkData[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLogData[]>([])
  const [dictionaries, setDictionaries] = useState<DictionaryData[]>([])

  useEffect(() => setMounted(true), [])
  useEffect(() => { if (mounted && !isAuthenticated) router.push('/login') }, [mounted, isAuthenticated, router])
  useEffect(() => { if (user?.orgId) setOrgId(user.orgId) }, [user])
  useEffect(() => { registerServiceWorker() }, [])

  const loadAllData = useCallback(async () => {
    if (!orgId) return
    try {
      const [p, u, r, a, d] = await Promise.all([getProjectsHybrid(orgId), getUsersHybrid(orgId), getRemarksHybrid(orgId), getAuditLogsHybrid(orgId), getDictionariesHybrid(orgId)])
      if (p.data) { setProjects(p.data); setSelectedProject(current => current && p.data.some(x => x.id === current.id) ? p.data.find(x => x.id === current.id) || current : p.data[0] || null) }
      if (u.data) setUsers(u.data); if (r.data) setRemarks(r.data); if (a.data) setAuditLogs(a.data); if (d.data) setDictionaries(d.data)
      const pending = await getPendingSyncItems(); setConflicts(pending.filter(i => i.status === 'CONFLICT' || i.status === 'FAILED'))
    } catch (e) { console.error(e) }
  }, [orgId])
  useEffect(() => { if (isAuthenticated && orgId) loadAllData() }, [isAuthenticated, orgId, loadAllData])

  const sync = useCallback(async () => {
    setIsSyncing(true)
    try { const result = await fullDataSync(orgId); await processSyncQueue(); await loadAllData(); triggerBackgroundSync(); toast({ title: result.success ? 'تمت المزامنة' : 'المزامنة اكتملت مع ملاحظات', description: result.errors?.length ? result.errors.join('، ') : 'تم تحديث البيانات' }) }
    catch (e) { toast({ title: 'فشل المزامنة', description: String(e), variant: 'destructive' }) }
    finally { setIsSyncing(false) }
  }, [orgId, loadAllData, toast])

  const allowedNav = NAV_ITEMS.filter(item => !item.requireRole || item.requireRole.some(role => (user?.roles || []).includes(role)))
  const navigate = (id: string) => { if (allowedNav.some(x => x.id === id)) setActiveTab(id) }
  const logoutNow = () => { logout(); router.push('/login') }

  if (!mounted || !isAuthenticated) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>

  return <div className="min-h-screen flex flex-col bg-gray-50" dir="rtl">
    <header className="sticky top-0 z-50 bg-white border-b shadow-sm"><div className="flex items-center justify-between gap-3 px-4 h-14">
      <div className="flex items-center gap-3 shrink-0"><div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center"><Building2 className="w-5 h-5 text-white" /></div><div><h1 className="text-sm font-bold">FieldOps V4</h1><p className="text-[10px] text-muted-foreground">منصة العمليات الميدانية</p></div></div>
      <div className="hidden md:flex items-center gap-2"><SyncStatusBar orgId={orgId} onSync={sync} isSyncing={isSyncing} /><Select value={selectedProject?.id || ''} onValueChange={id => setSelectedProject(projects.find(p => p.id === id) || null)}><SelectTrigger className="w-52 h-8 text-xs"><SelectValue placeholder="اختر المشروع" /></SelectTrigger><SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" className="h-8 text-xs" onClick={sync} disabled={isSyncing}><RefreshCw className={isSyncing ? 'animate-spin ml-1 h-3.5 w-3.5' : 'ml-1 h-3.5 w-3.5'} />مزامنة</Button></div>
      <div className="flex items-center gap-2"><div className="hidden sm:block text-left"><p className="text-xs font-medium">{user?.name || 'مستخدم'}</p><p className="text-[10px] text-muted-foreground">{user?.roles?.[0] || 'مشاهد'}</p></div><Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={logoutNow}><LogOut className="h-4 w-4" /></Button></div>
    </div></header>

    <div className="md:hidden sticky top-14 z-40 bg-white border-b overflow-x-auto"><div className="flex gap-1 p-2 min-w-max">{allowedNav.map(item => <button key={item.id} onClick={() => navigate(item.id)} className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${activeTab === item.id ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>{item.label}{item.badge && <Badge variant="outline" className="mr-1 text-[8px] px-1 py-0">{item.badge}</Badge>}</button>)}</div></div>

    <div className="flex flex-1 overflow-hidden"><aside className="hidden md:flex md:w-64 flex-col bg-white border-l overflow-y-auto"><nav className="p-3 space-y-1 flex-1">{allowedNav.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => navigate(item.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${activeTab === item.id ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'text-gray-600 hover:bg-gray-50'}`}><Icon className="h-4 w-4" />{item.label}{item.badge && <Badge variant="outline" className="mr-auto text-[8px] px-1 py-0">{item.badge}</Badge>}</button>})}</nav><div className="p-3 border-t"><div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs"><div className="font-medium text-amber-800 flex items-center gap-2"><UploadCloud className="h-3.5 w-3.5" />حالة المزامنة</div><p className="text-amber-700 mt-1">{isOnline ? 'متصل — جاهز' : 'غير متصل — محفوظ محلياً'}</p></div></div></aside>
      <main className="flex-1 overflow-y-auto"><div className="p-4 md:p-6 max-w-7xl mx-auto">
        {activeTab === 'dashboard' && <DashboardScreen projects={projects} selectedProject={selectedProject} users={users} remarks={remarks} auditLogs={auditLogs} dictionaries={dictionaries} onNavigate={navigate} />}
        {activeTab === 'operations' && <OperationsCenterScreen selectedProject={selectedProject} />}
        {activeTab === 'projects' && <ProjectsScreen projects={projects} selectedProject={selectedProject} onSelectProject={setSelectedProject} orgId={orgId} onRefresh={loadAllData} dictionaries={dictionaries} />}
        {activeTab === 'speed-entry' && <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-2xl font-bold">مصفوفة الإدخال السريع</h2><p className="text-sm text-muted-foreground mt-1">تحديث نسب الإنجاز — {selectedProject?.name || 'اختر مشروعاً'}</p></div><Badge variant="outline"><WifiOff className="ml-1 h-3 w-3" />أوفلاين</Badge></div><SpeedEntryGrid project={selectedProject} orgId={orgId} onRefresh={loadAllData} /></div>}
        {activeTab === 'bulk-import' && <BulkImportScreen project={selectedProject} orgId={orgId} onRefresh={loadAllData} />}
        {activeTab === 'work-orders' && <WorkOrdersScreen project={selectedProject} orgId={orgId} onRefresh={loadAllData} />}
        {activeTab === 'quality' && <QualityScreen project={selectedProject} remarks={remarks} orgId={orgId} onRefresh={loadAllData} />}
        {activeTab === 'governance' && <GovernanceScreen orgId={orgId} onRefresh={loadAllData} />}
        {activeTab === 'users' && <UsersScreen users={users} projects={projects} orgId={orgId} onRefresh={loadAllData} />}
        {activeTab === 'dictionary' && <DictionaryScreen dictionaries={dictionaries} orgId={orgId} onRefresh={loadAllData} />}
        {activeTab === 'audit' && <AuditScreen auditLogs={auditLogs} orgId={orgId} onRefresh={loadAllData} />}
        {activeTab === 'settings' && <div className="space-y-6"><SettingsScreen orgId={orgId} /><ConflictResolutionPanel conflicts={conflicts} serverDataMap={Object.fromEntries(conflicts.filter(c => c.serverData).map(c => [c.operationUuid, JSON.parse(c.serverData!)]))} onResolve={loadAllData} onRefresh={loadAllData} /></div>}
      </div></main>
    </div><SyncNotifications orgId={orgId} />
  </div>
}
