// FieldOps V4 — Bulk Import Screen
// Enhanced Excel/CSV import with drag-and-drop, column mapping, preview, and offline support

'use client'

import React, { useState, useCallback, useRef, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import {
  Upload, Download, FileSpreadsheet, FileUp, ArrowLeft, ArrowRight,
  Check, X, AlertTriangle, Loader2, CheckCircle2, XCircle,
  AlertCircle, WifiOff, FileText, Sheet, RefreshCw, Trash2, Eye
} from 'lucide-react'
import { db as offlineDb } from '@/lib/offline-db'

// ============================================================
// Types
// ============================================================

interface ProjectData {
  id: string; orgId: string; name: string; code: string; status: string;
  location: string | null; totalUnits: number; completionPct: number; isActive: boolean;
  units: UnitData[]; assignments: { user: { id: string; name: string; email: string }; role: { name: string } }[]
}

interface UnitData {
  id: string; orgId: string; projectId: string; name: string; code: string;
  unitType: string; floor: string | null; areaSqm: number | null; status: string;
  completionPct: number; boqItems: BoqItemData[]
}

interface BoqItemData {
  id: string; orgId: string; unitId: string; trade: string; description: string;
  quantity: number; unitOfMeasure: string; completionPct: number
}

interface BulkImportScreenProps {
  project: ProjectData | null
  orgId: string
  onRefresh: () => void
}

type ImportStep = 'upload' | 'sheet' | 'mapping' | 'preview' | 'importing' | 'summary'

interface RowError {
  row: number
  message: string
}

interface ImportSummary {
  created: number
  updated: number
  errors: RowError[]
  total: number
}

// ============================================================
// Constants
// ============================================================

const SYSTEM_FIELDS = [
  { key: 'unitName', label: 'اسم الوحدة', required: true },
  { key: 'unitCode', label: 'رمز الوحدة', required: true },
  { key: 'unitType', label: 'نوع الوحدة', required: false },
  { key: 'floor', label: 'الطابق', required: false },
  { key: 'areaSqm', label: 'المساحة (م²)', required: false },
  { key: 'trade', label: 'التخصص', required: true },
  { key: 'description', label: 'الوصف', required: true },
  { key: 'quantity', label: 'الكمية', required: true },
  { key: 'unitOfMeasure', label: 'وحدة القياس', required: true },
  { key: 'completionPct', label: 'نسبة الإنجاز', required: false },
]

const UNIT_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'COMMON', 'VILLA', 'APARTMENT', 'OFFICE']

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// ============================================================
// Component
// ============================================================

