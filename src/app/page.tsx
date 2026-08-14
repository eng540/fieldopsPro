// --- START OF FILE src/app/page.tsx ---
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Building2, RefreshCw, LogOut, Settings, UploadCloud, WifiOff, Loader2, BarChart3, CalendarDays, FileText, Smartphone } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { SyncStatusBar } from '@/components/fieldops/SyncStatusBar'
import { SyncNotifications } from '@/components/fieldops/SyncNotifications'
import { ScreenErrorBoundary } from '@/components/fieldops/ScreenErrorBoundary'
import { ProjectWorkflowBridge } from '@/components/fieldops/ProjectWorkflowBridge'
import { OperationalWorkflowRail } from '@/components/fieldops/OperationalWorkflowRail'

const ScreenFallback = () => <div className="flex flex-col items-center justify-center h-[60vh] text-emerald-600"><Loader2 className="w-8 h-8 animate-spin mb-4" /><p className="text-sm font-medium text-gray-500">جاري تحميل الشاشة...</p></div>
const DashboardScreen = dynamic(() => import('@/components/fieldops/DashboardScreen').then(mod => mod.DashboardScreen), { loading: ScreenFallback })
const ProjectsScreen = dynamic(() => import('@/components/fieldops/ProjectsScreen').then(mod => mod.ProjectsScreen), { loading: ScreenFallback })
const SpeedEntryGrid = dynamic(() => import('@/components/fieldops/SpeedEntryGrid').then(mod => mod.SpeedEntryGrid), { loading: ScreenFallback })
const BulkImportScreen = dynamic(() => import('@/components/fieldops/BulkImportScreen').then(mod => mod.BulkImportScreen), { loading: ScreenFallback })
const WorkOrdersScreen = dynamic(() => import('@/components/fieldops/WorkOrdersScreen').then(mod => mod.WorkOrdersScreen), { loading: ScreenFallback })
const QualityScreen = dynamic(() => import('@/components/fieldops/QualityScreen').then(mod => mod.QualityScreen), { loading: ScreenFallback })
const GovernanceScreen = dynamic(() => import('@/components/fieldops/GovernanceScreen').then(mod => mod.GovernanceScreen), { loading: ScreenFallback })
const UsersScreen = dynamic(() => import('@/components/fieldops/UsersScreen').then(mod => mod.UsersScreen), { loading: ScreenFallback })
const DictionaryScreen = dynamic(() => import('@/components/fieldops/DictionaryScreen').then(mod => mod.DictionaryScreen), { loading: ScreenFallback })
const AuditScreen = dynamic(() => import('@/components/fieldops/AuditScreen').then(mod => mod.AuditScreen), { loading: ScreenFallback })
const SettingsScreen = dynamic(() => import('@/components/fieldops/SettingsScreen').then(mod => mod.SettingsScreen), { loading: ScreenFallback })
const ConflictResolutionPanel = dynamic(() => import('@/components/fieldops/ConflictResolutionPanel').then(mod => mod.ConflictResolutionPanel), { loading: ScreenFallback })
const OperationsCenterScreen = dynamic(() => import('@/components/fieldops/OperationsCenterScreen').then(mod => mod.OperationsCenterScreen), { loading: ScreenFallback })
const FieldDiaryScreen = dynamic(() => import('@/components/fieldops/FieldDiaryScreen').then(mod => mod.FieldDiaryScreen), { loading: ScreenFallback })
const LegacyReportsScreen = dynamic(() => import('@/components/fieldops/LegacyReportsScreen').then(mod => mod.LegacyReportsScreen), { loading: ScreenFallback })
const FieldMobileCenterScreen = dynamic(() => import('@/components/fieldops/FieldMobileCenterScreen').then(mod => mod.FieldMobileCenterScreen), { loading: ScreenFallback })

import { getPendingSyncItems, type SyncQueueItem } from '@/lib/offline-db'
import { useOnlineStatus } from '@/lib/sync-hooks'
import { useAuthStore } from '@/lib/auth-store'
import { getProjectsHybrid, getRemarksHybrid, getUsersHybrid, getAuditLogsHybrid, getDictionariesHybrid, fullDataSync, processSyncQueue } from '@/lib/api-client'
import { registerServiceWorker, triggerBackgroundSync } from '@/lib/sw-register'

