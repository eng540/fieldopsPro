import { useEffect, useState } from 'react'
import { useGovernanceStore } from '@/stores/governanceStore'
import {
  ShieldCheck, ShieldAlert, ShieldX, CircleDollarSign,
  Loader2, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle,
} from 'lucide-react'

const DECISION_STYLES: Record<string, { bg: string; text: string; icon: JSX.Element }> = {
  APPROVE:           { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800', icon: <ShieldCheck size={15} /> },
  APPROVE_WITH_NOTE: { bg: 'bg-blue-50 border-blue-200',       text: 'text-blue-800',    icon: <ShieldCheck size={15} /> },
  HOLD:              { bg: 'bg-amber-50 border-amber-200',      text: 'text-amber-800',   icon: <ShieldAlert size={15} /> },
  STOP:              { bg: 'bg-red-50 border-red-200',          text: 'text-red-800',     icon: <ShieldX size={15} /> },
  REWORK:            { bg: 'bg-orange-50 border-orange-200',    text: 'text-orange-800',  icon: <AlertTriangle size={15} /> },
}

export function GovernanceScreen() {
  const { decisions, isLoading, error, loadDecisions, overriding } = useGovernanceStore()
  const [filterDecision, setFilterDecision] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [showOverride, setShowOverride] = useState<number | null>(null)

  useEffect(() => { loadDecisions() }, [])

  const filtered = filterDecision
    ? decisions.filter(d => d.decision === filterDecision)
    : decisions

  const stats = {
    hold:    decisions.filter(d => d.decision === 'HOLD'    && !d.is_overridden).length,
    stop:    decisions.filter(d => d.decision === 'STOP'    && !d.is_overridden).length,
    approve: decisions.filter(d => d.decision.startsWith('APPROVE')).length,
    total:   decisions.length,
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Governance Engine</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Automated payment decisions · {stats.total} total decisions
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'HOLD',    value: stats.hold,    color: 'amber',   icon: <ShieldAlert size={18} /> },
          { label: 'STOP',    value: stats.stop,    color: 'red',     icon: <ShieldX size={18} /> },
          { label: 'APPROVE', value: stats.approve, color: 'emerald', icon: <ShieldCheck size={18} /> },
        ].map(({ label, value, color, icon }) => (
          <button
            key={label}
            onClick={() => setFilterDecision(f => f === label ? '' : label)}
            className={`bg-white border rounded-xl p-4 text-left transition-all hover:shadow-sm ${
              filterDecision === label ? `border-${color}-400 bg-${color}-50` : 'border-slate-200'
            }`}
          >
            <div className={`text-${color}-600 mb-2`}>{icon}</div>
            <div className={`text-2xl font-bold text-${color}-700`}>{value}</div>
            <div className="text-xs text-slate-500 font-medium mt-0.5">{label}</div>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-slate-500">
          <Loader2 className="animate-spin mr-2" size={20} />Loading decisions…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <ShieldCheck size={40} className="mx-auto mb-3 opacity-30" />
          <p>No decisions found. Run Evaluate on a unit to generate one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(d => {
            const style = DECISION_STYLES[d.decision] ?? DECISION_STYLES['HOLD']
            const isExpanded = expandedId === d.id
            return (
              <div key={d.id} className={`bg-white border rounded-xl overflow-hidden ${style.bg}`}>
                {/* Header row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : d.id)}
                  className="w-full px-4 py-4 flex items-start gap-3 text-left"
                >
                  <span className={style.text}>{style.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${style.bg} ${style.text}`}>
                        {d.decision.replace('_', ' ')}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <CircleDollarSign size={11} /> {d.payment_pct}% payment
                      </span>
                      {d.is_overridden && (
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded border border-purple-200">
                          Overridden
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-700 mt-1 truncate">{d.reason}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Unit #{d.unit_id}
                      {d.boq_item_id ? ` · BOQ #${d.boq_item_id}` : ''}
                      {d.matched_rule ? ` · Rule: ${d.matched_rule}` : ''}
                    </p>
                  </div>
                  {isExpanded ? <ChevronUp size={16} className="text-slate-400 shrink-0 mt-1" /> : <ChevronDown size={16} className="text-slate-400 shrink-0 mt-1" />}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 py-4 space-y-3">
                    {/* Explainability */}
                    <div className="bg-white rounded-lg border border-slate-100 p-3">
                      <p className="text-xs font-semibold text-slate-600 mb-2">Explainability</p>
                      <pre className="text-xs text-slate-500 whitespace-pre-wrap">
                        {JSON.stringify(d.explainability, null, 2)}
                      </pre>
                    </div>

                    {/* Override button (non-overridden HOLD/STOP only) */}
                    {!d.is_overridden && ['HOLD', 'STOP', 'REWORK'].includes(d.decision) && (
                      <div>
                        {showOverride === d.id ? (
                          <OverrideForm
                            decisionId={d.id}
                            currentDecision={d.decision}
                            onClose={() => setShowOverride(null)}
                          />
                        ) : (
                          <button
                            onClick={() => setShowOverride(d.id)}
                            className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700"
                          >
                            Request Override
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OverrideForm({
  decisionId, currentDecision, onClose,
}: { decisionId: number; currentDecision: string; onClose: () => void }) {
  const { requestOverride, overriding, error } = useGovernanceStore()
  const [justification, setJustification] = useState('')
  const [newDecision, setNewDecision] = useState('')
  const [newPct, setNewPct] = useState<string>('')

  const canSubmit = justification.trim().length >= 20

  const handleSubmit = async () => {
    if (!canSubmit) return
    await requestOverride(
      decisionId,
      justification.trim(),
      newPct ? parseFloat(newPct) : undefined,
      newDecision || undefined,
    )
    if (!error) onClose()
  }

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-purple-800">Override Request — PM/OrgAdmin only</p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div>
        <label className="text-xs text-slate-600">New Decision (optional)</label>
        <select value={newDecision} onChange={e => setNewDecision(e.target.value)}
          className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">— Keep as {currentDecision} but override —</option>
          <option value="APPROVE">APPROVE</option>
          <option value="APPROVE_WITH_NOTE">APPROVE WITH NOTE</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-slate-600">New Payment % (optional)</label>
        <input type="number" min={0} max={100} value={newPct}
          onChange={e => setNewPct(e.target.value)}
          placeholder="e.g. 75"
          className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
      </div>

      <div>
        <label className="text-xs text-slate-600">
          Justification <span className="text-red-500">*</span>
          <span className={`ml-2 ${justification.length < 20 ? 'text-red-400' : 'text-emerald-600'}`}>
            ({justification.length}/20 min)
          </span>
        </label>
        <textarea value={justification} onChange={e => setJustification(e.target.value)}
          rows={3} placeholder="Provide detailed justification (min 20 characters)…"
          className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="flex gap-2">
        <button onClick={onClose} className="border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs">Cancel</button>
        <button onClick={handleSubmit} disabled={!canSubmit || overriding === decisionId}
          className="bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50">
          {overriding === decisionId ? 'Submitting…' : 'Submit Override'}
        </button>
      </div>
    </div>
  )
}
