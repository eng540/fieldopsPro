import { useEffect, useState } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { Building2, PlusCircle, Loader2, ChevronRight } from 'lucide-react'

export function ProjectsScreen() {
  const { projects, isLoading, error, loadProjects, selectProject, createProject } = useProjectStore()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => { loadProjects() }, [])

  const handleCreate = async () => {
    if (!name.trim() || !code.trim()) return setCreateError('Name and code are required')
    setCreating(true); setCreateError(null)
    try {
      await createProject({ name: name.trim(), code: code.trim() })
      setShowCreate(false); setName(''); setCode('')
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setCreating(false)
    }
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-slate-500">
      <Loader2 className="animate-spin mr-2" size={20} /> Loading projects…
    </div>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Projects</h2>
        <button onClick={() => setShowCreate(v => !v)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium">
          <PlusCircle size={16} /> New Project
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 bg-slate-50 border border-slate-200 rounded-xl p-5">
          <h3 className="font-medium text-slate-800 mb-3">Create Project</h3>
          {createError && <p className="text-red-600 text-sm mb-2">{createError}</p>}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Lusail Tower Phase 2"
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Code</label>
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="LT-P2"
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="border border-slate-300 text-slate-700 px-4 py-1.5 rounded-lg text-sm">Cancel</button>
            <button onClick={handleCreate} disabled={creating} className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm disabled:opacity-50">
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p>No projects yet. Create your first project.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map(p => (
            <button key={p.id} onClick={() => selectProject(p.id)}
              className="w-full bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4 hover:border-indigo-300 hover:shadow-sm transition-all text-left">
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
                <Building2 size={18} className="text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800">{p.name}</div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">{p.code} · {p.total_units} units</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-700">{(p.completion_pct ?? 0).toFixed(0)}%</div>
                  <div className="w-16 h-1.5 bg-slate-100 rounded-full mt-1">
                    <div className="h-1.5 bg-indigo-500 rounded-full" style={{ width: `${p.completion_pct ?? 0}%` }} />
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