interface ProjectData { id: string; orgId: string; name: string; code: string; status: string; location: string | null; totalUnits: number; completionPct: number; isActive: boolean; units: any[]; assignments: any[] }
interface UserData { id: string; orgId: string; email: string; name: string; isActive: boolean; assignments: any[] }
interface RemarkData { id: string; orgId: string; unitId: string; unit: any; workOrderId: string | null; templateId: string | null; customIssue: string | null; severity: string; status: string; photos: string[]; gpsTag: Record<string, unknown> | null; resolutionNotes: string | null; createdBy: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string }
interface AuditLogData { id: string; user: any | null; action: string; resourceType: string; resourceId: string | null; details: Record<string, unknown>; createdAt: string }
interface DictionaryData { id: string; orgId: string; name: string; category: string; description: string | null; isActive: boolean; createdBy: string | null; items: any[] }
interface NavItem { id: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string; requireRole?: string[] }

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: Building2 },
  { id: 'operations', label: 'مركز التشغيل', icon: BarChart3, badge: 'تشغيل' },
  { id: 'diary', label: 'سجل الموقع اليومي', icon: CalendarDays, badge: 'ميداني' },
  { id: 'reports', label: 'التقارير وIPC', icon: FileText, badge: 'تقارير' },
  { id: 'mobile', label: 'مركز العمل الميداني', icon: Smartphone, badge: 'PWA' },
  { id: 'projects', label: 'المشاريع', icon: Building2 },
  { id: 'speed-entry', label: 'الإدخال السريع', icon: Building2, badge: 'أوفلاين' },
  { id: 'bulk-import', label: 'الاستيراد من Excel', icon: Building2 },
  { id: 'work-orders', label: 'أوامر العمل', icon: Building2 },
  { id: 'quality', label: 'الجودة والملاحظات', icon: Building2, badge: 'GPS' },
  { id: 'governance', label: 'الحوكمة', icon: Building2 },
  { id: 'users', label: 'إدارة المستخدمين', icon: Building2, requireRole: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  { id: 'dictionary', label: 'قاموس البنود', icon: Building2 },
  { id: 'audit', label: 'سجل التدقيق', icon: Building2 },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
]