export function BulkImportScreen({ project, orgId, onRefresh }: BulkImportScreenProps) {
  const { toast } = useToast()

  // Step state
  const [step, setStep] = useState<ImportStep>('upload')

  // File state
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // Sheet state
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [selectedSheet, setSelectedSheet] = useState<string>('')

  // Data state
  const [rawData, setRawData] = useState<Record<string, string>[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})

  // Import state
  const [importProgress, setImportProgress] = useState(0)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [rowErrors, setRowErrors] = useState<RowError[]>([])

  // Offline save state
  const [savedLocally, setSavedLocally] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ============================================================
  // File Validation
  // ============================================================

  const validateFile = useCallback((f: File): string | null => {
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return 'صيغة الملف غير مدعومة. يُرجى استخدام .xlsx أو .xls أو .csv'
    }
    if (f.size > MAX_FILE_SIZE) {
      return 'حجم الملف يتجاوز الحد المسموح (10 ميجابايت)'
    }
    return null
  }, [])

  // ============================================================
  // File Processing
  // ============================================================

  const processFile = useCallback(async (uploadedFile: File, sheetName?: string) => {
    setIsProcessing(true)
    setFileError(null)

    try {
      const ext = uploadedFile.name.split('.').pop()?.toLowerCase()

      if (ext === 'csv') {
        const Papa = (await import('papaparse')).default
        const text = await uploadedFile.text()
        const result = Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
        })

        const parsedData = result.data as Record<string, string>[]
        if (parsedData.length === 0) {
          setFileError('الملف فارغ أو لا يحتوي على بيانات صالحة')
          setIsProcessing(false)
          return
        }

        const fileHeaders = result.meta.fields || Object.keys(parsedData[0])
        setHeaders(fileHeaders)
        setRawData(parsedData)
        setSheetNames([])
        autoMapColumns(fileHeaders)
        setStep('mapping')
      } else {
        const XLSX = await import('xlsx')
        const arrayBuffer = await uploadedFile.arrayBuffer()
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })

        const sheets = workbook.SheetNames
        setSheetNames(sheets)

        const targetSheet = sheetName || sheets[0]
        setSelectedSheet(targetSheet)

        if (sheets.length > 1 && !sheetName) {
          setStep('sheet')
          setIsProcessing(false)
          return
        }

        const worksheet = workbook.Sheets[targetSheet]
        const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet, { defval: '' })

        if (jsonData.length === 0) {
          setFileError('الورقة المحددة فارغة أو لا تحتوي على بيانات صالحة')
          setIsProcessing(false)
          return
        }

        const fileHeaders = Object.keys(jsonData[0])
        setHeaders(fileHeaders)
        setRawData(jsonData)
        autoMapColumns(fileHeaders)
        setStep('mapping')
      }
    } catch (err) {
      console.error('Parse error:', err)
      setFileError('فشل في قراءة الملف. تأكد من صيغة الملف والمحتوى')
    } finally {
      setIsProcessing(false)
    }
  }, [])

  // ============================================================
  // Auto Column Mapping
  // ============================================================

  const autoMapColumns = useCallback((fileHeaders: string[]) => {
    const mapping: Record<string, string> = {}
    fileHeaders.forEach(header => {
      const lower = header.toLowerCase().trim()
      if (lower.includes('unit') && lower.includes('name') || lower.includes('اسم') && lower.includes('وحدة') || lower === 'اسم الوحدة') mapping[header] = 'unitName'
      else if (lower.includes('unit') && lower.includes('code') || lower.includes('رمز') && lower.includes('وحدة') || lower === 'رمز الوحدة') mapping[header] = 'unitCode'
      else if (lower.includes('type') || lower.includes('نوع') && lower.includes('وحدة') || lower === 'نوع الوحدة') mapping[header] = 'unitType'
      else if (lower.includes('floor') || lower.includes('طابق') || lower === 'الطابق') mapping[header] = 'floor'
      else if (lower.includes('area') || lower.includes('مساحة') || lower.includes('مساحة')) mapping[header] = 'areaSqm'
      else if (lower.includes('trade') || lower.includes('تخصص') || lower.includes('بنود') || lower === 'التخصص') mapping[header] = 'trade'
      else if (lower.includes('desc') || lower.includes('وصف') || lower.includes('بيان') || lower === 'الوصف') mapping[header] = 'description'
      else if (lower.includes('qty') || lower.includes('كمية') || lower.includes('عدد') || lower === 'الكمية') mapping[header] = 'quantity'
      else if (lower.includes('measure') || lower.includes('وحدة') && lower.includes('قياس') || lower === 'وحدة القياس') mapping[header] = 'unitOfMeasure'
      else if (lower.includes('progress') || lower.includes('completion') || lower.includes('إنجاز') || lower.includes('نسبة') || lower === 'نسبة الإنجاز') mapping[header] = 'completionPct'
    })
    setColumnMapping(mapping)
  }, [])

  // ============================================================
  // Drag & Drop Handlers
  // ============================================================

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      const error = validateFile(droppedFile)
      if (error) {
        setFileError(error)
        return
      }
      setFile(droppedFile)
      processFile(droppedFile)
    }
  }, [validateFile, processFile])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      const error = validateFile(selectedFile)
      if (error) {
        setFileError(error)
        return
      }
      setFile(selectedFile)
      processFile(selectedFile)
    }
  }, [validateFile, processFile])

  // ============================================================
  // Sheet Selection
  // ============================================================

  const handleSheetSelect = useCallback((sheetName: string) => {
    setSelectedSheet(sheetName)
    if (file) {
      processFile(file, sheetName)
    }
  }, [file, processFile])

  // ============================================================
  // Preview Data
  // ============================================================

  const previewData = useMemo(() => {
    return rawData.slice(0, 10).map(row => {
      const mapped: Record<string, string> = {}
      Object.entries(columnMapping).forEach(([excelCol, systemField]) => {
        if (systemField) mapped[systemField] = row[excelCol] || ''
      })
      return mapped
    })
  }, [rawData, columnMapping])

  const mappedFields = useMemo(() => {
    return SYSTEM_FIELDS.filter(f => Object.values(columnMapping).includes(f.key))
  }, [columnMapping])

  // ============================================================
  // Import Logic
  // ============================================================

  const handleImport = useCallback(async () => {
    if (!project) return

    setStep('importing')
    setImportProgress(0)
    setRowErrors([])
    setSavedLocally(false)

    const mappedData = rawData.map(row => {
      const mapped: Record<string, string> = {}
      Object.entries(columnMapping).forEach(([excelCol, systemField]) => {
        if (systemField) mapped[systemField] = row[excelCol] || ''
      })
      return mapped
    })

    const totalRows = mappedData.length
    let created = 0
    let updated = 0
    const errors: RowError[] = []

    // Group rows by unit code
    const unitGroups: Record<string, typeof mappedData> = {}
    mappedData.forEach((row, idx) => {
      const unitCode = row.unitCode || ''
      if (!unitCode) {
        errors.push({ row: idx + 1, message: 'رمز الوحدة مفقود' })
        return
      }
      if (!unitGroups[unitCode]) unitGroups[unitCode] = []
      unitGroups[unitCode].push(row)
    })

    // Try to save locally first (offline support)
    try {
      for (const [unitCode, rows] of Object.entries(unitGroups)) {
        const firstRow = rows[0]
        const unitId = `unit-import-${Date.now()}-${unitCode.replace(/\s+/g, '-')}`

        // Save unit to offline DB
        await offlineDb.units.put({
          id: unitId,
          orgId,
          projectId: project.id,
          name: firstRow.unitName || unitCode,
          code: unitCode,
          unitType: firstRow.unitType || 'RESIDENTIAL',
          floor: firstRow.floor || null,
          areaSqm: firstRow.areaSqm ? parseFloat(firstRow.areaSqm) : null,
          status: 'NOT_STARTED',
          completionPct: 0,
          lastSyncedAt: Date.now(),
        })

        // Save BoQ items to offline DB
        for (const r of rows) {
          await offlineDb.boqItems.put({
            id: `boq-import-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            orgId,
            unitId,
            trade: r.trade || '',
            description: r.description || '',
            quantity: parseFloat(r.quantity) || 0,
            unitOfMeasure: r.unitOfMeasure || 'UNIT',
            completionPct: parseFloat(r.completionPct) || 0,
            lastSyncedAt: Date.now(),
          })
        }
      }
      setSavedLocally(true)
    } catch (err) {
      console.warn('Local save warning:', err)
    }

    // Process each unit group
    const unitCodes = Object.keys(unitGroups)
    for (let i = 0; i < unitCodes.length; i++) {
      const unitCode = unitCodes[i]
      const rows = unitGroups[unitCode]
      const firstRow = rows[0]

      try {
        // Check if unit already exists
        const existingUnit = project.units?.find(u => u.code === unitCode)

        if (existingUnit) {
          // Add BoQ items to existing unit
          for (const row of rows) {
            const boqPayload = {
              orgId,
              unitId: existingUnit.id,
              trade: row.trade || '',
              description: row.description || '',
              quantity: parseFloat(row.quantity) || 0,
              unitOfMeasure: row.unitOfMeasure || 'UNIT',
              completionPct: parseFloat(row.completionPct) || 0,
            }

            try {
              const res = await fetch('/api/units', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boqItem: boqPayload }),
              })
              if (res.ok) {
                updated++
              } else {
                const errData = await res.json().catch(() => ({}))
                errors.push({ row: i + 1, message: errData.error || `فشل إضافة بند لوحدة ${unitCode}` })
              }
            } catch {
              errors.push({ row: i + 1, message: `خطأ شبكة لوحدة ${unitCode}` })
            }
          }
        } else {
          // Create new unit with BoQ items
          const unitPayload = {
            orgId,
            projectId: project.id,
            name: firstRow.unitName || unitCode,
            code: unitCode,
            unitType: firstRow.unitType || 'RESIDENTIAL',
            floor: firstRow.floor || null,
            areaSqm: firstRow.areaSqm ? parseFloat(firstRow.areaSqm) : null,
            boqItems: rows.map(r => ({
              trade: r.trade || '',
              description: r.description || '',
              quantity: parseFloat(r.quantity) || 0,
              unitOfMeasure: r.unitOfMeasure || 'UNIT',
              completionPct: parseFloat(r.completionPct) || 0,
            })),
          }

          try {
            const res = await fetch('/api/units', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ unit: unitPayload }),
            })
            if (res.ok) {
              created++
            } else {
              const errData = await res.json().catch(() => ({}))
              errors.push({ row: i + 1, message: errData.error || `فشل إنشاء وحدة ${unitCode}` })
            }
          } catch {
            errors.push({ row: i + 1, message: `خطأ شبكة لوحدة ${unitCode}` })
          }
        }
      } catch (err) {
        errors.push({ row: i + 1, message: `خطأ غير متوقع: ${String(err)}` })
      }

      // Update progress
      setImportProgress(Math.round(((i + 1) / unitCodes.length) * 100))
    }

    setImportSummary({
      created,
      updated,
      errors,
      total: totalRows,
    })
    setRowErrors(errors)
    setStep('summary')
    onRefresh()
  }, [project, orgId, rawData, columnMapping, onRefresh])

  // ============================================================
  // Download Template
  // ============================================================

  const handleDownloadTemplate = useCallback(async () => {
    const XLSX = await import('xlsx')
    const templateData = [
      {
        'اسم الوحدة': 'وحدة A-101',
        'رمز الوحدة': 'A-101',
        'نوع الوحدة': 'RESIDENTIAL',
        'الطابق': 'الأول',
        'المساحة (م²)': '120',
        'التخصص': 'أعمال الخرسانة',
        'الوصف': 'أعمال الخرسانة المسلحة للأسقف',
        'الكمية': '50',
        'وحدة القياس': 'م³',
        'نسبة الإنجاز': '0',
      },
      {
        'اسم الوحدة': 'وحدة A-101',
        'رمز الوحدة': 'A-101',
        'نوع الوحدة': 'RESIDENTIAL',
        'الطابق': 'الأول',
        'المساحة (م²)': '120',
        'التخصص': 'أعمال التشطيب',
        'الوصف': 'أعمال الدهان الداخلي',
        'الكمية': '200',
        'وحدة القياس': 'م²',
        'نسبة الإنجاز': '0',
      },
      {
        'اسم الوحدة': 'وحدة A-102',
        'رمز الوحدة': 'A-102',
        'نوع الوحدة': 'RESIDENTIAL',
        'الطابق': 'الأول',
        'المساحة (م²)': '95',
        'التخصص': 'أعمال السباكة',
        'الوصف': 'تمديدات السباكة الداخلية',
        'الكمية': '8',
        'وحدة القياس': 'نقطة',
        'نسبة الإنجاز': '0',
      },
    ]

    const ws = XLSX.utils.json_to_sheet(templateData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'قالب الاستيراد')
    XLSX.writeFile(wb, 'fieldops-import-template.xlsx')
  }, [])

  // ============================================================
  // Reset
  // ============================================================

  const handleReset = useCallback(() => {
    setStep('upload')
    setFile(null)
    setRawData([])
    setHeaders([])
    setColumnMapping({})
    setSheetNames([])
    setSelectedSheet('')
    setImportProgress(0)
    setImportSummary(null)
    setRowErrors([])
    setFileError(null)
    setSavedLocally(false)
  }, [])

  // ============================================================
  // Step indicator
  // ============================================================

  const steps: { key: ImportStep; label: string }[] = [
    { key: 'upload', label: 'رفع الملف' },
    { key: 'sheet', label: 'اختيار الورقة' },
    { key: 'mapping', label: 'ربط الأعمدة' },
    { key: 'preview', label: 'معاينة' },
    { key: 'importing', label: 'استيراد' },
    { key: 'summary', label: 'الملخص' },
  ]

  const stepOrder = ['upload', 'sheet', 'mapping', 'preview', 'importing', 'summary']
  const currentStepIndex = stepOrder.indexOf(step)

  // Required fields check
  const mappedRequiredFields = SYSTEM_FIELDS.filter(f => f.required && Object.values(columnMapping).includes(f.key))
  const allRequiredMapped = SYSTEM_FIELDS.filter(f => f.required).length === mappedRequiredFields.length

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">الاستيراد من Excel</h2>
          <p className="text-sm text-gray-500 mt-1">
            استيراد بيانات الوحدات وبنود الكميات من ملفات Excel و CSV
            {project && (
              <span className="text-emerald-600 font-medium"> — {project.name}</span>
            )}
          </p>
        </div>
        {step !== 'upload' && (
          <Button variant="outline" size="sm" onClick={handleReset} className="text-xs">
            <RefreshCw className="w-3.5 h-3.5 ml-1" />
            بدء من جديد
          </Button>
        )}
      </div>

      {/* Steps Indicator */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {steps.filter(s => s.key !== 'sheet' || sheetNames.length > 1).map((s, i) => {
          const sIdx = stepOrder.indexOf(s.key)
          const isActive = step === s.key
          const isCompleted = currentStepIndex > sIdx
          return (
            <React.Fragment key={s.key}>
              {i > 0 && (
                <div className={`h-0.5 flex-1 min-w-[20px] ${isCompleted || isActive ? 'bg-emerald-500' : 'bg-gray-200'}`} />
              )}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                isActive ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                isCompleted ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  isCompleted ? 'bg-emerald-500 text-white' : 'bg-current bg-opacity-20'
                }`}>
                  {isCompleted ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                {s.label}
              </div>
            </React.Fragment>
          )
        })}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <Card>
          <CardContent className="p-6">
            {/* Drag & Drop Zone */}
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200 ${
                isDragging
                  ? 'border-emerald-400 bg-emerald-50 scale-[1.01]'
                  : 'border-gray-300 hover:border-gray-400 bg-gray-50/50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {isProcessing ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mb-4" />
                  <p className="text-sm text-gray-600 font-medium">جاري معالجة الملف...</p>
                  <p className="text-xs text-gray-500 mt-1">يتم قراءة وتحليل البيانات</p>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <FileUp className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">اسحب الملف هنا أو اختر من الجهاز</h3>
                  <p className="text-sm text-gray-500 mb-4">يدعم ملفات .xlsx و .xls و .csv — الحد الأقصى 10 ميجابايت</p>
                  <label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    <Button variant="outline" className="cursor-pointer" asChild>
                      <span>
                        <Upload className="w-4 h-4 ml-1" />
                        اختر ملف
                      </span>
                    </Button>
                  </label>
                </>
              )}
            </div>

            {/* File Error */}
            {fileError && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{fileError}</AlertDescription>
              </Alert>
            )}

            {/* Download Template */}
            <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Download className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <span className="text-sm text-blue-800 font-medium">تحميل قالب الاستيراد</span>
                    <p className="text-xs text-blue-600 mt-0.5">استخدم القالب لضمان توافق الأعمدة مع النظام</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="text-xs border-blue-300 text-blue-700 hover:bg-blue-100" onClick={handleDownloadTemplate}>
                  <Download className="w-3.5 h-3.5 ml-1" />
                  تحميل القالب
                </Button>
              </div>
            </div>

            {/* Offline Notice */}
            <div className="mt-4 flex items-center gap-2 text-xs text-amber-600">
              <WifiOff className="w-3.5 h-3.5" />
              <span>يدعم العمل بدون اتصال — البيانات ستُحفظ محلياً وتُزامن لاحقاً</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Sheet Selection */}
      {step === 'sheet' && sheetNames.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sheet className="w-5 h-5 text-emerald-600" />
              اختر ورقة العمل
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              تم العثور على <strong>{sheetNames.length}</strong> أوراق عمل في الملف. اختر الورقة التي تريد استيرادها:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {sheetNames.map(name => (
                <button
                  key={name}
                  onClick={() => handleSheetSelect(name)}
                  className={`p-4 rounded-lg border-2 text-center transition-all hover:shadow-md ${
                    selectedSheet === name
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <Sheet className="w-6 h-6 mx-auto mb-2 text-gray-500" />
                  <p className="text-sm font-medium text-gray-900">{name}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-start">
              <Button variant="outline" onClick={handleReset}>
                <ArrowRight className="w-4 h-4 ml-1" />
                رجوع
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Column Mapping */}
      {step === 'mapping' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              ربط الأعمدة — Column Mapping
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">اربط أعمدة ملف Excel مع حقول النظام — {rawData.length} سجل</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              {headers.map(header => (
                <div key={header} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <div className="w-48 text-sm font-medium text-gray-700 flex-shrink-0">
                    <span className="text-gray-500">عمود Excel:</span>{' '}
                    <span className="text-gray-900">{header}</span>
                  </div>
                  <ArrowLeft className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <Select
                    value={columnMapping[header] || '__skip__'}
                    onValueChange={val => setColumnMapping(prev => ({ ...prev, [header]: val === '__skip__' ? '' : val }))}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="اختر حقل النظام" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__skip__">— تخطي —</SelectItem>
                      {SYSTEM_FIELDS.map(field => (
                        <SelectItem key={field.key} value={field.key}>
                          {field.label}
                          {field.required && <span className="text-red-500 mr-1">*</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-gray-500 flex-1 truncate">
                    معاينة: <span className="font-mono text-gray-700">{rawData[0]?.[header] == null || String(rawData[0][header]).trim() === '' ? '—' : String(rawData[0][header]).slice(0, 40)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Required fields notice */}
            {!allRequiredMapped && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  يُرجى ربط جميع الحقول المطلوبة ({SYSTEM_FIELDS.filter(f => f.required).map(f => f.label).join('، ')})
                </AlertDescription>
              </Alert>
            )}

            <Separator />
            <div className="flex justify-between">
              <Button variant="outline" onClick={handleReset}>
                <ArrowRight className="w-4 h-4 ml-1" />
                رجوع
              </Button>
              <Button
                onClick={() => setStep('preview')}
                disabled={!Object.values(columnMapping).some(v => v)}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                التالي
                <ArrowLeft className="w-4 h-4 mr-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Preview */}
      {step === 'preview' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Eye className="w-5 h-5 text-emerald-600" />
                  معاينة البيانات قبل الاعتماد
                </CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                  عرض أول {Math.min(rawData.length, 10)} من أصل {rawData.length} سجل
                </p>
              </div>
              <Badge variant="outline" className="text-xs bg-emerald-50 border-emerald-200 text-emerald-700">
                {rawData.length} سجل
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-96">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">#</TableHead>
                      {mappedFields.map(f => (
                        <TableHead key={f.key} className="text-xs">
                          {f.label}
                          {f.required && <span className="text-red-500 mr-0.5">*</span>}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.map((row, i) => (
                      <TableRow key={i} className="hover:bg-gray-50">
                        <TableCell className="text-xs text-gray-500">{i + 1}</TableCell>
                        {mappedFields.map(f => (
                          <TableCell key={f.key} className="text-xs">
                            {row[f.key] || <span className="text-gray-300">—</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
            {rawData.length > 10 && (
              <p className="text-xs text-gray-500 mt-2 text-center">
                و {rawData.length - 10} سجل آخر...
              </p>
            )}

            <Separator className="my-4" />
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('mapping')}>
                <ArrowRight className="w-4 h-4 ml-1" />
                رجوع
              </Button>
              <Button
                onClick={handleImport}
                disabled={!allRequiredMapped || !project}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Check className="w-4 h-4 ml-1" />
                اعتماد الاستيراد ({rawData.length} سجل)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Importing */}
      {step === 'importing' && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">جاري الاستيراد...</h3>
            <p className="text-sm text-gray-500 mb-6">يتم معالجة البيانات وحفظها</p>
            <div className="max-w-md mx-auto space-y-3">
              <Progress value={importProgress} className="h-3" />
              <p className="text-sm font-medium text-emerald-700">{importProgress}%</p>
            </div>
            {savedLocally && (
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-amber-600">
                <WifiOff className="w-3.5 h-3.5" />
                <span>تم الحفظ محلياً — سيتم المزامنة عند الاتصال</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 6: Summary */}
      {step === 'summary' && importSummary && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-emerald-200 bg-emerald-50/50">
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <p className="text-2xl font-bold text-emerald-800">{importSummary.created}</p>
                <p className="text-xs text-emerald-600 font-medium">وحدة جديدة</p>
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <RefreshCw className="w-5 h-5 text-blue-600" />
                </div>
                <p className="text-2xl font-bold text-blue-800">{importSummary.updated}</p>
                <p className="text-xs text-blue-600 font-medium">بند مُحدّث</p>
              </CardContent>
            </Card>

            <Card className="border-red-200 bg-red-50/50">
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <XCircle className="w-5 h-5 text-red-600" />
                </div>
                <p className="text-2xl font-bold text-red-800">{importSummary.errors.length}</p>
                <p className="text-xs text-red-600 font-medium">خطأ</p>
              </CardContent>
            </Card>

            <Card className="border-gray-200 bg-gray-50/50">
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <FileText className="w-5 h-5 text-gray-600" />
                </div>
                <p className="text-2xl font-bold text-gray-800">{importSummary.total}</p>
                <p className="text-xs text-gray-600 font-medium">إجمالي السجلات</p>
              </CardContent>
            </Card>
          </div>

          {/* Offline Notice */}
          {savedLocally && (
            <Alert className="border-amber-200 bg-amber-50">
              <WifiOff className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                تم حفظ البيانات محلياً — سيتم مزامنتها مع الخادم عند استعادة الاتصال
              </AlertDescription>
            </Alert>
          )}

          {/* Row Errors */}
          {rowErrors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-red-700">
                  <AlertTriangle className="w-5 h-5" />
                  أخطاء الاستيراد
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-64">
                  <div className="space-y-2">
                    {rowErrors.map((err, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border border-red-100">
                        <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-red-800">صف {err.row}</p>
                          <p className="text-xs text-red-600">{err.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={handleReset}>
              <RefreshCw className="w-4 h-4 ml-1" />
              استيراد ملف آخر
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={onRefresh}>
              <Check className="w-4 h-4 ml-1" />
              العودة للرئيسية
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
