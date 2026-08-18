'use client'

import React, { useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  Grid2X2,
  History,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
  Wrench,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type NavigationItem = {
  id: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  requireRole?: string[]
}

export type NavigationGroup = {
  id: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  items: NavigationItem[]
}

export const NAV_GROUPS: NavigationGroup[] = [
  {
    id: 'overview',
    label: 'نظرة عامة',
    description: 'حالة المشروع وما يحتاج إجراءً الآن',
    icon: LayoutDashboard,
    items: [
      { id: 'dashboard', label: 'ملخص المشروع', description: 'التقدم والتنبيهات والإجراء التالي', icon: LayoutDashboard },
      { id: 'operations', label: 'مركز المتابعة', description: 'مراقبة التنفيذ والإنذارات', icon: Activity, badge: 'تشغيل' },
    ],
  },
  {
    id: 'setup',
    label: 'إعداد المشروع',
    description: 'الوحدات والبنود والتعيينات والبيانات',
    icon: Building2,
    items: [
      { id: 'projects', label: 'إدارة المشاريع', description: 'اختيار المشروع وملخصه', icon: Building2 },
      { id: 'project-configuration', label: 'تهيئة المشروع', description: 'الوحدات والبنود والتعيينات والتحقق', icon: Settings },
      { id: 'bulk-import', label: 'استيراد البيانات', description: 'إضافة الوحدات والبنود عبر Excel', icon: FileSpreadsheet },
      { id: 'dictionary', label: 'قاموس البنود', description: 'تعريف البنود والتخصصات', icon: BookOpen },
    ],
  },
  {
    id: 'execution',
    label: 'التنفيذ الميداني',
    description: 'إدخال العمل ومتابعته من الموقع',
    icon: Wrench,
    items: [
      { id: 'speed-entry', label: 'الإدخال السريع', description: 'تحديث الإنجاز حسب الوحدة والبند', icon: Grid2X2, badge: 'يومي' },
      { id: 'work-orders', label: 'أوامر العمل', description: 'إنشاء ومتابعة المهام', icon: ListChecks },
      { id: 'diary', label: 'سجل الموقع', description: 'اليوميات والملاحظات الميدانية', icon: CalendarDays },
      { id: 'mobile', label: 'المركز الميداني', description: 'الاتصال والطابور والمزامنة', icon: Smartphone, badge: 'PWA' },
    ],
  },
  {
    id: 'quality',
    label: 'الجودة والأدلة',
    description: 'الملاحظات والصور وبوابة الجودة',
    icon: ClipboardCheck,
    items: [
      { id: 'quality', label: 'الجودة والأدلة', description: 'الملاحظات والصور والحل', icon: ClipboardCheck, badge: 'بوابة' },
    ],
  },
  {
    id: 'reports',
    label: 'التقارير والحوكمة',
    description: 'التقارير والقرارات والتدقيق والإدارة',
    icon: FileBarChart,
    items: [
      { id: 'reports', label: 'التقارير وIPC', description: 'التقارير والتصدير', icon: FileText },
      { id: 'governance', label: 'الحوكمة', description: 'القرارات والقيود', icon: ShieldCheck },
      { id: 'audit', label: 'سجل التدقيق', description: 'تتبع العمليات والتغييرات', icon: History },
      { id: 'users', label: 'المستخدمون', description: 'الأدوار والتعيينات', icon: Users, requireRole: ['SUPER_ADMIN', 'ORG_ADMIN'] },
      { id: 'settings', label: 'إعدادات النظام', description: 'إعدادات الحساب والمزامنة', icon: Settings },
    ],
  },
]

export function getAllowedNavigation(userRoles: string[] = []) {
  return NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => !item.requireRole || item.requireRole.some(role => userRoles.includes(role))),
  })).filter(group => group.items.length > 0)
}

function findActiveGroup(activeTab: string, groups: NavigationGroup[]) {
  return groups.find(group => group.items.some(item => item.id === activeTab))?.id || groups[0]?.id || 'overview'
}

