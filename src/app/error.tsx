'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log only non-sensitive diagnostics. Never serialize auth state or tokens.
    console.error('[FieldOps UI Error]', {
      name: error?.name,
      message: error?.message,
      digest: error?.digest,
    })
  }, [error])

  return (
    <main dir="rtl" className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <section className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6 shadow-sm text-center">
        <div className="mx-auto mb-4 h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold">!</div>
        <h1 className="text-lg font-bold text-gray-900">تعذر تحميل الواجهة</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          حدث خطأ غير متوقع في واجهة النظام. لن تبقى الشاشة في حالة تحميل لا نهائية.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            إعادة المحاولة
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            تحديث التطبيق
          </button>
        </div>
        {error?.digest ? (
          <p className="mt-4 text-[11px] text-gray-400">مرجع الخطأ: {error.digest}</p>
        ) : null}
      </section>
    </main>
  )
}
