"use client"

import { useRef, useState } from "react"
import * as XLSX from "xlsx"
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import { useAuthStore } from "@/lib/auth-store"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"
type ImportKind = "units" | "boq"

function errorText(value: unknown): string {
  if (!value) return "تعذر تنفيذ الاستيراد"
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null) {
    const detail = value as { message?: string; errors?: string[]; error_count?: number; missing?: string[] }
    const lines = [detail.message]
    if (detail.missing?.length) lines.push(`الأعمدة المفقودة: ${detail.missing.join("، ")}`)
    if (detail.errors?.length) lines.push(...detail.errors.slice(0, 8))
    if (detail.error_count && detail.error_count > 8) lines.push(`... ويوجد ${detail.error_count - 8} أخطاء أخرى`)
    return lines.filter(Boolean).join("\n") || "فشل الاستيراد"
  }
  return "فشل الاستيراد"
}

function downloadTemplate(kind: ImportKind) {
  const isUnits = kind === "units"
  const headers = isUnits ? ["اسم الوحدة", "رمز الوحدة", "نوع الوحدة", "الطابق", "المساحة م²"] : ["الكود", "التصنيف", "التخصص", "وصف البند", "الكمية الإجمالية", "سعر الوحدة", "وحدة القياس", "التسلسل"]
  const instructions = isUnits
    ? [["الهدف", "إضافة وحدات المشروع دفعة واحدة."], ["المطلوب", "اسم الوحدة، رمز الوحدة، نوع الوحدة."], ["اختياري", "الطابق والمساحة م²."], ["مهم", "لا تضع بنود BOQ في ملف الوحدات."]]
    : [["الهدف", "إضافة Master BOQ للمشروع؛ كل صف بند واحد على مستوى المشروع."], ["المطلوب", "التخصص، وصف البند، الكمية الإجمالية، وحدة القياس."], ["اختياري", "الكود، التصنيف، سعر الوحدة، التسلسل."], ["مهم", "لا تضع أسماء الوحدات/المستفيدين هنا. ربط BOQ بالوحدات يتم داخل FieldOps."]]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers])
  ws['!cols'] = headers.map(h => ({ wch: Math.max(18, Math.min(34, h.length + 8)) }))
  XLSX.utils.book_append_sheet(wb, ws, isUnits ? "Units" : "BOQ")
  const info = XLSX.utils.aoa_to_sheet([["FieldOps V4 — تعليمات الاستيراد"], ...instructions])
  info['!cols'] = [{ wch: 22 }, { wch: 90 }]
  XLSX.utils.book_append_sheet(wb, info, "تعليمات")
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" })
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a"); a.href = url; a.download = isUnits ? "FieldOps_Units_Import_Template.xlsx" : "FieldOps_BOQ_Import_Template.xlsx"; a.click(); URL.revokeObjectURL(url)
}

export function ExcelImportPanel({ projectId, onImported }: { projectId: string; onImported?: () => void }) {
  const { toast } = useToast()
  const fileRefs = { units: useRef<HTMLInputElement>(null), boq: useRef<HTMLInputElement>(null) }
  const [busy, setBusy] = useState<ImportKind | null>(null)
  const [error, setError] = useState("")

  const importFile = async (kind: ImportKind, file: File) => {
    setBusy(kind); setError("")
    try {
      const form = new FormData(); form.append("file", file)
      const send = () => fetch(`${API_BASE}/projects/${projectId}/import/${kind}`, {
        method: "POST", body: form, credentials: "include",
        headers: useAuthStore.getState().tokens?.accessToken ? { Authorization: `Bearer ${useAuthStore.getState().tokens!.accessToken}` } : undefined,
      })
      let response = await send()
      if (response.status === 401) { await useAuthStore.getState().refreshAccessToken(); response = await send() }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(errorText(data.detail || data.error))
      toast({ title: kind === "units" ? "تم استيراد الوحدات" : "تم استيراد جدول الكميات", description: data.message })
      onImported?.()
      window.dispatchEvent(new CustomEvent("fieldops:project-config-refresh"))
    } catch (e) {
      const message = e instanceof Error ? e.message : "فشل الاستيراد"
      setError(message); toast({ title: "فشل الاستيراد", description: message, variant: "destructive" })
    } finally { setBusy(null) }
  }

  const chooseFile = (kind: ImportKind) => fileRefs[kind].current?.click()
  const onFile = (kind: ImportKind, file?: File) => { if (file) void importFile(kind, file); if (fileRefs[kind].current) fileRefs[kind].current.value = "" }

  return <Card dir="rtl" className="border-emerald-100">
    <CardHeader className="pb-3">
      <div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><CardTitle>الاستيراد الجماعي عبر Excel</CardTitle></div>
      <CardDescription>نزّل النموذج، عبّئه كما هو، ثم ارفعه. الاستيراد يضيف الوحدات وMaster BOQ مباشرة إلى المشروع مع التحقق من التكرار والأخطاء قبل الحفظ.</CardDescription>
    </CardHeader>
    <CardContent className="grid md:grid-cols-2 gap-3">
      {(["units", "boq"] as ImportKind[]).map(kind => {
        const units = kind === "units"
        return <div key={kind} className="rounded-lg border p-3 space-y-3">
          <div><div className="font-semibold">{units ? "استيراد الوحدات" : "استيراد جدول الكميات BOQ"}</div><div className="text-xs text-muted-foreground mt-1">{units ? "اسم الوحدة، الرمز، النوع، الطابق، المساحة." : "الكود، التصنيف، التخصص، الوصف، الكمية، السعر، وحدة القياس."}</div></div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => downloadTemplate(kind)} className="gap-2"><Download className="h-4 w-4" />تحميل النموذج</Button>
            <Button type="button" onClick={() => chooseFile(kind)} disabled={busy !== null} className="gap-2"><Upload className="h-4 w-4" />{busy === kind && <Loader2 className="h-4 w-4 animate-spin" />}رفع واستيراد</Button>
            <input ref={fileRefs[kind]} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => onFile(kind, e.target.files?.[0])} />
          </div>
        </div>
      })}
      {error && <Alert variant="destructive" className="md:col-span-2 whitespace-pre-line"><AlertDescription>{error}</AlertDescription></Alert>}
    </CardContent>
  </Card>
}
