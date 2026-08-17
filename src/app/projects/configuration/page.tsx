"use client"

import React, { useEffect, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowRight, BookOpen, Boxes, FileText, Loader2, Plus, RefreshCw, Users } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuthStore } from "@/lib/auth-store"
import { apiRequest } from "@/lib/api-client"

const DEFAULT_UNIT_TYPES = ["Shelter", "House", "Classroom", "Office", "Other"]
const DEFAULT_TRADES = ["Civil", "Electrical", "Plumbing", "Steel", "Finishes", "Other"]
const DEFAULT_UOMS = ["m", "m²", "m³", "No", "kg", "LS"]

type Dictionary = { id: string; kind?: string; key?: string; value?: string; name?: string; category?: string; isActive?: boolean }
type Unit = { id: string; name: string; code: string; unitType?: string; floor?: string | null; areaSqm?: number | null; completionPct?: number }
type Boq = { id: string; code: string; trade: string; description: string; quantity: number; rate?: number; amount?: number; unitOfMeasure: string; sequence?: number; completionPct?: number }
type Assignment = { id: number; unit_id: number; boq_item_id: number; planned_quantity: number; is_active: boolean }

async function api<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const result = await apiRequest<T>(endpoint, options)
  if (!result.success) {
    if (result.error === "UNAUTHORIZED") {
      throw new Error("SESSION_EXPIRED")
    }
    throw new Error(result.error || "API_REQUEST_FAILED")
  }
  return result.data as T
}

