'use client'

import { ExecutionProgressScreen } from './ExecutionProgressScreen'

interface Props {
  project: any | null
  orgId: string
  onRefresh: () => void
}

export function SpeedEntryGrid({ project, orgId, onRefresh }: Props) {
  return <ExecutionProgressScreen project={project} orgId={orgId} onRefresh={onRefresh} />
}
