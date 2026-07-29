import { useState } from 'react'
import { useProjectStore } from '@/stores/projectStore'
import { ArrowLeft, UserPlus, PackagePlus, Users, UploadCloud } from 'lucide-react'

export function ProjectDetailsScreen() {
  const { projects, units, selectedProjectId, selectProject, createUnit, createBoqItem, bulkImportUnits } = useProjectStore()
  const project = projects.find(p => p.id === selectedProjectId)
  
  const [showUnitModal, setShowUnitModal] = useState(false)
  const [showBoqModal, setShowBoqModal] = useState<number | null>(null)
  const [showBulkModal, setShowBulkModal] = useState(false)

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
        <div className="flex gap-2">
          <button onClick={() => setShowBulkModal(true)} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm font-medium">
            <UploadCloud size={16} /> Bulk Import
          </button>
          <button onClick={() => setShowUnitModal(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium">
            <UserPlus size={16} /> Add Single
          </button>
        </div>
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
              <button onClick={() => setShowBoqModal(u.id)} className="flex items-center gap-2 bg-slate-50 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-100 text-sm font-medium">
                <PackagePlus size={14} /> Add Extra BoQ
              </button>
            </div>
          ))
        )}
      </div>

      {showUnitModal && <AddUnitModal projectId={project.id} onClose={() => setShowUnitModal(false)} onSubmit={createUnit} />}
      {showBoqModal && <AddBoqModal projectId={project.id} unitId={showBoqModal} onClose={() => setShowBoqModal(null)} onSubmit={createBoqItem} />}
      {showBulkModal && <BulkImportModal projectId={project.id} onClose={() => setShowBulkModal(false)} onSubmit={bulkImportUnits} />}
    </div>
  )
}

function BulkImportModal({ projectId, onClose, onSubmit }: any) {
  const [bensText, setBensText] = useState('Ahmed Ali, LAT-001\nFatima Saeed, LAT-002')
  const [boqText, setBoqText] = useState('Excavation, Digging foundation, 15, m3\nConcrete, RC Slab, 5, m3')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string|null>(null)

  const handleImport = async () => {
    setLoading(true); setError(null)
    try {
      // Parse CSV-like text
      const beneficiaries = bensText.split('\n').filter(l => l.trim()).map(line => {
        const [name, code] = line.split(',').map(s => s.trim())
        return { name, code, unit_type: 'LATRINE' }
      })

      const master_boq = boqText.split('\n').filter(l => l.trim()).map(line => {
        const [trade, description, quantity, unit_of_measure] = line.split(',').map(s => s.trim())
        return { trade, description, quantity: parseFloat(quantity), unit_of_measure }
      })

      const result = await onSubmit(projectId, { beneficiaries, master_boq })
      alert(`Success: ${result.message}`)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Invalid format or server error')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl">
        <h3 className="text-lg font-bold mb-2">Enterprise Bulk Import</h3>
        <p className="text-xs text-slate-500 mb-4">Paste from Excel. The Master BoQ will be automatically applied to ALL beneficiaries.</p>
        
        {error && <div className="mb-3 text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-bold text-slate-700">1. Beneficiaries (Name, Code)</label>
            <textarea className="w-full border p-2 rounded mt-1 text-xs font-mono h-40" value={bensText} onChange={e => setBensText(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">2. Master BoQ (Trade, Desc, Qty, Unit)</label>
            <textarea className="w-full border p-2 rounded mt-1 text-xs font-mono h-40" value={boqText} onChange={e => setBoqText(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border p-2 rounded text-sm font-medium">Cancel</button>
          <button onClick={handleImport} disabled={loading} className="flex-1 bg-emerald-600 text-white p-2 rounded text-sm font-medium disabled:opacity-50">
            {loading ? 'Importing...' : 'Run Bulk Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ... (AddUnitModal and AddBoqModal remain the same as previous)
function AddUnitModal({ projectId, onClose, onSubmit }: any) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [type, setType] = useState('LATRINE')
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Add Single Beneficiary</h3>
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
        <h3 className="text-lg font-bold mb-4">Add Extra BoQ Item</h3>
        <input className="w-full border p-2 rounded mb-3 text-sm" placeholder="Trade (e.g. Excavation)" value={trade} onChange={e => setTrade(e.target.value)} />
        <input className="w-full border p-2 rounded mb-3 text-sm" placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} />
        <div className="flex gap-3 mb-4">
          <input type="number" className="flex-1 border p-2 rounded text-sm" placeholder="Quantity" value={qty} onChange={e => setQty(e.target.value)} />
          <input className="flex-1 border p-2 rounded text-sm" placeholder="Unit (e.g. m3)" value={unit} onChange={e => setUnit(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border p-2 rounded text-sm">Cancel</button>
          <button onClick={async () => { await onSubmit(projectId, unitId, { trade, description: desc, quantity: parseFloat(qty), unit_of_measure: unit }); onClose() }} className="flex-1 bg-emerald-600 text-white p-2 rounded text-sm">Save Item</button>
        </div>
      </div>
    </div>
  )
}