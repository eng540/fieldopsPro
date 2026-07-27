import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { LoginScreen }      from './components/LoginScreen'
import { ProtectedRoute }   from './components/ProtectedRoute'
import { SyncStatusBar }    from './components/SyncStatusBar'
import { ConflictsPanel }   from './components/ConflictsPanel'
import { DashboardScreen }  from './components/DashboardScreen'
import { ProjectsScreen }   from './components/ProjectsScreen'
import { WorkOrdersScreen } from './components/WorkOrdersScreen'
import { QualityScreen }    from './components/QualityScreen'
import { GovernanceScreen } from './components/GovernanceScreen'
import { ReportsScreen }    from './components/ReportsScreen'
import {
  LayoutDashboard, ClipboardList, Building2,
  ShieldCheck, BarChart3, Shield, LogOut, Menu, X,
} from 'lucide-react'

const NAV = [
  { path: '/dashboard',   label: 'Dashboard',   icon: LayoutDashboard },
  { path: '/projects',    label: 'Projects',     icon: Building2 },
  { path: '/work-orders', label: 'Work Orders',  icon: ClipboardList },
  { path: '/quality',     label: 'Quality',      icon: Shield },
  { path: '/governance',  label: 'Governance',   icon: ShieldCheck },
  { path: '/reports',     label: 'Reports',      icon: BarChart3 },
]

function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <SyncStatusBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`
          fixed inset-y-0 left-0 z-40 w-60 bg-slate-900 text-white flex flex-col
          transition-transform duration-200
          md:relative md:translate-x-0
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `} style={{ top: '34px' }}>
          <div className="px-4 py-5 border-b border-slate-700">
            <div className="font-bold text-white">FieldOps V4</div>
            <div className="text-xs text-slate-400 mt-0.5 truncate">{user?.email}</div>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {NAV.map(({ path, label, icon: Icon }) => (
              <button key={path}
                onClick={() => { navigate(path); setOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === path
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon size={17} />{label}
              </button>
            ))}
          </nav>
          <div className="px-3 py-4 border-t border-slate-700">
            <button onClick={() => logout()}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white">
              <LogOut size={17} />Sign out
            </button>
          </div>
        </aside>

        {open && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setOpen(false)} />}

        <main className="flex-1 overflow-auto">
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
            <span className="font-bold text-slate-800">FieldOps V4</span>
            <button onClick={() => setOpen(v => !v)} className="text-slate-600">
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
          {children}
        </main>
      </div>
      <ConflictsPanel />
    </div>
  )
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-64 text-center">
      <div>
        <p className="text-slate-400 text-lg font-medium">{title}</p>
        <p className="text-slate-300 text-sm mt-1">Coming in Sprint-4</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <AppShell>
            <Routes>
              <Route path="/dashboard"   element={<DashboardScreen />} />
              <Route path="/projects"    element={<ProjectsScreen />} />
              <Route path="/work-orders" element={<WorkOrdersScreen />} />
              <Route path="/quality"     element={<QualityScreen />} />
              <Route path="/governance"  element={<GovernanceScreen />} />
              <Route path="/reports"     element={<ReportsScreen />} />
              <Route path="/"            element={<Navigate to="/dashboard" replace />} />
              <Route path="*"            element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </AppShell>
        </ProtectedRoute>
      } />
    </Routes>
  )
}
