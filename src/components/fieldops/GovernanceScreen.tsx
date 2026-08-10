// FieldOps V4 — Governance Screen
// Sprint 5 Phase 3 — Policy Rules & Payment Decisions

'use client'

import React, { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Shield, Plus, Search, Filter, Eye, Edit3, AlertTriangle,
  CheckCircle2, XCircle, Clock, ArrowRight, Scale, Gavel,
  FileText, DollarSign, Percent, Lock, Unlock, AlertCircle,
  MoreHorizontal, ChevronDown, ChevronUp, Zap, RefreshCw
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// ============================================================
// Types
// ============================================================

interface PolicyRule {
  id: string
  ruleCode: string
  priority: number
  decision: 'HOLD' | 'RELEASE' | 'CONDITIONAL'
  paymentPct: number
  condition: Record<string, unknown>
  flagMessage: string | null
  isActive: boolean
}

interface GovernancePolicy {
  id: string
  orgId: string
  name: string
  version: string
  isActive: boolean
  description: string | null
  createdBy: string | null
  rules: PolicyRule[]
  createdAt: string
  updatedAt: string
}

interface GovernanceDecision {
  id: string
  orgId: string
  unitId: string | null
  boqItemId: string | null
  remarkId: string | null
  decision: 'HOLD' | 'RELEASE' | 'CONDITIONAL'
  paymentPct: number
  flag: string | null
  matchedRule: string | null
  reason: string | null
  isOverridden: boolean
  createdAt: string
}

interface GovernanceScreenProps {
  orgId: string
  onRefresh: () => void
}

// ============================================================
// Constants
// ============================================================

const DECISION_COLORS: Record<string, string> = {
  HOLD: 'bg-red-100 text-red-800 border-red-200',
  RELEASE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  CONDITIONAL: 'bg-amber-100 text-amber-800 border-amber-200',
}

const DECISION_LABELS: Record<string, string> = {
  HOLD: 'حجز',
  RELEASE: 'إطلاق',
  CONDITIONAL: 'مشروط',
}

const DECISION_ICONS: Record<string, any> = {
  HOLD: Lock,
  RELEASE: Unlock,
  CONDITIONAL: AlertCircle,
}

// ============================================================
// Demo Data
// ============================================================

function generateDemoData(): { policies: GovernancePolicy[]; decisions: GovernanceDecision[] } {
  const policies: GovernancePolicy[] = [
    {
      id: 'policy-1',
      orgId: 'demo',
      name: 'سياسة الدفع والإفراج',
      version: '2.0',
      isActive: true,
      description: 'سياسة الحوكمة الرئيسية — تحدد قواعد الدفع والإفراج عن الدفعات بناءً على حالة الجودة والإنجاز',
      createdBy: 'مدير النظام',
      rules: [
        {
          id: 'rule-1',
          ruleCode: 'R-001',
          priority: 1,
          decision: 'HOLD',
          paymentPct: 0,
          condition: { remarkSeverity: 'CRITICAL', status: 'OPEN' },
          flagMessage: 'توجد ملاحظة حرجة مفتوحة — يجب حجز الدفعة حتى يتم الحل',
          isActive: true,
        },
        {
          id: 'rule-2',
          ruleCode: 'R-002',
          priority: 2,
          decision: 'CONDITIONAL',
          paymentPct: 50,
          condition: { remarkSeverity: 'MAJOR', status: 'OPEN' },
          flagMessage: 'ملاحظة رئيسية مفتوحة — دفعة جزئية 50% مع الحجز',
          isActive: true,
        },
        {
          id: 'rule-3',
          ruleCode: 'R-003',
          priority: 3,
          decision: 'HOLD',
          paymentPct: 0,
          condition: { reworkFlag: true, completionPct: { lessThan: 100 } },
          flagMessage: 'إعادة تنفيذ غير مكتملة — حجز كامل',
          isActive: true,
        },
        {
          id: 'rule-4',
          ruleCode: 'R-004',
          priority: 4,
          decision: 'RELEASE',
          paymentPct: 100,
          condition: { completionPct: { gte: 100 }, openRemarks: 0 },
          flagMessage: 'الإنجاز مكتمل ولا توجد ملاحظات — إطلاق كامل',
          isActive: true,
        },
        {
          id: 'rule-5',
          ruleCode: 'R-005',
          priority: 5,
          decision: 'CONDITIONAL',
          paymentPct: 80,
          condition: { completionPct: { gte: 80 }, openRemarks: { lessThan: 2 } },
          flagMessage: 'إنجاز 80%+ مع ملاحظات قليلة — دفعة 80%',
          isActive: true,
        },
      ],
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'policy-2',
      orgId: 'demo',
      name: 'سياسة التفتيش والمطابقة',
      version: '1.5',
      isActive: true,
      description: 'قواعد تفتيش المطابقة مع المواصفات — تحدد متى يجب إيقاف العمل أو الاستمرار',
      createdBy: 'مدير الجودة',
      rules: [
        {
          id: 'rule-6',
          ruleCode: 'I-001',
          priority: 1,
          decision: 'HOLD',
          paymentPct: 0,
          condition: { inspectionFailed: true, safetyIssue: true },
          flagMessage: 'فشل فحص السلامة — إيقاف فوري',
          isActive: true,
        },
        {
          id: 'rule-7',
          ruleCode: 'I-002',
          priority: 2,
          decision: 'CONDITIONAL',
          paymentPct: 60,
          condition: { inspectionFailed: true, safetyIssue: false },
          flagMessage: 'فشل فحص الجودة بدون مشكلة سلامة — دفعة جزئية',
          isActive: true,
        },
      ],
      createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
  ]

  const decisions: GovernanceDecision[] = [
    {
      id: 'dec-1',
      orgId: 'demo',
      unitId: 'unit-1',
      boqItemId: 'boq-1',
      remarkId: 'remark-1',
      decision: 'HOLD',
      paymentPct: 0,
      flag: 'CRITICAL_REMARK',
      matchedRule: 'R-001',
      reason: 'ملاحظة حرجة مفتوحة على أعمال السباكة',
      isOverridden: false,
      createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
    {
      id: 'dec-2',
      orgId: 'demo',
      unitId: 'unit-2',
      boqItemId: 'boq-5',
      remarkId: 'remark-2',
      decision: 'CONDITIONAL',
      paymentPct: 50,
      flag: 'MAJOR_REMARK',
      matchedRule: 'R-002',
      reason: 'ملاحظة رئيسية مفتوحة — دفعة جزئية',
      isOverridden: false,
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    },
    {
      id: 'dec-3',
      orgId: 'demo',
      unitId: 'unit-3',
      boqItemId: 'boq-10',
      remarkId: null,
      decision: 'RELEASE',
      paymentPct: 100,
      flag: null,
      matchedRule: 'R-004',
      reason: 'الإنجاز مكتمل بدون ملاحظات',
      isOverridden: false,
      createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    },
    {
      id: 'dec-4',
      orgId: 'demo',
      unitId: 'unit-4',
      boqItemId: 'boq-15',
      remarkId: 'remark-3',
      decision: 'HOLD',
      paymentPct: 0,
      flag: 'REWORK_INCOMPLETE',
      matchedRule: 'R-003',
      reason: 'إعادة تنفيذ غير مكتملة',
      isOverridden: true,
      createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    },
    {
      id: 'dec-5',
      orgId: 'demo',
      unitId: 'unit-5',
      boqItemId: 'boq-20',
      remarkId: null,
      decision: 'CONDITIONAL',
      paymentPct: 80,
      flag: 'HIGH_COMPLETION',
      matchedRule: 'R-005',
      reason: 'إنجاز 85% مع ملاحظة واحدة',
      isOverridden: false,
      createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    },
  ]

  return { policies, decisions }
}

// ============================================================
// Governance Screen Component
// ============================================================

export function GovernanceScreen({ orgId, onRefresh }: GovernanceScreenProps) {
  const { toast } = useToast()
  const { policies, decisions } = useMemo(() => generateDemoData(), [])
  const [activeTab, setActiveTab] = useState('policies')
  const [selectedPolicy, setSelectedPolicy] = useState<GovernancePolicy | null>(null)
  const [showPolicyDetail, setShowPolicyDetail] = useState(false)
  const [selectedDecision, setSelectedDecision] = useState<GovernanceDecision | null>(null)
  const [showDecisionDetail, setShowDecisionDetail] = useState(false)
  const [showOverride, setShowOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')

  const activePolicies = policies.filter(p => p.isActive)
  const totalRules = policies.reduce((sum, p) => sum + p.rules.length, 0)
  const holdDecisions = decisions.filter(d => d.decision === 'HOLD').length
  const overriddenDecisions = decisions.filter(d => d.isOverridden).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">الحوكمة والسياسات</h2>
          <p className="text-sm text-gray-500 mt-1">إدارة قواعد الدفع والإفراج وقرارات الحوكمة</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-4 h-4 ml-1" />
          سياسة جديدة
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'السياسات النشطة', value: activePolicies.length, icon: Shield, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'إجمالي القواعد', value: totalRules, icon: Scale, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'قرارات الحجز', value: holdDecisions, icon: Lock, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'قرارات الإطلاق', value: decisions.filter(d => d.decision === 'RELEASE').length, icon: Unlock, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'تجاوزات', value: overriddenDecisions, icon: Gavel, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map((stat, idx) => (
          <Card key={idx} className={`${stat.bg} border-0`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">{stat.label}</p>
                  <p className={`text-xl font-bold ${stat.color} mt-1`}>{stat.value}</p>
                </div>
                <stat.icon className={`w-5 h-5 ${stat.color} opacity-50`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-gray-100">
          <TabsTrigger value="policies" className="text-xs">
            <Shield className="w-3.5 h-3.5 ml-1" />
            السياسات والقواعد
          </TabsTrigger>
          <TabsTrigger value="decisions" className="text-xs">
            <Gavel className="w-3.5 h-3.5 ml-1" />
            القرارات
          </TabsTrigger>
        </TabsList>

        {/* Policies Tab */}
        <TabsContent value="policies" className="space-y-4">
          {policies.map((policy) => (
            <Card key={policy.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <Shield className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{policy.name}</CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        الإصدار {policy.version} — {policy.rules.length} قاعدة
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={policy.isActive ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-gray-100 text-gray-800 border-gray-200'}>
                      {policy.isActive ? 'نشط' : 'غير نشط'}
                    </Badge>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setSelectedPolicy(policy); setShowPolicyDetail(true) }}>
                      <Eye className="w-3 h-3 ml-1" />
                      عرض
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {policy.description && (
                <CardContent className="pb-3">
                  <p className="text-sm text-gray-600">{policy.description}</p>
                </CardContent>
              )}

              <CardContent className="p-0">
                <div className="border-t border-gray-100">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">الرمز</TableHead>
                        <TableHead className="text-xs">الأولوية</TableHead>
                        <TableHead className="text-xs">القرار</TableHead>
                        <TableHead className="text-xs">نسبة الدفع</TableHead>
                        <TableHead className="text-xs">رسالة التنبيه</TableHead>
                        <TableHead className="text-xs">الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {policy.rules.map((rule) => (
                        <TableRow key={rule.id}>
                          <TableCell className="text-xs font-mono">{rule.ruleCode}</TableCell>
                          <TableCell className="text-xs">{rule.priority}</TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] ${DECISION_COLORS[rule.decision]}`}>
                              {DECISION_LABELS[rule.decision]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Percent className="w-3 h-3 text-gray-400" />
                              <span className="text-xs font-medium">{rule.paymentPct}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-gray-600 max-w-[200px] truncate">
                            {rule.flagMessage || '—'}
                          </TableCell>
                          <TableCell>
                            <Badge className={rule.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}>
                              {rule.isActive ? 'نشط' : 'معطل'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Decisions Tab */}
        <TabsContent value="decisions" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">قرارات الحوكمة الأخيرة</CardTitle>
              <CardDescription>القرارات المتخذة بناءً على قواعد السياسات النشطة</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">القرار</TableHead>
                    <TableHead className="text-xs">نسبة الدفع</TableHead>
                    <TableHead className="text-xs">القاعدة المطابقة</TableHead>
                    <TableHead className="text-xs">السبب</TableHead>
                    <TableHead className="text-xs">تجاوز</TableHead>
                    <TableHead className="text-xs">التاريخ</TableHead>
                    <TableHead className="text-xs">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisions.map((dec) => {
                    const DecisionIcon = DECISION_ICONS[dec.decision] || Shield
                    return (
                      <TableRow key={dec.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <DecisionIcon className="w-4 h-4" />
                            <Badge className={`text-[10px] ${DECISION_COLORS[dec.decision]}`}>
                              {DECISION_LABELS[dec.decision]}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-medium">{dec.paymentPct}%</span>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{dec.matchedRule || '—'}</TableCell>
                        <TableCell className="text-xs text-gray-600 max-w-[150px] truncate">{dec.reason || '—'}</TableCell>
                        <TableCell>
                          {dec.isOverridden ? (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
                              <Gavel className="w-3 h-3 ml-1" />
                              تم التجاوز
                            </Badge>
                          ) : (
                            <Badge className="bg-gray-100 text-gray-600 text-[10px]">لا</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500" dir="ltr">
                          {new Date(dec.createdAt).toLocaleDateString('ar-SA')}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setSelectedDecision(dec); setShowDecisionDetail(true) }}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Policy Detail Dialog */}
      <Dialog open={showPolicyDetail} onOpenChange={setShowPolicyDetail}>
        <DialogContent className="max-w-2xl" dir="rtl">
          {selectedPolicy && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Shield className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <DialogTitle>{selectedPolicy.name}</DialogTitle>
                    <DialogDescription>الإصدار {selectedPolicy.version}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {selectedPolicy.description && (
                  <p className="text-sm text-gray-600">{selectedPolicy.description}</p>
                )}

                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 bg-gray-50 rounded-lg text-center">
                    <p className="text-xs text-gray-500">القواعد</p>
                    <p className="text-lg font-bold text-gray-900">{selectedPolicy.rules.length}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg text-center">
                    <p className="text-xs text-gray-500">قواعد الحجز</p>
                    <p className="text-lg font-bold text-red-600">{selectedPolicy.rules.filter(r => r.decision === 'HOLD').length}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg text-center">
                    <p className="text-xs text-gray-500">قواعد الإطلاق</p>
                    <p className="text-lg font-bold text-emerald-600">{selectedPolicy.rules.filter(r => r.decision === 'RELEASE').length}</p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  {selectedPolicy.rules.map((rule) => {
                    const RuleIcon = DECISION_ICONS[rule.decision]
                    return (
                      <div key={rule.id} className="p-3 border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <RuleIcon className="w-4 h-4" />
                            <span className="text-sm font-medium">{rule.ruleCode}</span>
                            <Badge className={`text-[10px] ${DECISION_COLORS[rule.decision]}`}>
                              {DECISION_LABELS[rule.decision]}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <Percent className="w-3 h-3 text-gray-400" />
                            <span className="text-sm font-medium">{rule.paymentPct}%</span>
                          </div>
                        </div>
                        {rule.flagMessage && (
                          <p className="text-xs text-gray-600">{rule.flagMessage}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPolicyDetail(false)}>إغلاق</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Decision Detail / Override Dialog */}
      <Dialog open={showDecisionDetail} onOpenChange={setShowDecisionDetail}>
        <DialogContent className="max-w-lg" dir="rtl">
          {selectedDecision && (
            <>
              <DialogHeader>
                <DialogTitle>تفاصيل القرار</DialogTitle>
                <DialogDescription>قرار الحوكمة {selectedDecision.id}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                <div className="flex items-center gap-3">
                  <Badge className={`text-sm ${DECISION_COLORS[selectedDecision.decision]}`}>
                    {DECISION_LABELS[selectedDecision.decision]}
                  </Badge>
                  <span className="text-lg font-bold">{selectedDecision.paymentPct}%</span>
                  <span className="text-sm text-gray-500">من الدفعة</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">القاعدة المطابقة</p>
                    <p className="text-sm font-mono">{selectedDecision.matchedRule || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">التنبيه</p>
                    <p className="text-sm">{selectedDecision.flag || '—'}</p>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-gray-500">السبب</p>
                  <p className="text-sm">{selectedDecision.reason || '—'}</p>
                </div>

                {selectedDecision.isOverridden && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
                      <Gavel className="w-4 h-4" />
                      تم تجاوز هذا القرار
                    </div>
                  </div>
                )}

                {!selectedDecision.isOverridden && selectedDecision.decision === 'HOLD' && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-800 mb-2">هذا القرار يحجز الدفعة بالكامل. يمكنك تجاوزه مع تقديم مبرر.</p>
                    <Button variant="outline" size="sm" className="text-red-700 border-red-300 hover:bg-red-50" onClick={() => setShowOverride(true)}>
                      <Gavel className="w-3 h-3 ml-1" />
                      تجاوز القرار
                    </Button>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDecisionDetail(false)}>إغلاق</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Override Dialog */}
      <Dialog open={showOverride} onOpenChange={setShowOverride}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تجاوز قرار الحوكمة</DialogTitle>
            <DialogDescription>تجاوز قرار الحجز يتطلب مبرراً موثقاً</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2 text-amber-800 text-sm">
                <AlertTriangle className="w-4 h-4" />
                تحذير: التجاوز سيتم تسجيله في سجل التدقيق
              </div>
            </div>

            <div className="space-y-2">
              <Label>نسبة الدفع الجديدة</Label>
              <Input type="number" min={0} max={100} defaultValue={50} />
            </div>

            <div className="space-y-2">
              <Label>مبرر التجاوز (مطلوب)</Label>
              <Textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="أدخل مبرر التجاوز بالتفصيل..."
                rows={3}
              />
              {overrideReason.length > 0 && overrideReason.length < 20 && (
                <p className="text-xs text-red-500">المبرر يجب أن يكون 20 حرفاً على الأقل</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOverride(false)}>إلغاء</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              disabled={overrideReason.length < 20}
              onClick={() => {
                toast({ title: 'تم تجاوز القرار', description: 'تم تسجيل التجاوز في سجل التدقيق' })
                setShowOverride(false)
                setShowDecisionDetail(false)
              }}
            >
              <Gavel className="w-4 h-4 ml-1" />
              تأكيد التجاوز
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
