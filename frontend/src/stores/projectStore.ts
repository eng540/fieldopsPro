import { create } from 'zustand'
import { apiClient } from '@/lib/client'
import { db, type LocalProject, type LocalUnit } from '@/lib/db'

interface ProjectState {
  projects: LocalProject[]
  units: LocalUnit[]
  selectedProjectId: number | null
  selectedUnitId: number | null
  isLoading: boolean
  error: string | null
  loadProjects: () => Promise<void>
  loadUnits: (projectId: number) => Promise<void>
  selectProject: (projectId: number | null) => void
  selectUnit: (unitId: number | null) => void
  createProject: (data: { name: string; code: string }) => Promise<void>
  createUnit: (projectId: number, data: { name: string; code: string; unit_type: string }) => Promise<void>
  createBoqItem: (projectId: number, unitId: number, data: { trade: string; description: string; quantity: number; unit_of_measure: string }) => Promise<void>
  // الدالة الجديدة للاستيراد الشامل
  bulkImportUnits: (projectId: number, payload: any) => Promise<any>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  units: [],
  selectedProjectId: null,
  selectedUnitId: null,
  isLoading: false,
  error: null,

  loadProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const resp = await apiClient.get('/projects?page_size=100')
      if (resp.ok) {
        const data = await resp.json()
        const projects: LocalProject[] = data.items.map((p: any) => ({
          id: p.id, orgId: p.org_id, name: p.name, code: p.code,
          status: p.status, completionPct: p.completion_pct,
          totalUnits: p.total_units, syncedAt: new Date().toISOString(), isActive: true
        }))
        await db.projects.bulkPut(projects)
        set({ projects, isLoading: false })
        return
      }
    } catch { /* offline */ }
    const local = await db.projects.toArray()
    set({ projects: local, isLoading: false })
  },

  loadUnits: async (projectId: number) => {
    set({ isLoading: true })
    try {
      const resp = await apiClient.get(`/projects/${projectId}/units`)
      if (resp.ok) {
        const data = await resp.json()
        const units: LocalUnit[] = data.items.map((u: any) => ({
          id: u.id, projectId: u.project_id, unitType: u.unit_type,
          unitCode: u.code, status: u.status,
          lastActivity: u.updated_at, lastSyncedAt: new Date().toISOString()
        }))
        await db.units.bulkPut(units)
        set({ units, isLoading: false })
        return
      }
    } catch { /* offline */ }
    const local = await db.units.where('projectId').equals(projectId).toArray()
    set({ units: local, isLoading: false })
  },

  selectProject: (projectId) => {
    set({ selectedProjectId: projectId, selectedUnitId: null })
    if (projectId) get().loadUnits(projectId)
  },
  
  selectUnit: (unitId) => set({ selectedUnitId: unitId }),

  createProject: async (data) => {
    const resp = await apiClient.post('/projects', data)
    if (!resp.ok) throw new Error('Failed to create project')
    await get().loadProjects()
  },

  createUnit: async (projectId, data) => {
    const resp = await apiClient.post(`/projects/${projectId}/units`, data)
    if (!resp.ok) throw new Error('Failed to add beneficiary')
    await get().loadUnits(projectId)
  },

  createBoqItem: async (projectId, unitId, data) => {
    const resp = await apiClient.post(`/projects/${projectId}/units/${unitId}/boq`, data)
    if (!resp.ok) throw new Error('Failed to add BoQ Item')
  },

  bulkImportUnits: async (projectId, payload) => {
    const resp = await apiClient.post(`/projects/${projectId}/bulk-import`, payload)
    if (!resp.ok) {
      const err = await resp.json()
      throw new Error(err.detail || 'Bulk import failed')
    }
    // تحديث البيانات بعد الاستيراد الناجح
    await get().loadProjects()
    await get().loadUnits(projectId)
    return await resp.json()
  }
}))