export function SectionSidebar({
  activeTab,
  onNavigate,
  userRoles,
}: {
  activeTab: string
  onNavigate: (id: string) => void
  userRoles?: string[]
}) {
  const groups = useMemo(() => getAllowedNavigation(userRoles), [userRoles])
  const [openGroup, setOpenGroup] = useState(() => findActiveGroup(activeTab, groups))

  return (
    <aside className="hidden md:flex md:w-64 lg:w-72 shrink-0 flex-col border-l bg-white" aria-label="التنقل الرئيسي">
      <nav className="flex-1 overflow-y-auto px-3 py-4" dir="rtl">
        <div className="mb-4 rounded-xl bg-slate-50 px-3 py-3">
          <p className="text-[11px] font-bold text-slate-500">مساحة العمل</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">اختر قسمًا ثم مهمة واحدة. ستبقى هوية المشروع الحالية ظاهرة في الأعلى.</p>
        </div>
        <div className="space-y-2">
          {groups.map(group => {
            const GroupIcon = group.icon
            const isOpen = openGroup === group.id || group.items.some(item => item.id === activeTab)
            return (
              <div key={group.id} className="rounded-xl border border-slate-100 bg-white">
                <button
                  type="button"
                  onClick={() => setOpenGroup(current => current === group.id ? '' : group.id)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-right hover:bg-slate-50"
                  aria-expanded={isOpen}
                >
                  <GroupIcon className="h-4 w-4 text-emerald-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-800">{group.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-400">{group.description}</span>
                  </span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="space-y-1 border-t border-slate-100 p-2">
                    {group.items.map(item => {
                      const ItemIcon = item.icon
                      const selected = activeTab === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onNavigate(item.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right transition-colors ${selected ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'text-slate-600 hover:bg-slate-50'}`}
                          aria-current={selected ? 'page' : undefined}
                        >
                          <ItemIcon className={`h-4 w-4 shrink-0 ${selected ? 'text-emerald-600' : 'text-slate-400'}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold">{item.label}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-slate-400">{item.description}</span>
                          </span>
                          {item.badge && <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[9px]">{item.badge}</Badge>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}

export function MobileSectionNav({
  activeTab,
  onNavigate,
  userRoles,
}: {
  activeTab: string
  onNavigate: (id: string) => void
  userRoles?: string[]
}) {
  const groups = useMemo(() => getAllowedNavigation(userRoles), [userRoles])
  const shortcuts = [
    groups.flatMap(group => group.items).find(item => item.id === 'dashboard'),
    groups.flatMap(group => group.items).find(item => item.id === 'speed-entry'),
    groups.flatMap(group => group.items).find(item => item.id === 'quality'),
  ].filter(Boolean) as NavigationItem[]
  const moreActive = !shortcuts.some(item => item.id === activeTab)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreItems = groups.flatMap(group => group.items).filter(item => !shortcuts.some(shortcut => shortcut.id === item.id))

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-white/95 p-2 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur md:hidden" dir="rtl" aria-label="التنقل السريع">
      {moreOpen && <div className="absolute bottom-full right-2 left-2 mb-2 max-h-[65vh] overflow-y-auto rounded-2xl border bg-white p-2 shadow-xl">
        <div className="mb-2 px-2 py-1 text-xs font-bold text-slate-500">المزيد من مساحة العمل</div>
        <div className="grid grid-cols-2 gap-1">{moreItems.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => { onNavigate(item.id); setMoreOpen(false) }} className="flex items-center gap-2 rounded-lg px-2 py-2 text-right text-xs text-slate-600 hover:bg-slate-50"><Icon className="h-4 w-4 text-slate-400"/><span className="min-w-0 flex-1 truncate">{item.label}</span></button> })}</div>
      </div>}
      <div className="grid grid-cols-4 gap-1">
        {shortcuts.map(item => {
          const Icon = item.icon
          const selected = activeTab === item.id
          return <button key={item.id} type="button" onClick={() => onNavigate(item.id)} className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] ${selected ? 'bg-emerald-50 font-bold text-emerald-700' : 'text-slate-500'}`} aria-current={selected ? 'page' : undefined}><Icon className="h-4 w-4"/><span>{item.id === 'dashboard' ? 'الرئيسية' : item.label.replace('الأدلة', '')}</span></button>
        })}
        <button type="button" onClick={() => setMoreOpen(value => !value)} className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] ${moreActive || moreOpen ? 'bg-slate-100 font-bold text-slate-800' : 'text-slate-500'}`} aria-expanded={moreOpen}><MoreIcon/><span>المزيد</span></button>
      </div>
    </nav>
  )
}

function MoreIcon() {
  return <span className="flex h-4 items-center gap-0.5"><span className="h-1 w-1 rounded-full bg-current"/><span className="h-1 w-1 rounded-full bg-current"/><span className="h-1 w-1 rounded-full bg-current"/></span>
}

export function getNavigationContext(activeTab: string, groups: NavigationGroup[] = NAV_GROUPS) {
  for (const group of groups) {
    const item = group.items.find(entry => entry.id === activeTab)
    if (item) return { section: group.label, sectionDescription: group.description, screen: item.label, screenDescription: item.description }
  }
  return { section: 'نظرة عامة', sectionDescription: 'حالة المشروع وما يحتاج إجراءً الآن', screen: 'ملخص المشروع', screenDescription: 'التقدم والتنبيهات والإجراء التالي' }
}

export function WorkspaceBreadcrumb({ activeTab, projectName }: { activeTab: string; projectName?: string | null }) {
  const context = getNavigationContext(activeTab)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500" dir="rtl">
      <span>مساحة العمل</span><span className="text-slate-300">/</span><span>{context.section}</span><span className="text-slate-300">/</span><span className="font-semibold text-slate-700">{context.screen}</span>
      {projectName && <><span className="text-slate-300">/</span><span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">{projectName}</span></>}
    </div>
  )
}
