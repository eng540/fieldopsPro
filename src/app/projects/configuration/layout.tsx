'use client'

import { Suspense, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { ExcelImportPanel } from '@/components/projects/ExcelImportPanel'

export default function ProjectConfigurationLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="min-h-screen flex items-center justify-center" dir="rtl"><div className="text-sm text-muted-foreground">جاري تحميل إعدادات المشروع...</div></main>}><ConfigurationShell>{children}</ConfigurationShell></Suspense>
}

function ConfigurationShell({ children }: { children: ReactNode }) {
  const params = useSearchParams()
  const projectId = params.get('projectId') || ''
  if (!projectId) return <>{children}</>
  return <div className="space-y-4"><div className="px-4 md:px-6 pt-4"><ExcelImportPanel projectId={projectId} onImported={() => window.location.reload()} /></div>{children}</div>
}
