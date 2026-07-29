import { useState } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { ArrowLeft, UserPlus, PackagePlus, Users, Layers } from 'lucide-react'

export function ProjectDetailsScreen() {
  const { projects, units, selectedProjectId, selectProject, createUnit, createBoqItem } = useProjectStore()
  const project = projects.find(p => p.id === selectedProjectId)
  
  const [showUnitModal, setShowUnitModal] = useState(false)
  const [showBoqModal, setShowBoqModal] = useState<number | null>(null) // unitId

  if (!project) return null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => selectProject(null)} className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 mb-4">
        <ArrowLeft size={16} /> Back to Projects
      </button>
      
      <div className="flex items-center justify-between mb-6 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{project.name}</h2>
          <p className="text-sm text-slate-500 font-mono mt-1">{project.code}</p>
        </div>
        <button onClick={() => setShowUnitModal(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium">
          <UserPlus size={16} /> Add Beneficiary
        </button>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2"><Users size={18}/> Beneficiaries ({units.length})</h3>
        {units.length === 0 ? (
          <p className="text-slate-400 text-sm p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">No beneficiaries added yet.</p>
        ) : (
          units.map(u => (
            <div key={u.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-800">Unit #{u.id} <span className="text-xs font-normal text-slate-500 ml-2">({u.unitCode})</span></p>
                <p className="text-xs text-slate-500 mt-1">Type: {u.unitType} | Status: {u.status}</p>
              </div>
              <button onClick={() => setShowBoqModal(u.id)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg hover:bg-emerald-100 text-sm font-medium">
                <PackagePlus size={14} /> Add BoQ Item
              </button>
            </div>
          ))
        )}
      </div>

      {showUnitModal && <AddUnitModal projectId={project.id} onClose={() => setShowUnitModal(false)} onSubmit={createUnit} />}
      {showBoqModal && <AddBoqModal projectId={project.id} unitId={showBoqModal} onClose={() => setShowBoqModal(null)} onSubmit={createBoqItem} />}
    </div>
  )
}

function AddUnitModal({ projectId, onClose, onSubmit }: any) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [type, setType] = useState('LATRINE')
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Add Beneficiary / Unit</h3>
        <input className="w-full border p-2 rounded mb-3 text-sm" placeholder="Beneficiary Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="w-full border p-2 rounded mb-3 text-sm" placeholder="Unit Code (e.g. LAT-001)" value={code} onChange={e => setCode(e.target.value)} />
        <select className="w-full border p-2 rounded mb-4 text-sm" value={type} onChange={e => setType(e.target.value)}>
          <option value="LATRINE">Latrine</option><option value="SHELTER">Shelter</option><option value="SCHOOL">School</option>
        </select>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border p-2 rounded text-sm">Cancel</button>
          <button onClick={async () => { await onSubmit(projectId, { name, code, unit_type: type }); onClose() }} className="flex-1 bg-indigo-600 text-white p-2 rounded text-sm">Save</button>
        </div>
      </div>
    </div>
  )
}

function AddBoqModal({ projectId, unitId, onClose, onSubmit }: any) {
  const [trade, setTrade] = useState(''); const [desc, setDesc] = useState(''); const [qty, setQty] = useState(''); const [unit, setUnit] = useState('m3')
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Add BoQ Item to Unit #{unitId}</h3>
        <input className="w-full border p-2 rounded mb-3 text-sm" placeholder="Trade (e.g. Excavation, Concrete)" value={trade} onChange={e => setTrade(e.target.value)} />
        <input className="w-full border p-2 rounded mb-3 text-sm" placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} />
        <div className="flex gap-3 mb-4">
          <input type="number" className="flex-1 border p-2 rounded text-sm" placeholder="Quantity" value={qty} onChange={e => setQty(e.target.value)} />
          <input className="flex-1 border p-2 rounded text-sm" placeholder="Unit (e.g. m3, lm)" value={unit} onChange={e => setUnit(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border p-2 rounded text-sm">Cancel</button>
          <button onClick={async () => { await onSubmit(projectId, unitId, { trade, description: desc, quantity: parseFloat(qty), unit_of_measure: unit }); onClose() }} className="flex-1 bg-emerald-600 text-white p-2 rounded text-sm">Save Item</button>
        </div>
      </div>
    </div>
  )
}