export default function ProjectConfigurationPage() {
  const params = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const user = useAuthStore(s => s.user)
  const projectId = params.get("projectId") || ""
  const initialTab = params.get("tab") === "boq" || params.get("tab") === "units" || params.get("tab") === "dictionaries" ? params.get("tab")! : "dictionaries"
  const orgId = String(user?.orgId || "")
  const [project, setProject] = useState<any>(null)
  const [dictionaries, setDictionaries] = useState<Dictionary[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [boq, setBoq] = useState<Boq[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dictKind, setDictKind] = useState("trade")
  const [dictKey, setDictKey] = useState("")
  const [dictValue, setDictValue] = useState("")
  const [unitName, setUnitName] = useState("")
  const [unitCode, setUnitCode] = useState("")
  const [unitType, setUnitType] = useState("")
  const [unitFloor, setUnitFloor] = useState("")
  const [unitArea, setUnitArea] = useState("")
  const [boqCode, setBoqCode] = useState("")
  const [trade, setTrade] = useState("")
  const [description, setDescription] = useState("")
  const [quantity, setQuantity] = useState("")
  const [uom, setUom] = useState("")
  const [selectedBoqId, setSelectedBoqId] = useState("")
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<number>>(new Set())
  const [plannedPerUnit, setPlannedPerUnit] = useState("")
  const [unitSearch, setUnitSearch] = useState("")

  const load = async () => {
    if (!orgId || !projectId) return
    setLoading(true)
    try {
      // Load the project first. A failure in dictionaries/canonical BOQ must not
      // turn an accessible project into the misleading "not found" empty state.
      const projectResponse = await api<any>(`/projects/${projectId}`)
      setProject(projectResponse)
      const [dictResult, unitResult, canonicalResult] = await Promise.allSettled([
        api<any>(`/projects/dictionaries?project_id=${encodeURIComponent(projectId)}`),
        api<any>(`/projects/${projectId}/units`),
        api<any>(`/projects/${projectId}/canonical-boq`),
      ])
      const dictResponse = dictResult.status === "fulfilled" ? dictResult.value : []
      const unitResponse = unitResult.status === "fulfilled" ? unitResult.value : { items: [] }
      const canonical = canonicalResult.status === "fulfilled" ? canonicalResult.value : {}
      setDictionaries(Array.isArray(dictResponse) ? dictResponse : dictResponse.items || [])
      setUnits((canonical.units || unitResponse.items || []).map((u: any) => ({ ...u, id: String(u.id), unitType: u.unitType ?? u.unit_type ?? "", floor: u.floor ?? null, areaSqm: u.areaSqm ?? u.area_sqm ?? null })))
      setBoq((canonical.boq_items || []).map((b: any) => ({ ...b, id: String(b.id), unitOfMeasure: b.unitOfMeasure ?? b.unit_of_measure ?? "item", completionPct: Number(b.completionPct ?? b.completion_pct ?? 0) })))
      setAssignments(canonical.assignments || [])
      const partialFailures = [dictResult, unitResult, canonicalResult].filter(r => r.status === "rejected")
      if (partialFailures.length) toast({ title: "تم تحميل المشروع جزئيًا", description: "تعذر تحميل بعض بيانات الإعداد؛ يمكنك إعادة المحاولة من زر التحديث.", variant: "destructive" })
    } catch (e) { toast({ title: "تعذر تحميل المشروع", description: e instanceof Error && e.message === "SESSION_EXPIRED" ? "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى" : e instanceof Error ? e.message : "خطأ غير متوقع", variant: "destructive" }) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [orgId, projectId])

  const trades = useMemo(() => Array.from(new Set([...DEFAULT_TRADES, ...dictionaries.filter(d => (d.kind || d.category) === "trade" && d.isActive !== false).map(d => d.value || d.name || d.key).filter(Boolean) as string[]])), [dictionaries])
  const uoms = useMemo(() => Array.from(new Set([...DEFAULT_UOMS, ...dictionaries.filter(d => (d.kind || d.category) === "uom" && d.isActive !== false).map(d => d.value || d.name || d.key).filter(Boolean) as string[]])), [dictionaries])
  const unitTypes = useMemo(() => Array.from(new Set([...DEFAULT_UNIT_TYPES, ...dictionaries.filter(d => (d.kind || d.category) === "unit_type" && d.isActive !== false).map(d => d.value || d.name || d.key).filter(Boolean) as string[]])), [dictionaries])
  const assignmentCount = (boqId: string) => assignments.filter(a => String(a.boq_item_id) === String(boqId) && a.is_active).length
  const selectedBoq = boq.find(b => String(b.id) === selectedBoqId)
  const filteredUnits = units.filter(u => `${u.name} ${u.code}`.toLowerCase().includes(unitSearch.trim().toLowerCase()))

  const addDictionary = async () => { if (!dictValue.trim()) return; setSaving(true); try { await api("/projects/dictionaries", { method: "POST", body: JSON.stringify({ project_id: Number(projectId), kind: dictKind.trim().toLowerCase(), key: dictKey.trim() || dictValue.trim(), value: dictValue.trim(), sort_order: 0 }) }); setDictKey(""); setDictValue(""); await load(); toast({ title: "تمت إضافة القيمة إلى القاموس" }) } catch (e) { toast({ title: "فشل إضافة القاموس", description: e instanceof Error && e.message === "SESSION_EXPIRED" ? "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى" : e instanceof Error ? e.message : "خطأ", variant: "destructive" }) } finally { setSaving(false) } }
  const addUnit = async () => { if (!unitName.trim() || !unitCode.trim() || !unitType.trim()) return; setSaving(true); try { await api(`/projects/${projectId}/units`, { method: "POST", body: JSON.stringify({ name: unitName.trim(), code: unitCode.trim(), unit_type: unitType.trim(), floor: unitFloor.trim() || null, area_sqm: unitArea ? Number(unitArea) : null }) }); setUnitName(""); setUnitCode(""); setUnitFloor(""); setUnitArea(""); await load(); toast({ title: "تمت إضافة الوحدة" }) } catch (e) { toast({ title: "فشل إنشاء الوحدة", description: e instanceof Error && e.message === "SESSION_EXPIRED" ? "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى" : e instanceof Error ? e.message : "خطأ", variant: "destructive" }) } finally { setSaving(false) } }
  const addBoq = async () => { if (!trade.trim() || !description.trim() || !uom.trim() || !quantity) return; setSaving(true); try { const item = await api<Boq>(`/projects/${projectId}/canonical-boq`, { method: "POST", body: JSON.stringify({ code: boqCode.trim() || null, trade: trade.trim(), description: description.trim(), quantity: Number(quantity), rate: 0, unit_of_measure: uom.trim() }) }); setBoqCode(""); setDescription(""); setQuantity(""); await load(); setSelectedBoqId(String(item.id)); toast({ title: "تم إنشاء بند BOQ مركزي", description: "البند تعريف واحد للمشروع، وليس نسخة لكل وحدة." }) } catch (e) { toast({ title: "فشل إنشاء بند BOQ", description: e instanceof Error && e.message === "SESSION_EXPIRED" ? "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى" : e instanceof Error ? e.message : "خطأ", variant: "destructive" }) } finally { setSaving(false) } }
  const applyBoq = async () => { if (!selectedBoqId || selectedUnitIds.size === 0) return; setSaving(true); try { await api(`/projects/${projectId}/canonical-boq/${selectedBoqId}/apply`, { method: "POST", body: JSON.stringify({ unit_ids: Array.from(selectedUnitIds), planned_quantity: plannedPerUnit ? Number(plannedPerUnit) : 0 }) }); setSelectedUnitIds(new Set()); await load(); toast({ title: "تم تطبيق البند على الوحدات", description: "تم إنشاء علاقة التطبيق وتهيئة حالة التنفيذ." }) } catch (e) { toast({ title: "فشل تطبيق البند", description: e instanceof Error && e.message === "SESSION_EXPIRED" ? "انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى" : e instanceof Error ? e.message : "خطأ", variant: "destructive" }) } finally { setSaving(false) } }
  const toggleUnit = (id: number) => setSelectedUnitIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const toggleAllFiltered = () => setSelectedUnitIds(prev => { const ids = filteredUnits.map(u => Number(u.id)); const all = ids.length > 0 && ids.every(id => prev.has(id)); const next = new Set(prev); ids.forEach(id => all ? next.delete(id) : next.add(id)); return next })

  if (!projectId) return <main className="p-6" dir="rtl"><Card><CardContent className="p-8 text-center">لم يتم تحديد مشروع.</CardContent></Card></main>
  if (loading && !project) return <main className="min-h-screen flex items-center justify-center" dir="rtl"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></main>
  if (!project) return <main className="p-6" dir="rtl"><Card><CardContent className="p-8 text-center">المشروع غير موجود أو لا يمكن الوصول إليه.</CardContent></Card></main>

  return <main className="min-h-screen bg-gray-50 p-4 md:p-6" dir="rtl"><div className="max-w-6xl mx-auto space-y-5">
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => router.push("/")}><ArrowRight className="h-5 w-5" /></Button><div><h1 className="text-xl font-bold">إعداد المشروع</h1><p className="text-sm text-muted-foreground">{project.name} — {project.code}</p></div></div><Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ml-1 ${loading ? "animate-spin" : ""}`} />تحديث</Button></div>
    <Card><CardContent className="p-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center"><div><p className="text-xs text-muted-foreground">القواميس</p><p className="text-xl font-bold">{dictionaries.length}</p></div><div><p className="text-xs text-muted-foreground">الوحدات</p><p className="text-xl font-bold">{units.length}</p></div><div><p className="text-xs text-muted-foreground">بنود BOQ</p><p className="text-xl font-bold">{boq.length}</p></div><div><p className="text-xs text-muted-foreground">الإنجاز</p><p className="text-xl font-bold text-emerald-700">{Math.round(project.completion_pct ?? project.completionPct ?? 0)}%</p></div></div></CardContent></Card>
    <Tabs defaultValue={initialTab} dir="rtl"><TabsList className="grid grid-cols-3 w-full"><TabsTrigger value="dictionaries"><BookOpen className="h-4 w-4 ml-1" />القواميس المرجعية</TabsTrigger><TabsTrigger value="units"><Boxes className="h-4 w-4 ml-1" />الوحدات</TabsTrigger><TabsTrigger value="boq"><FileText className="h-4 w-4 ml-1" />BOQ المشروع</TabsTrigger></TabsList>
      <TabsContent value="dictionaries" className="space-y-4"><Card><CardHeader><CardTitle>القواميس المرجعية</CardTitle><CardDescription>القواميس تضيف خيارات المشروع عند الحاجة؛ الخيارات الأساسية متاحة مباشرة ولا توقف إنشاء الوحدة أو BOQ.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid md:grid-cols-3 gap-3"><div><Label>نوع القاموس</Label><Input value={dictKind} onChange={e => setDictKind(e.target.value)} placeholder="trade / uom / unit_type" /></div><div><Label>المفتاح</Label><Input value={dictKey} onChange={e => setDictKey(e.target.value)} placeholder="اختياري" /></div><div><Label>القيمة الظاهرة</Label><Input value={dictValue} onChange={e => setDictValue(e.target.value)} placeholder="مثال: Shelter" /></div></div><Button onClick={addDictionary} disabled={saving || !dictValue.trim()}><Plus className="h-4 w-4 ml-1" />إضافة قيمة مرجعية</Button><div className="flex flex-wrap gap-2">{dictionaries.map(d => <Badge key={d.id} variant="outline">{d.kind || d.category}: {d.value || d.name || d.key}</Badge>)}</div></CardContent></Card></TabsContent>
      <TabsContent value="units" className="space-y-4"><Card><CardHeader><CardTitle>وحدات المشروع</CardTitle><CardDescription>الوحدة تمثل المستفيد/المأوى/الموقع التنفيذي. لا تحتوي على نسخة مستقلة من BOQ.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid md:grid-cols-3 gap-3"><div><Label>اسم الوحدة *</Label><Input value={unitName} onChange={e => setUnitName(e.target.value)} placeholder="المأوى 001" /></div><div><Label>رمز الوحدة *</Label><Input value={unitCode} onChange={e => setUnitCode(e.target.value)} placeholder="SH-001" /></div><div><Label>نوع الوحدة *</Label><Select value={unitType} onValueChange={setUnitType}><SelectTrigger><SelectValue placeholder="اختر نوع الوحدة" /></SelectTrigger><SelectContent>{unitTypes.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div></div><div className="grid md:grid-cols-2 gap-3"><div><Label>الطابق</Label><Input value={unitFloor} onChange={e => setUnitFloor(e.target.value)} /></div><div><Label>المساحة م²</Label><Input type="number" value={unitArea} onChange={e => setUnitArea(e.target.value)} /></div></div><Button onClick={addUnit} disabled={saving || !unitName.trim() || !unitCode.trim() || !unitType.trim()}><Plus className="h-4 w-4 ml-1" />إضافة وحدة</Button><div className="grid md:grid-cols-2 gap-2">{units.map(u => <Card key={u.id}><CardContent className="p-3 flex items-center justify-between"><div><p className="font-bold">{u.name}</p><p className="text-xs text-muted-foreground">{u.code} · {u.unitType || "—"} · {u.floor || "—"}</p></div><Badge variant="outline">{assignments.filter(a => a.unit_id === Number(u.id) && a.is_active).length} تطبيق BOQ</Badge></CardContent></Card>)}</div></CardContent></Card></TabsContent>
      <TabsContent value="boq" className="space-y-4"><Card><CardHeader><CardTitle>جدول كميات المشروع — Master BOQ</CardTitle><CardDescription>أضف البند مرة واحدة هنا، ثم حدد الوحدات التي ينطبق عليها. لا يتم إنشاء LEGACY-1 … LEGACY-230.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid md:grid-cols-4 gap-3"><div><Label>الكود</Label><Input value={boqCode} onChange={e => setBoqCode(e.target.value)} placeholder="BOQ-001" /></div><div><Label>التخصص *</Label><Select value={trade} onValueChange={setTrade}><SelectTrigger><SelectValue placeholder="اختر التخصص" /></SelectTrigger><SelectContent>{trades.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div><div><Label>الوصف *</Label><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="أعمال الحفر" /></div><div><Label>الكمية الإجمالية *</Label><Input type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} /></div></div><div className="grid md:grid-cols-2 gap-3"><div><Label>وحدة القياس *</Label><Select value={uom} onValueChange={setUom}><SelectTrigger><SelectValue placeholder="اختر وحدة القياس" /></SelectTrigger><SelectContent>{uoms.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div><div className="flex items-end"><Button onClick={addBoq} disabled={saving || !trade || !description.trim() || !quantity || !uom}><Plus className="h-4 w-4 ml-1" />إضافة بند مركزي للمشروع</Button></div></div></CardContent></Card>
        <Card><CardHeader><CardTitle>بنود المشروع ({boq.length})</CardTitle><CardDescription>كل صف هنا هو BOQ Item واحد على مستوى المشروع.</CardDescription></CardHeader><CardContent className="space-y-2">{boq.map(item => <div key={item.id} className={`border rounded-lg p-3 ${String(item.id) === selectedBoqId ? "border-emerald-500 bg-emerald-50/30" : ""}`}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><Badge variant="outline">{item.code}</Badge><span className="font-medium truncate">{item.description}</span></div><p className="text-xs text-muted-foreground mt-1">{item.trade} · {item.quantity} {item.unitOfMeasure} · مطبق على {assignmentCount(String(item.id))} وحدة</p></div><Button size="sm" variant={String(item.id) === selectedBoqId ? "default" : "outline"} onClick={() => setSelectedBoqId(String(item.id))}><Users className="h-4 w-4 ml-1" />تطبيق</Button></div></div>)}{!boq.length && <div className="py-8 text-center text-sm text-muted-foreground">لا توجد بنود بعد. أضف أول بند BOQ للمشروع.</div>}</CardContent></Card>
        {selectedBoq && <Card><CardHeader><CardTitle>تطبيق: {selectedBoq.code} — {selectedBoq.description}</CardTitle><CardDescription>اختر الوحدات التي ينطبق عليها هذا البند. هذه عملية ربط وليست إنشاء بند جديد.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex gap-2 items-center"><Input value={unitSearch} onChange={e => setUnitSearch(e.target.value)} placeholder="بحث بالوحدة..." /><Button variant="outline" onClick={toggleAllFiltered}>{filteredUnits.length && filteredUnits.every(u => selectedUnitIds.has(Number(u.id))) ? "إلغاء تحديد الظاهر" : "تحديد الظاهر"}</Button></div><div className="grid md:grid-cols-2 gap-2 max-h-80 overflow-y-auto border rounded-lg p-2">{filteredUnits.map(u => <label key={u.id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"><input type="checkbox" checked={selectedUnitIds.has(Number(u.id))} onChange={() => toggleUnit(Number(u.id))} /><span className="text-sm">{u.name} <span className="text-xs text-muted-foreground">({u.code})</span></span></label>)}</div><div className="grid md:grid-cols-3 gap-3 items-end"><div><Label>الكمية المخططة لكل وحدة</Label><Input type="number" min="0" value={plannedPerUnit} onChange={e => setPlannedPerUnit(e.target.value)} placeholder="مثال: 5" /></div><div><Badge variant="outline">{selectedUnitIds.size} وحدة محددة</Badge></div><div><Button onClick={applyBoq} disabled={saving || !selectedUnitIds.size}>تطبيق البند على الوحدات</Button></div></div></CardContent></Card>}
      </TabsContent>
    </Tabs>
  </div></main>
}
