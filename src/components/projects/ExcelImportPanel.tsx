"use client"

import { useRef, useState } from "react"
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
            <a href={units ? "/templates/FieldOps_Units_Import_Template.xlsx" : "/templates/FieldOps_BOQ_Import_Template.xlsx"} download className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"><Download className="h-4 w-4" />تحميل النموذج</a>
            <Button type="button" onClick={() => chooseFile(kind)} disabled={busy !== null} className="gap-2"><Upload className="h-4 w-4" />{busy === kind && <Loader2 className="h-4 w-4 animate-spin" />}رفع واستيراد</Button>
            <input ref={fileRefs[kind]} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => onFile(kind, e.target.files?.[0])} />
          </div>
        </div>
      })}
      {error && <Alert variant="destructive" className="md:col-span-2 whitespace-pre-line"><AlertDescription>{error}</AlertDescription></Alert>}
    </CardContent>
  </Card>
}
