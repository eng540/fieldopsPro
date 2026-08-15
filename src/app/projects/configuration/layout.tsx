'use client'

import { Suspense, type ReactNode } from 'react'

export default function ProjectConfigurationLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center" dir="rtl">
          <div className="text-sm text-muted-foreground">جاري تحميل إعدادات المشروع...</div>
        </main>
      }
    >
      {children}
    </Suspense>
  )
}
