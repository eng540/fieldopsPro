import { create } from 'zustand'
import { apiClient } from '@/lib/client'
import { db, type LocalDecision } from '@/lib/db'

interface GovernanceDecision {
  id: number
  unit_id: number
  boq_item_id: number | null
  remark_id: string | null
  decision: string
  payment_pct: number
  flag: string | null
  matched_rule: string | null
  reason: string
  explainability: Record<string, unknown>
  is_overridden: boolean
  created_at: string
}

interface GovernanceState {
  decisions: GovernanceDecision[]
  isLoading: boolean
  error: string | null
  overriding: number | null
  loadDecisions: (unitId?: number) => Promise<void>
  requestOverride: (decisionId: number, justification: string, newPaymentPct?: number, newDecision?: string) => Promise<void>
  evaluateUnit: (unitId: number, boqItemId?: number) => Promise<GovernanceDecision | null>
}

export const useGovernanceStore = create<GovernanceState>((set, get) => ({
  decisions: [],
  isLoading: false,
  error: null,
  overriding: null,

  loadDecisions: async (unitId?: number) => {
    set({ isLoading: true, error: null })
    try {
      const url = unitId ? `/governance/decisions?unit_id=${unitId}` : '/governance/decisions'
      const resp = await apiClient.get(url)
      if (resp.ok) {
        const data = await resp.json()
        set({ decisions: data.items, isLoading: false })
        // Cache in IndexedDB for offline access
        await db.decisions.bulkPut(
          data.items.map((d: GovernanceDecision): LocalDecision => ({
            id:            d.id,
            unitId:        d.unit_id,
            boqItemId:     d.boq_item_id ?? 0,
            decision:      d.decision as LocalDecision['decision'],
            paymentPct:    d.payment_pct,
            flag:          d.flag ?? '',
            matchedRule:   d.matched_rule ?? '',
            reason:        d.reason,
            policyVersion: (d.explainability?.policy_version as number) ?? 1,
            createdAt:     d.created_at,
          }))
        )
        return
      }
    } catch { /* offline */ }
    // Offline fallback
    const local = await db.decisions.toArray()
    const mapped: GovernanceDecision[] = local.map(d => ({
      id:             d.id,
      unit_id:        d.unitId,
      boq_item_id:    d.boqItemId || null,
      remark_id:      null,
      decision:       d.decision,
      payment_pct:    d.paymentPct,
      flag:           d.flag,
      matched_rule:   d.matchedRule,
      reason:         d.reason,
      explainability: {},
      is_overridden:  !!d.override,
      created_at:     d.createdAt,
    }))
    set({ decisions: mapped, isLoading: false })
  },

  requestOverride: async (decisionId, justification, newPaymentPct, newDecision) => {
    set({ overriding: decisionId, error: null })
    try {
      const resp = await apiClient.post(`/governance/decisions/${decisionId}/override`, {
        justification,
        new_payment_pct: newPaymentPct ?? null,
        new_decision:    newDecision ?? null,
      })
      if (resp.ok) {
        await get().loadDecisions()
        set({ overriding: null })
        return
      }
      const data = await resp.json()
      set({ error: data.detail || 'Override failed', overriding: null })
    } catch (e: any) {
      set({ error: e.message, overriding: null })
    }
  },

  evaluateUnit: async (unitId, boqItemId) => {
    try {
      const resp = await apiClient.post('/governance/evaluate', {
        unit_id:     unitId,
        boq_item_id: boqItemId ?? null,
      })
      if (resp.ok) {
        const d: GovernanceDecision = await resp.json()
        set(state => ({ decisions: [d, ...state.decisions] }))
        return d
      }
    } catch { /* offline */ }
    return null
  },
}))
