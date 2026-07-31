import { create } from 'zustand'
import { apiGet, apiPost } from '@/lib/client'
import { db, type LocalProject, type LocalUnit } from '@/lib/db'

interface ProjectState {
  projects: LocalProject[]
  units: LocalUnit[]
  selectedProjectId: number | null
  isLoading: boolean
  error: string | null
  loadProjects: () => Promise<void>
  loadUnits: (projectId: number) => Promise<void>
  selectProject: (id: number | null) => void
  createProject: (data: { name: string; code: string; description?: string }) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  units: [],
  selectedProjectId: null,
  isLoading: false,
  error: null,

  loadProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiGet('/projects?page_size=100')
      const projects: LocalProject[] = data.items.map((p: any) => ({
        id:            p.id,
        orgId:         p.org_id,
        name:          p.name,
        code:          p.code,
        status:        p.status ?? 'PLANNING',
        totalUnits:    p.total_units,
        completionPct: p.completion_pct,
        isActive:      p.is_active ?? true,
        lastSyncedAt:  new Date().toISOString(),
      }))
      await db.projects.bulkPut(projects)
      set({ projects, isLoading: false })
    } catch {
      // Offline fallback
      const local = await db.projects.toArray()
      set({ projects: local, isLoading: false })
    }
  },

  loadUnits: async (projectId: number) => {
    set({ isLoading: true })
    try {
      const data = await apiGet(`/projects/${projectId}/units`)
      const units: LocalUnit[] = data.items.map((u: any) => ({
        id:            u.id,
        projectId:     u.project_id,
        unitType:      u.unit_type ?? 'UNIT',
        unitCode:      u.code ?? String(u.id),
        status:        u.status ?? 'PENDING',
        lastActivity:  u.updated_at ?? new Date().toISOString(),
        lastSyncedAt:  new Date().toISOString(),
      }))
      await db.units.bulkPut(units)
      set({ units, isLoading: false })
    } catch {
      const local = await db.units.where('projectId').equals(projectId).toArray()
      set({ units: local, isLoading: false })
    }
  },

  selectProject: (id) => set({ selectedProjectId: id }),

  createProject: async (data) => {
    await apiPost('/projects', data)
    await get().loadProjects()
  },
}))
