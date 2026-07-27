import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/client'
import { useAuthStore } from '@/stores/authStore'
import {
  Building2, ClipboardList, AlertTriangle,
  ShieldAlert, CheckCircle2, Loader2, TrendingUp,
} from 'lucide-react'

interface OrgSummary {
  total_projects: number
  active_projects: number
  total_work_orders: number
  completed_work_orders: number
  open_remarks: number
  critical_remarks: number
  governance_holds: number
  pending_sync_ops: number
}

interface ProjectProgress {
  project_id: number
  project_name: string
  project_code: string
  completion_pct: number
  open_remarks: number
  active_work_orders: number
}

export function DashboardScreen() {
  const { user } = useAuthStore()
  const [summary, setSummary] = useState<OrgSummary | null>(null)
  const [projects, setProjects] = useState<ProjectProgress[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [sumResp, projResp] = await Promise.all([
          apiClient.get('/reporting/summary'),
          apiClient.get('/reporting/project-progress'),
        ])
        if (sumResp.ok) setSummary(await sumResp.json())
        if (projResp.ok) {
          const d = await projResp.json()
          setProjects(d.items || [])
        }
      } catch { /* offline */ }
      setLoading(false)
    }
    load()
  }, [])

  const completionRate = summary
    ? Math.round((summary.completed_work_orders / Math.max(summary.total_work_orders, 1)) * 100)
    : 0

  const KPI_CARDS = summary ? [
    {
      label: 'Active Projects',
      value: summary.active_projects,
      sub: `${summary.total_projects} total`,
      icon: Building2,
      color: 'indigo',
    },
    {
      label: 'Work Orders',
      value: summary.total_work_orders,
      sub: `${completionRate}% completed`,
      icon: ClipboardList,
      color: 'blue',
    },
    {
      label: 'Open Remarks',
      value: summary.open_remarks,
      sub: `${summary.critical_remarks} critical`,
      icon: AlertTriangle,
      color: summary.critical_remarks > 0 ? 'red' : 'amber',
    },
    {
      label: 'Governance Holds',
      value: summary.governance_holds,
      sub: summary.governance_holds > 0 ? 'Requires review' : 'All clear',
      icon: ShieldAlert,
      color: summary.governance_holds > 0 ? 'orange' : 'emerald',
    },
  ] : []

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-500">
      <Loader2 className="animate-spin mr-2" size={20} />Loading dashboard…
    </div>
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-0.5">{user?.email}</p>
      </div>

      {/* KPI Grid */}
      {summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {KPI_CARDS.map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className={`w-9 h-9 rounded-lg bg-${color}-50 flex items-center justify-center mb-3`}>
                <Icon size={18} className={`text-${color}-600`} />
              </div>
              <div className={`text-3xl font-bold text-${color}-600`}>{value}</div>
              <div className="text-sm font-medium text-slate-700 mt-0.5">{label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-8 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          Dashboard data unavailable — working offline.
        </div>
      )}

      {/* Project Progress */}
      {projects.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
            <TrendingUp size={16} className="text-indigo-500" />
            <span className="font-semibold text-slate-800">Project Progress</span>
          </div>
          <div className="divide-y divide-slate-50">
            {projects.map(p => (
              <div key={p.project_id} className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800 truncate">{p.project_name}</span>
                    <span className="text-xs font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                      {p.project_code}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${p.completion_pct}%`,
                          backgroundColor: p.completion_pct >= 80
                            ? '#10b981' : p.completion_pct >= 40
                            ? '#6366f1' : '#f59e0b',
                        }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-slate-700 w-10 text-right">
                      {p.completion_pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="flex gap-3 text-xs text-slate-500 shrink-0">
                  {p.open_remarks > 0 && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <AlertTriangle size={11} /> {p.open_remarks}
                    </span>
                  )}
                  {p.active_work_orders > 0 && (
                    <span className="flex items-center gap-1 text-indigo-600">
                      <ClipboardList size={11} /> {p.active_work_orders}
                    </span>
                  )}
                  {p.open_remarks === 0 && p.active_work_orders === 0 && (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 size={11} /> Clear
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
