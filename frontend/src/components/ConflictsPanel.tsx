import { useSyncStore } from '@/stores/syncStore'
import { AlertTriangle, ServerCrash, Smartphone, X } from 'lucide-react'

export function ConflictsPanel() {
  const { conflicts, resolveConflict, dismissConflict } = useSyncStore()
  if (conflicts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-white border border-red-200 rounded-2xl shadow-xl z-50">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-red-100 bg-red-50 rounded-t-2xl">
        <AlertTriangle size={16} className="text-red-600" />
        <span className="text-sm font-semibold text-red-800">{conflicts.length} Sync Conflict{conflicts.length > 1 ? 's' : ''}</span>
      </div>
      <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
        {conflicts.map(c => (
          <div key={c.operationUuid} className="p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                {c.conflictType.replace('_', ' ')}
              </span>
              <button onClick={() => dismissConflict(c.operationUuid)} className="text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-slate-600 mb-3">{c.hint}</p>
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <div className="bg-green-50 rounded p-2">
                <div className="flex items-center gap-1 text-green-700 font-medium mb-1">
                  <ServerCrash size={11} /> Server
                </div>
                <pre className="text-slate-600 whitespace-pre-wrap break-all">{JSON.stringify(c.serverValue, null, 2)}</pre>
              </div>
              <div className="bg-blue-50 rounded p-2">
                <div className="flex items-center gap-1 text-blue-700 font-medium mb-1">
                  <Smartphone size={11} /> Device
                </div>
                <pre className="text-slate-600 whitespace-pre-wrap break-all">{JSON.stringify(c.clientValue, null, 2)}</pre>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => resolveConflict(c.operationUuid, 'SERVER')}
                className="flex-1 text-xs bg-green-600 text-white py-1.5 rounded-lg hover:bg-green-700">
                Keep Server
              </button>
              <button onClick={() => resolveConflict(c.operationUuid, 'CLIENT')}
                className="flex-1 text-xs bg-blue-600 text-white py-1.5 rounded-lg hover:bg-blue-700">
                Retry Device
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
