import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/client'
import { useSyncStore } from '@/stores/syncStore'
import { db } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import {
  PlusCircle, ChevronRight, Loader2, AlertCircle,
  CheckCircle2, Clock, XCircle, ArrowUpCircle
} from 'lucide-react'

interface WorkOrder {
  id: number
  title: string
  status: string
  completion_pct: number
  project_id: number
  rework_flag: boolean
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT:            'bg-slate-100 text-slate-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  APPROVED:         'bg-blue-100 text-blue-800',
  IN_PROGRESS:      'bg-indigo-100 text-indigo-800',
  COMPLETED:        'bg-emerald-100 text-emerald-800',
  CANCELLED:        'bg-red-100 text-red-700',
}

const STATUS_ICON: Record<string, JSX.Element> = {
  DRAFT:            <Clock size={13} />,
  PENDING_APPROVAL: <Clock size={13} />,
  APPROVED:         <CheckCircle2 size={13} />,
  IN_PROGRESS:      <ArrowUpCircle size={13} />,
  COMPLETED:        <CheckCircle2 size={13} />,
  CANCELLED:        <XCircle size={13} />,
}

export function WorkOrdersScreen() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null)
  const { isOnline } = useSyncStore()

  const loadWorkOrders = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await apiClient.get('/execution/work-orders?page_size=50')
      if (resp.ok) {
        const data = await resp.json()
        setWorkOrders(data.items)
      } else {
        throw new Error('Server error')
      }
    } catch {
      setError('Offline — showing local data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadWorkOrders() }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-500">
      <Loader2 className="animate-spin mr-2" size={20} /> Loading work orders…
    </div>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Work Orders</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium"
        >
          <PlusCircle size={16} /> New Work Order
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {workOrders.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <p className="text-lg">No work orders yet.</p>
          <p className="text-sm mt-1">Create your first work order to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workOrders.map(wo => (
            <button
              key={wo.id}
              onClick={() => setSelectedWO(wo)}
              className="w-full bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4 hover:border-indigo-300 hover:shadow-sm transition-all text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-slate-800 truncate">{wo.title}</span>
                  {wo.rework_flag && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">Rework</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[wo.status] || 'bg-slate-100 text-slate-700'}`}>
                    {STATUS_ICON[wo.status]} {wo.status.replace('_', ' ')}
                  </span>
                  <span>Project #{wo.project_id}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-800">{wo.completion_pct.toFixed(0)}%</div>
                  <div className="w-20 h-2 bg-slate-100 rounded-full mt-1">
                    <div
                      className="h-2 bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${wo.completion_pct}%` }}
                    />
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </div>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateWorkOrderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadWorkOrders() }}
        />
      )}

      {selectedWO && (
        <WorkOrderDetailModal
          workOrder={selectedWO}
          onClose={() => setSelectedWO(null)}
          onUpdated={() => { setSelectedWO(null); loadWorkOrders() }}
          isOnline={isOnline}
        />
      )}
    </div>
  )
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateWorkOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!title.trim()) return setError('Title is required')
    setSaving(true)
    setError(null)
    try {
      const resp = await apiClient.post('/execution/work-orders', {
        title: title.trim(),
        project_id: parseInt(projectId),
      })
      if (resp.ok) { onCreated() }
      else {
        const data = await resp.json()
        setError(data.detail || 'Failed to create')
      }
    } catch {
      setError('Network error — check connection')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">New Work Order</h3>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-slate-700">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Install electrical conduit — Block A Floor 3"
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Project ID</label>
            <input
              type="number"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-700 rounded-lg py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail / Progress Modal ─────────────────────────────────────────────────

function WorkOrderDetailModal({
  workOrder, onClose, onUpdated, isOnline
}: {
  workOrder: WorkOrder
  onClose: () => void
  onUpdated: () => void
  isOnline: boolean
}) {
  const [newPct, setNewPct] = useState(workOrder.completion_pct)
  const [newStatus, setNewStatus] = useState(workOrder.status)
  const [reworkFlag, setReworkFlag] = useState(false)
  const [reworkReason, setReworkReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    DRAFT:            ['PENDING_APPROVAL', 'CANCELLED'],
    PENDING_APPROVAL: ['APPROVED', 'CANCELLED'],
    APPROVED:         ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS:      ['COMPLETED', 'CANCELLED'],
    COMPLETED:        [],
    CANCELLED:        [],
  }

  const handleUpdate = async () => {
    setSaving(true)
    setError(null)
    const payload: Record<string, unknown> = { completion_pct: newPct, status: newStatus }
    if (reworkFlag) { payload.rework_flag = true; payload.rework_reason = reworkReason }

    if (isOnline) {
      try {
        const resp = await apiClient.patch(`/execution/work-orders/${workOrder.id}`, payload)
        if (resp.ok) { onUpdated(); return }
        const data = await resp.json()
        setError(data.detail || 'Update failed')
      } catch {
        setError('Network error — saving offline')
        await queueOffline(payload)
        onUpdated()
      }
    } else {
      await queueOffline(payload)
      onUpdated()
    }
    setSaving(false)
  }

  const queueOffline = async (payload: Record<string, unknown>) => {
    await db.syncQueue.put({
      id: uuidv4(),
      operation_type: 'UPDATE',
      entity_type: 'WORK_ORDER',
      entity_id: workOrder.id,
      payload,
      device_timestamp: new Date().toISOString(),
      retry_count: 0,
      created_at: new Date().toISOString(),
    })
  }

  const isDecrease = newPct < workOrder.completion_pct

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-1">{workOrder.title}</h3>
        <p className="text-sm text-slate-500 mb-5">Work Order #{workOrder.id}</p>

        {error && <div className="mb-4 text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm">{error}</div>}

        <div className="space-y-4">
          {/* Progress slider */}
          <div>
            <div className="flex justify-between text-sm font-medium text-slate-700 mb-1">
              <span>Progress</span>
              <span className={isDecrease ? 'text-orange-600' : 'text-indigo-600'}>{newPct.toFixed(0)}%</span>
            </div>
            <input
              type="range" min={0} max={100} step={1}
              value={newPct}
              onChange={e => setNewPct(parseFloat(e.target.value))}
              className="w-full accent-indigo-600"
            />
            {isDecrease && (
              <p className="text-xs text-orange-600 mt-1">⚠ Progress decrease — rework justification required</p>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="text-sm font-medium text-slate-700">Status</label>
            <select
              value={newStatus}
              onChange={e => setNewStatus(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value={workOrder.status}>{workOrder.status.replace('_', ' ')} (current)</option>
              {(ALLOWED_TRANSITIONS[workOrder.status] || []).map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>

          {/* Rework fields */}
          {isDecrease && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="rework" checked={reworkFlag} onChange={e => setReworkFlag(e.target.checked)} />
                <label htmlFor="rework" className="text-sm font-medium text-orange-800">Authorize rework</label>
              </div>
              {reworkFlag && (
                <textarea
                  value={reworkReason}
                  onChange={e => setReworkReason(e.target.value)}
                  placeholder="Justification (min 20 characters)…"
                  rows={3}
                  className="w-full border border-orange-300 rounded-lg px-3 py-2 text-sm"
                />
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-700 rounded-lg py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={handleUpdate} disabled={saving} className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : isOnline ? 'Save' : 'Save Offline'}
          </button>
        </div>
      </div>
    </div>
  )
}
