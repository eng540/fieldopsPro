import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/client'
import { Loader2, TrendingUp, BarChart2, Download, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface ProjectProgress {
  project_id: number
  project_name: string
  project_code: string
  completion_pct: number
  open_remarks: number
  active_work_orders: number
}

interface WOBreakdown {
  status: string
  count: number
  avg_completion_pct: number
}

interface OrgSummary {
  total_projects: number
  active_projects: number
  total_work_orders: number
  completed_work_orders: number
  open_remarks: number
  critical_remarks: number
  governance_holds: number
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT:            '#94a3b8',
  PENDING_APPROVAL: '#f59e0b',
  APPROVED:         '#3b82f6',
  IN_PROGRESS:      '#6366f1',
  COMPLETED:        '#10b981',
  CANCELLED:        '#ef4444',
}

export function ReportsScreen() {
  const [summary, setSummary]   = useState<OrgSummary | null>(null)
  const [projects, setProjects] = useState<ProjectProgress[]>([])
  const [woBreakdown, setWoBreakdown] = useState<WOBreakdown[]>([])
  const [loading, setLoading]   = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [s, p, w] = await Promise.all([
          apiClient.get('/reporting/summary'),
          apiClient.get('/reporting/project-progress'),
          apiClient.get('/reporting/work-orders'),
        ])
        if (s.ok) setSummary(await s.json())
        if (p.ok) setProjects((await p.json()).items || [])
        if (w.ok) setWoBreakdown((await w.json()).breakdown || [])
      } catch { /* offline */ }
      setLoading(false)
    }
    load()
  }, [])

  const handleIPCExport = async () => {
    setExporting(true); setExportError(null)
    try {
      const resp = await apiClient.post('/reporting/ipc', {
        format: 'xlsx',
        include_holds: true,
      })
      if (resp.ok) {
        const blob = await resp.blob()
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = `IPC-Export-${new Date().toISOString().slice(0,10)}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        const data = await resp.json()
        setExportError(data.detail || 'Export failed')
      }
    } catch (e: any) {
      setExportError(e.message)
    }
    setExporting(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-500">
      <Loader2 className="animate-spin mr-2" size={20} />Loading reports…
    </div>
  )

  const totalWO = woBreakdown.reduce((s, b) => s + b.count, 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Reports & Analytics</h2>
          <p className="text-xs text-slate-500 mt-0.5">Org-level insights</p>
        </div>
        <div className="flex items-center gap-3">
          {exportError && (
            <p className="text-xs text-red-600">{exportError}</p>
          )}
          <button
            onClick={handleIPCExport}
            disabled={exporting}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm font-medium disabled:opacity-50"
          >
            <Download size={15} />
            {exporting ? 'Exporting…' : 'Export IPC'}
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Projects',   value: summary.total_projects,   sub: `${summary.active_projects} active`,           color: 'indigo' },
            { label: 'Work Orders',      value: summary.total_work_orders, sub: `${summary.completed_work_orders} completed`, color: 'blue' },
            { label: 'Open Remarks',     value: summary.open_remarks,     sub: `${summary.critical_remarks} critical`,        color: summary.critical_remarks > 0 ? 'red' : 'amber' },
            { label: 'Governance Holds', value: summary.governance_holds, sub: summary.governance_holds > 0 ? 'Action needed' : 'All clear', color: summary.governance_holds > 0 ? 'orange' : 'emerald' },
          ].map(({ label, value, sub, color }) => (
            <div key={label} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <div className={`text-3xl font-bold text-${color}-600`}>{value}</div>
              <div className="text-sm font-medium text-slate-700 mt-0.5">{label}</div>
              <div className="text-xs text-slate-400">{sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Work Order Status Chart */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
            <BarChart2 size={16} className="text-indigo-500" />
            <span className="font-semibold text-slate-800">Work Order Breakdown</span>
          </div>
          <div className="p-5 space-y-3">
            {woBreakdown.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">No work orders yet</p>
            ) : woBreakdown.map(b => (
              <div key={b.status}>
                <div className="flex justify-between text-xs text-slate-600 mb-1">
                  <span className="font-medium">{b.status.replace('_', ' ')}</span>
                  <span>{b.count} · {b.avg_completion_pct.toFixed(0)}% avg</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${totalWO > 0 ? (b.count / totalWO) * 100 : 0}%`,
                      backgroundColor: STATUS_COLOR[b.status] || '#94a3b8',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Project Progress */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
            <TrendingUp size={16} className="text-emerald-500" />
            <span className="font-semibold text-slate-800">Project Progress</span>
          </div>
          <div className="divide-y divide-slate-50">
            {projects.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">No projects yet</p>
            ) : projects.map(p => (
              <div key={p.project_id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm font-medium text-slate-800 truncate">{p.project_name}</span>
                    <span className="text-xs font-mono bg-slate-100 text-slate-500 px-1 rounded">{p.project_code}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${p.completion_pct}%`,
                        backgroundColor: p.completion_pct >= 80 ? '#10b981' : p.completion_pct >= 40 ? '#6366f1' : '#f59e0b',
                      }}
                    />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold text-slate-700">{p.completion_pct.toFixed(0)}%</div>
                  <div className="flex items-center gap-1 text-xs">
                    {p.open_remarks > 0
                      ? <span className="text-amber-600 flex items-center gap-0.5"><AlertTriangle size={10} />{p.open_remarks}</span>
                      : <span className="text-emerald-600 flex items-center gap-0.5"><CheckCircle2 size={10} />clear</span>
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
