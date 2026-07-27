import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/client'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { useSyncStore } from '@/stores/syncStore'
import {
  PlusCircle, AlertTriangle, CheckCircle2,
  Clock, Loader2, Camera, MapPin,
} from 'lucide-react'

interface Remark {
  id: string
  unit_id: number
  severity: string
  status: string
  custom_issue: string | null
  created_at: string
  resolved_at: string | null
  gps_tag: { lat: number; lng: number } | null
}

interface RemarkTemplate {
  id: number
  category: string
  issue: string
  severity: string
  auto_hold: boolean
}

const SEV_COLORS: Record<string, string> = {
  CRITICAL:    'bg-red-100 text-red-800 border-red-200',
  MAJOR:       'bg-orange-100 text-orange-800 border-orange-200',
  MINOR:       'bg-amber-100 text-amber-800 border-amber-200',
  OBSERVATION: 'bg-blue-100 text-blue-800 border-blue-200',
}

const STATUS_ICON: Record<string, JSX.Element> = {
  OPEN:      <AlertTriangle size={13} />,
  IN_REVIEW: <Clock size={13} />,
  RESOLVED:  <CheckCircle2 size={13} />,
  CLOSED:    <CheckCircle2 size={13} />,
}

export function QualityScreen() {
  const [remarks, setRemarks] = useState<Remark[]>([])
  const [templates, setTemplates] = useState<RemarkTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [filterSev, setFilterSev] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const { isOnline } = useSyncStore()

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterSev) params.set('severity', filterSev)
      if (filterStatus) params.set('status', filterStatus)
      const [rResp, tResp] = await Promise.all([
        apiClient.get(`/quality/remarks?${params}`),
        apiClient.get('/quality/templates'),
      ])
      if (rResp.ok) setRemarks((await rResp.json()).items)
      if (tResp.ok) setTemplates(await tResp.json())
    } catch { /* offline */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [filterSev, filterStatus])

  const resolveRemark = async (id: string) => {
    const resp = await apiClient.patch(`/quality/remarks/${id}`, { status: 'RESOLVED' })
    if (resp.ok) load()
  }

  const stats = {
    open: remarks.filter(r => r.status === 'OPEN').length,
    critical: remarks.filter(r => r.severity === 'CRITICAL' && r.status === 'OPEN').length,
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Quality Control</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {stats.open} open · {stats.critical} critical
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium"
        >
          <PlusCircle size={16} /> New Remark
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <select value={filterSev} onChange={e => setFilterSev(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All Severities</option>
          {['CRITICAL','MAJOR','MINOR','OBSERVATION'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All Statuses</option>
          {['OPEN','IN_REVIEW','RESOLVED','CLOSED'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 text-slate-500">
          <Loader2 className="animate-spin mr-2" size={20} />Loading…
        </div>
      ) : remarks.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <CheckCircle2 size={40} className="mx-auto mb-3 opacity-30" />
          <p>No remarks found. Quality looks good!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {remarks.map(r => (
            <div key={r.id}
              className={`bg-white border rounded-xl p-4 ${SEV_COLORS[r.severity]}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${SEV_COLORS[r.severity]}`}>
                      {r.severity}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-600">
                      {STATUS_ICON[r.status]} {r.status}
                    </span>
                    {r.gps_tag && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <MapPin size={11} />GPS
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-800 font-medium">
                    {r.custom_issue || 'Template remark'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Unit #{r.unit_id} · {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
                {r.status === 'OPEN' && (
                  <button
                    onClick={() => resolveRemark(r.id)}
                    className="shrink-0 text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateRemarkModal
          templates={templates}
          isOnline={isOnline}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

function CreateRemarkModal({
  templates, isOnline, onClose, onCreated,
}: {
  templates: RemarkTemplate[]
  isOnline: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [unitId, setUnitId] = useState('1')
  const [severity, setSeverity] = useState('MINOR')
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [customIssue, setCustomIssue] = useState('')
  const [gpsCapturing, setGpsCapturing] = useState(false)
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const captureGPS = () => {
    setGpsCapturing(true)
    navigator.geolocation?.getCurrentPosition(
      pos => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsCapturing(false)
      },
      () => setGpsCapturing(false),
    )
  }

  const handleSubmit = async () => {
    if (!customIssue.trim() && !templateId) return setError('Provide issue description or template.')
    setSaving(true); setError(null)

    const remarkId = uuidv4()
    const payload = {
      id: remarkId,
      unit_id: parseInt(unitId),
      severity,
      template_id: templateId || null,
      custom_issue: customIssue.trim() || null,
      gps_tag: gps ? { lat: gps.lat, lng: gps.lng } : null,
    }

    if (isOnline) {
      const resp = await apiClient.post('/quality/remarks', payload)
      if (resp.ok) { onCreated(); return }
      const d = await resp.json()
      setError(d.detail || 'Failed')
    } else {
      // Queue as sync operation
      await db.syncQueue.put({
        id: uuidv4(),
        operation_type: 'CREATE',
        entity_type: 'REMARK',
        entity_id: remarkId,
        payload,
        device_timestamp: new Date().toISOString(),
        retry_count: 0,
        created_at: new Date().toISOString(),
      })
      onCreated()
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">New QC Remark</h3>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Unit ID</label>
            <input type="number" value={unitId} onChange={e => setUnitId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Severity</label>
            <select value={severity} onChange={e => setSeverity(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              {['CRITICAL','MAJOR','MINOR','OBSERVATION'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {(severity === 'CRITICAL' || severity === 'MAJOR') && (
              <p className="text-xs text-red-600 mt-1">⚠ Auto-Governance HOLD will be triggered</p>
            )}
          </div>
          {templates.length > 0 && (
            <div>
              <label className="text-xs font-medium text-slate-600">Template (optional)</label>
              <select value={templateId ?? ''} onChange={e => setTemplateId(e.target.value ? +e.target.value : null)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="">— Custom issue —</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>[{t.category}] {t.issue}</option>
                ))}
              </select>
            </div>
          )}
          {!templateId && (
            <div>
              <label className="text-xs font-medium text-slate-600">Issue Description</label>
              <textarea value={customIssue} onChange={e => setCustomIssue(e.target.value)}
                rows={3} placeholder="Describe the defect…"
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          <button onClick={captureGPS} disabled={gpsCapturing}
            className="flex items-center gap-2 text-xs text-indigo-600 hover:text-indigo-800">
            <MapPin size={13} />
            {gps ? `GPS: ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : gpsCapturing ? 'Capturing…' : 'Capture GPS location'}
          </button>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-700 rounded-lg py-2 text-sm">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving…' : isOnline ? 'Submit' : 'Save Offline'}
          </button>
        </div>
      </div>
    </div>
  )
}