export default function FieldOpsApp() {
  const router = useRouter(); const { isAuthenticated, user, logout } = useAuthStore()
  const [isMounted, setIsMounted] = useState(false); const [activeTab, setActiveTab] = useState('dashboard'); const [isSyncing, setIsSyncing] = useState(false); const [orgId, setOrgId] = useState('demo'); const [conflicts, setConflicts] = useState<SyncQueueItem[]>([])
  const [projects, setProjects] = useState<ProjectData[]>([]); const [selectedProject, setSelectedProject] = useState<ProjectData | null>(null); const [users, setUsers] = useState<UserData[]>([]); const [remarks, setRemarks] = useState<RemarkData[]>([]); const [auditLogs, setAuditLogs] = useState<AuditLogData[]>([]); const [dictionaries, setDictionaries] = useState<DictionaryData[]>([])
  const isOnline = useOnlineStatus(); const { toast } = useToast()
  useEffect(() => { setIsMounted(true) }, [])
  useEffect(() => { if (isMounted && !isAuthenticated) router.push('/login') }, [isMounted, isAuthenticated, router])
  useEffect(() => { if (user?.orgId) setOrgId(user.orgId) }, [user])
  const loadAllData = useCallback(async () => { try { const [a,b,c,d,e] = await Promise.all([getProjectsHybrid(orgId), getUsersHybrid(orgId), getRemarksHybrid(orgId), getAuditLogsHybrid(orgId), getDictionariesHybrid(orgId)]); if (a.data) { setProjects(a.data); if (a.data.length) setSelectedProject(current => current ?? a.data[0]) }; if (b.data) setUsers(b.data); if (c.data) setRemarks(c.data); if (d.data) setAuditLogs(d.data); if (e.data) setDictionaries(e.data); const pending = await getPendingSyncItems(); setConflicts(pending.filter(i => i.status === 'CONFLICT' || i.status === 'FAILED')) } catch (err) { console.error('Load error:', err) } }, [orgId])
  useEffect(() => { registerServiceWorker() }, []); useEffect(() => { if (isAuthenticated && orgId) loadAllData() }, [isAuthenticated, orgId, loadAllData])
  const handleRealSync = useCallback(async () => { setIsSyncing(true); try { await fullDataSync(orgId); await processSyncQueue(); await loadAllData(); triggerBackgroundSync(); toast({ title: 'تمت المزامنة', description: 'تم تحديث البيانات' }) } catch (err) { console.error(err); toast({ title: 'فشل المزامنة', variant: 'destructive' }) } finally { setIsSyncing(false) } }, [orgId, loadAllData, toast])
  const handleLogout = () => { logout(); router.push('/login') }
  const allowedNav = NAV_ITEMS.filter(item => !item.requireRole || item.requireRole.some(role => (user?.roles || []).includes(role))); const navigate = (id: string) => { if (allowedNav.some(item => item.id === id)) setActiveTab(id) }
  if (!isMounted || !isAuthenticated) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>
  const wrap = (name: string, node: React.ReactNode) => <ScreenErrorBoundary screenName={name}>{node}</ScreenErrorBoundary>
  const workflow = <OperationalWorkflowRail project={selectedProject} remarks={remarks} online={isOnline} pendingCount={conflicts.length} onNavigate={navigate}/>
  return <div className="min-h-screen flex flex-col bg-gray-50" dir="rtl">
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm"><div className="flex items-center justify-between px-4 h-14"><div className="flex items-center gap-3"><div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center"><Building2 className="w-5 h-5 text-white" /></div><div><h1 className="text-sm font-bold">FieldOps V4</h1><p className="text-xs text-gray-500">منصة العمليات الميدانية</p></div></div><div className="flex items-center gap-3">{wrap('المزامنة', <SyncStatusBar orgId={orgId} onSync={handleRealSync} isSyncing={isSyncing} />)}<Select value={selectedProject?.id || ''} onValueChange={v=>{const p=projects.find(x=>x.id===v);if(p)setSelectedProject(p)}}><SelectTrigger className="w-48 text-xs h-8"><SelectValue placeholder="اختر مشروع"/></SelectTrigger><SelectContent>{projects.map(p=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" onClick={handleRealSync} disabled={isSyncing}><RefreshCw className={`w-3.5 h-3.5 ml-1 ${isSyncing?'animate-spin':''}`}/>مزامنة</Button></div><div className="flex items-center gap-2 border-r pr-3"><div className="w-7 h-7 bg-emerald-100 rounded-full flex items-center justify-center"><span className="text-xs font-bold text-emerald-700">{user?.name?.charAt(0)||'م'}</span></div><div className="hidden lg:block"><p className="text-xs font-medium">{user?.name||'مستخدم'}</p><p className="text-[10px] text-gray-500">{user?.roles?.[0]||'مشاهد'}</p></div><Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-500 hover:text-red-600" onClick={handleLogout}><LogOut className="w-3.5 h-3.5"/></Button></div></div></header>
    <div className="sticky top-14 z-40 bg-white border-b md:hidden"><div className="flex overflow-x-auto gap-1 px-2 py-1.5">{allowedNav.map(item=><button key={item.id} onClick={()=>navigate(item.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${activeTab===item.id?'bg-emerald-100 text-emerald-800':'bg-gray-100 text-gray-600'}`}>{item.label}{item.badge&&<Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{item.badge}</Badge>}</button>)}</div></div>
    <div className="flex flex-1 overflow-hidden"><aside className="hidden md:flex md:w-60 lg:w-64 flex-col bg-white border-l overflow-y-auto"><nav className="flex-1 px-3 py-4 space-y-1">{allowedNav.map(item=><button key={item.id} onClick={()=>navigate(item.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${activeTab===item.id?'bg-emerald-50 text-emerald-700 border border-emerald-200':'text-gray-600 hover:bg-gray-50'}`}>{item.label}{item.badge&&<Badge variant="outline" className="text-[9px] mr-auto px-1 py-0 h-4">{item.badge}</Badge>}</button>)}</nav><div className="px-3 py-4 border-t"><div className="bg-amber-50 border border-amber-200 rounded-lg p-3"><div className="flex items-center gap-2 text-amber-800 text-xs font-medium mb-1"><UploadCloud className="w-3.5 h-3.5"/>طابور المزامنة</div><p className="text-xs text-amber-600">{isOnline?'متصل — جاهز للمزامنة':'غير متصل — محفوظ محلياً'}</p><Button variant="ghost" size="sm" className="text-xs h-6 mt-1" onClick={()=>navigate('mobile')}><Settings className="w-3 h-3 ml-1"/>إدارة الميدان</Button></div></div></aside>
      <main className="flex-1 overflow-y-auto"><div className="p-4 md:p-6 max-w-7xl mx-auto">
        {activeTab==='dashboard'&&wrap('لوحة التحكم', <>{workflow}<ProjectWorkflowBridge project={selectedProject} remarks={remarks} onNavigate={navigate}/><DashboardScreen projects={projects} selectedProject={selectedProject} users={users} remarks={remarks} auditLogs={auditLogs} dictionaries={dictionaries} onNavigate={navigate}/></>)}
        {activeTab==='operations'&&wrap('مركز التشغيل', <><OperationalWorkflowRail project={selectedProject} remarks={remarks} online={isOnline} pendingCount={conflicts.length} onNavigate={navigate}/><OperationsCenterScreen selectedProject={selectedProject}/></>)}
        {activeTab==='diary'&&wrap('السجل اليومي', <><OperationalWorkflowRail project={selectedProject} remarks={remarks} online={isOnline} pendingCount={conflicts.length} onNavigate={navigate}/><FieldDiaryScreen projectId={selectedProject?.id} projectName={selectedProject?.name}/></>)}
        {activeTab==='reports'&&wrap('التقارير', <><OperationalWorkflowRail project={selectedProject} remarks={remarks} online={isOnline} pendingCount={conflicts.length} onNavigate={navigate}/><LegacyReportsScreen/></>)}
        {activeTab==='mobile'&&wrap('المركز الميداني', <FieldMobileCenterScreen/>)}
        {activeTab==='projects'&&wrap('المشاريع', <ProjectsScreen projects={projects} selectedProject={selectedProject} onSelectProject={setSelectedProject} orgId={orgId} onRefresh={loadAllData} dictionaries={dictionaries}/>)}
        {activeTab==='speed-entry'&&wrap('الإدخال السريع', <div className="space-y-4">{workflow}<div className="flex items-center justify-between"><div><h2 className="text-2xl font-bold">مصفوفة الإدخال السريع</h2><p className="text-sm text-gray-500 mt-1">تحديث نسب الإنجاز — {selectedProject?.name||'اختر مشروعاً'}</p></div><Badge variant="outline"><WifiOff className="w-3 h-3 ml-1"/>أوفلاين</Badge></div><SpeedEntryGrid project={selectedProject} orgId={orgId} onRefresh={loadAllData}/></div>)}
        {activeTab==='bulk-import'&&wrap('الاستيراد من Excel', <><OperationalWorkflowRail project={selectedProject} remarks={remarks} online={isOnline} pendingCount={conflicts.length} onNavigate={navigate}/><BulkImportScreen project={selectedProject} orgId={orgId} onRefresh={loadAllData}/></>)}
        {activeTab==='work-orders'&&wrap('أوامر العمل', <WorkOrdersScreen project={selectedProject} orgId={orgId} onRefresh={loadAllData}/>)}
        {activeTab==='quality'&&wrap('الجودة', <><OperationalWorkflowRail project={selectedProject} remarks={remarks} online={isOnline} pendingCount={conflicts.length} onNavigate={navigate}/><ProjectWorkflowBridge project={selectedProject} remarks={remarks} onNavigate={navigate}/><QualityScreen project={selectedProject} remarks={remarks} orgId={orgId} onRefresh={loadAllData}/></>)}
        {activeTab==='governance'&&wrap('الحوكمة', <GovernanceScreen orgId={orgId} onRefresh={loadAllData}/>)}
        {activeTab==='users'&&wrap('المستخدمون', <UsersScreen users={users} projects={projects} orgId={orgId} onRefresh={loadAllData}/>)}
        {activeTab==='dictionary'&&wrap('القاموس', <DictionaryScreen dictionaries={dictionaries} orgId={orgId} onRefresh={loadAllData}/>)}
        {activeTab==='audit'&&wrap('التدقيق', <AuditScreen auditLogs={auditLogs} orgId={orgId} onRefresh={loadAllData}/>)}
        {activeTab==='settings'&&wrap('الإعدادات', <div className="space-y-6"><SettingsScreen orgId={orgId}/><ConflictResolutionPanel conflicts={conflicts} serverDataMap={Object.fromEntries(conflicts.filter(c=>c.serverData).map(c=>{try{return [c.operationUuid,JSON.parse(c.serverData!)]}catch{return [c.operationUuid,{}]}}))} onResolve={()=>loadAllData()} onRefresh={loadAllData}/></div>)}
      </div></main></div><SyncNotifications orgId={orgId}/></div>
}
