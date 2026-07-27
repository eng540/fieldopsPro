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
  createProject: (data: { name: string; code: string; description?: string; location?: string }) => Promise<void>
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
      // Try server first
      const resp = await apiClient.get('/projects?page_size=100')
      if (resp.ok) {
        const data = await resp.json()
        const projects: LocalProject[] = data.items.map((p: any) => ({
          id: p.id,
          org_id: p.org_id,
          name: p.name,
          code: p.code,
          status: p.status,
          completion_pct: p.completion_pct,
          total_units: p.total_units,
          synced_at: new Date().toISOString(),
        }))
        await db.projects.bulkPut(projects)
        set({ projects, isLoading: false })
        return
      }
    } catch {
      // Offline — fall through to IndexedDB
    }
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
          id: u.id,
          org_id: u.org_id,
          project_id: u.project_id,
          name: u.name,
          code: u.code,
          status: u.status,
          completion_pct: u.completion_pct,
          synced_at: new Date().toISOString(),
        }))
        await db.units.bulkPut(units)
        set({ units, isLoading: false })
        return
      }
    } catch { /* offline */ }
    const local = await db.units.where('project_id').equals(projectId).toArray()
    set({ units: local, isLoading: false })
  },

  selectProject: (projectId) => set({ selectedProjectId: projectId, selectedUnitId: null }),
  selectUnit: (unitId) => set({ selectedUnitId: unitId }),

  createProject: async (data) => {
    const resp = await apiClient.post('/projects', data)
    if (!resp.ok) {
      const err = await resp.json()
      throw new Error(err.detail || 'Failed to create project')
    }
    await get().loadProjects()
  },
}))
