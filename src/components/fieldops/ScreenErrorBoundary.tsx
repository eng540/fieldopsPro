'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
  screenName: string
}

interface State {
  hasError: boolean
  message: string
}

export class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unknown UI error',
    }
  }

  componentDidCatch(error: unknown) {
    // Deliberately log only the UI error message; never log auth state/tokens.
    console.error(`[FieldOps UI] ${this.props.screenName} failed`, error instanceof Error ? error.message : error)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center" dir="rtl">
        <h2 className="text-base font-bold text-amber-900">تعذر تحميل هذه الشاشة</h2>
        <p className="mt-2 text-sm text-amber-800">حدث خطأ في مكون الواجهة، لكن الجلسة وبقية النظام ما زالا يعملان.</p>
        <button
          type="button"
          onClick={() => this.setState({ hasError: false, message: '' })}
          className="mt-4 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white"
        >
          إعادة محاولة الشاشة
        </button>
        {this.state.message ? <p className="mt-3 text-[11px] text-amber-700/70">تم تسجيل الخطأ للتشخيص.</p> : null}
      </section>
    )
  }
}
