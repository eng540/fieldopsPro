// FieldOps V4 — Media Upload Panel
// Arabic RTL interface for photo capture, upload, offline queue, and compression

'use client'

import React, { useState, useEffect, useCallback, useRef, type DragEvent, type ChangeEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Camera,
  Upload,
  ImagePlus,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  ImageIcon,
  Download,
  Eye,
} from 'lucide-react'
import { savePhotoToLocal, getPhotosForRemark, getPendingPhotos, type LocalPhoto, db } from '@/lib/offline-db'
import { useToast } from '@/hooks/use-toast'
import { useOnlineStatus } from '@/lib/sync-hooks'

// ============================================================
// Props Interface
// ============================================================

interface MediaUploadPanelProps {
  remarkId: string | null
  orgId: string
  onUploadComplete?: () => void
}

// ============================================================
// Photo Status Helpers
// ============================================================

type PhotoStatus = 'pending' | 'uploaded' | 'failed'

function getPhotoStatus(photo: LocalPhoto): PhotoStatus {
  if (photo.uploadedAt) return 'uploaded'
  if (photo.pendingSync) return 'pending'
  return 'failed'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ب`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleDateString('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  })
}

// ============================================================
// Component
// ============================================================

export function MediaUploadPanel({ remarkId, orgId, onUploadComplete }: MediaUploadPanelProps) {
  const isOnline = useOnlineStatus()
  const { toast } = useToast()

  // ---- State ----
  const [photos, setPhotos] = useState<LocalPhoto[]>([])
  const [pendingCount, setPendingCount] = useState<number>(0)
  const [uploading, setUploading] = useState<boolean>(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [isDragOver, setIsDragOver] = useState<boolean>(false)

  // Preview dialog
  const [previewPhoto, setPreviewPhoto] = useState<LocalPhoto | null>(null)
  const [previewOpen, setPreviewOpen] = useState<boolean>(false)

  // Refs for hidden file inputs
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- Load photos ----
  const loadPhotos = useCallback(async () => {
    if (!remarkId) {
      setPhotos([])
      setPendingCount(0)
      return
    }

    try {
      const [remarkPhotos, pending] = await Promise.all([
        getPhotosForRemark(remarkId),
        getPendingPhotos(),
      ])
      setPhotos(remarkPhotos)
      setPendingCount(pending.filter(p => p.remarkId === remarkId).length)
    } catch {
      // IndexedDB may not be available in SSR
    }
  }, [remarkId])

  // Refresh photos on remarkId change and after uploads
  useEffect(() => {
    let cancelled = false
    async function fetch() {
      if (!remarkId) {
        if (!cancelled) {
          setPhotos([])
          setPendingCount(0)
        }
        return
      }
      try {
        const [remarkPhotos, pending] = await Promise.all([
          getPhotosForRemark(remarkId),
          getPendingPhotos(),
        ])
        if (!cancelled) {
          setPhotos(remarkPhotos)
          setPendingCount(pending.filter(p => p.remarkId === remarkId).length)
        }
      } catch {
        // IndexedDB may not be available in SSR
      }
    }
    fetch()
    return () => { cancelled = true }
  }, [remarkId])

  // ---- Upload handler ----
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!remarkId) {
        toast({
          title: 'خطأ',
          description: 'لا يوجد ملاحظة مرتبطة لرفع الصور',
          variant: 'destructive',
        })
        return
      }

      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))

      if (imageFiles.length === 0) {
        toast({
          title: 'تنبيه',
          description: 'الرجاء اختيار ملفات صور فقط',
          variant: 'destructive',
        })
        return
      }

      setUploading(true)
      setUploadProgress(0)

      let savedCount = 0

      for (const file of imageFiles) {
        try {
          await savePhotoToLocal(remarkId, file)
          savedCount++
          setUploadProgress(Math.round((savedCount / imageFiles.length) * 100))
        } catch {
          toast({
            title: 'خطأ في الرفع',
            description: `فشل حفظ الصورة: ${file.name}`,
            variant: 'destructive',
          })
        }
      }

      setUploading(false)
      setUploadProgress(0)

      if (savedCount > 0) {
        toast({
          title: 'تم الحفظ',
          description: isOnline
            ? `تم رفع ${savedCount} صورة بنجاح`
            : `تم حفظ ${savedCount} صورة محلياً — ستُرفع عند الاتصال`,
        })

        await loadPhotos()
        onUploadComplete?.()
      }
    },
    [remarkId, isOnline, loadPhotos, onUploadComplete, toast]
  )

  // ---- Camera capture ----
  const handleCameraCapture = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFiles(files)
      }
      // Reset input so the same file can be re-captured
      e.target.value = ''
    },
    [handleFiles]
  )

  // ---- File picker ----
  const handleFilePick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFiles(files)
      }
      e.target.value = ''
    },
    [handleFiles]
  )

  // ---- Drag & drop ----
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles]
  )

  // ---- Delete photo ----
  const handleDeletePhoto = useCallback(
    async (photoId: string) => {
      try {
        await db.photos.delete(photoId)
        toast({
          title: 'تم الحذف',
          description: 'تم حذف الصورة بنجاح',
        })
        await loadPhotos()
      } catch {
        toast({
          title: 'خطأ',
          description: 'فشل حذف الصورة',
          variant: 'destructive',
        })
      }
    },
    [loadPhotos, toast]
  )

  // ---- Retry upload ----
  const handleRetryUpload = useCallback(
    async (photo: LocalPhoto) => {
      if (!remarkId) return

      try {
        // Re-add to sync queue
        await db.photos.update(photo.id, {
          pendingSync: true,
          uploadedAt: null,
        })

        toast({
          title: 'إعادة الرفع',
          description: 'تمت إضافة الصورة لطابور الرفع',
        })

        await loadPhotos()
      } catch {
        toast({
          title: 'خطأ',
          description: 'فشل إعادة محاولة الرفع',
          variant: 'destructive',
        })
      }
    },
    [remarkId, loadPhotos, toast]
  )

  // ---- Preview ----
  const openPreview = useCallback((photo: LocalPhoto) => {
    setPreviewPhoto(photo)
    setPreviewOpen(true)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewOpen(false)
    setPreviewPhoto(null)
  }, [])

  // ---- Computed values ----
  const pendingPhotos = photos.filter((p) => getPhotoStatus(p) === 'pending')
  const uploadedPhotos = photos.filter((p) => getPhotoStatus(p) === 'uploaded')
  const failedPhotos = photos.filter((p) => getPhotoStatus(p) === 'failed')

  // ============================================================
  // Render
  // ============================================================

  return (
    <div dir="rtl" className="space-y-4 w-full">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            وضع عدم الاتصال — الصور ستُحفظ محلياً وستُرفع عند الاتصال
          </span>
          {pendingCount > 0 && (
            <Badge variant="outline" className="mr-auto border-amber-300 text-amber-700 text-xs">
              {pendingCount} معلق
            </Badge>
          )}
        </div>
      )}

      {/* Upload Card */}
      <Card className="border-emerald-200 bg-white">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-emerald-800 flex items-center gap-2">
            <ImagePlus className="w-5 h-5 text-emerald-600" />
            رفع الصور
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Upload Method Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={!remarkId || uploading}
              className="flex-1 min-w-[140px] bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              <Camera className="w-4 h-4" />
              التقاط صورة
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={!remarkId || uploading}
              className="flex-1 min-w-[140px] border-emerald-300 text-emerald-700 hover:bg-emerald-50 gap-2"
            >
              <Upload className="w-4 h-4" />
              اختيار من المعرض
            </Button>
          </div>

          {/* Hidden inputs */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleCameraCapture}
            aria-label="التقاط صورة بالكاميرا"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFilePick}
            aria-label="اختيار صور من المعرض"
          />

          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              relative flex flex-col items-center justify-center gap-2
              rounded-xl border-2 border-dashed p-8 text-center transition-all cursor-pointer
              ${
                isDragOver
                  ? 'border-emerald-500 bg-emerald-50 scale-[1.01]'
                  : 'border-gray-300 bg-gray-50 hover:border-emerald-400 hover:bg-emerald-50/50'
              }
              ${!remarkId ? 'opacity-50 pointer-events-none' : ''}
            `}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="اسحب الصور هنا أو انقر للاختيار"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
          >
            <ImagePlus
              className={`w-10 h-10 ${
                isDragOver ? 'text-emerald-600' : 'text-gray-400'
              }`}
            />
            <p className={`text-sm font-medium ${isDragOver ? 'text-emerald-700' : 'text-gray-600'}`}>
              اسحب الصور هنا
            </p>
            <p className="text-xs text-gray-400">
              أو انقر للاختيار من الجهاز
            </p>
          </div>

          {/* Upload Progress */}
          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-emerald-700">
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  جاري الرفع...
                </span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Photos Banner */}
      {pendingPhotos.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-800">
                <Download className="w-4 h-4" />
                <span className="text-sm font-medium">
                  الصور المعلقة ({pendingPhotos.length})
                </span>
              </div>
              <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
                الرفع عند الاتصال
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Photo Queue */}
      {photos.length > 0 && (
        <Card className="border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-800 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-emerald-600" />
              الصور المرفوعة ({photos.length})
              {uploadedPhotos.length > 0 && (
                <Badge className="bg-emerald-100 text-emerald-700 text-xs border-0 mr-1">
                  {uploadedPhotos.length} مكتمل
                </Badge>
              )}
              {failedPhotos.length > 0 && (
                <Badge variant="destructive" className="text-xs mr-1">
                  {failedPhotos.length} فشل
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-96">
              <div className="px-4 pb-4 space-y-2">
                {photos.map((photo) => {
                  const status = getPhotoStatus(photo)
                  return (
                    <PhotoQueueItem
                      key={photo.id}
                      photo={photo}
                      status={status}
                      onPreview={openPreview}
                      onDelete={handleDeletePhoto}
                      onRetry={handleRetryUpload}
                    />
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* No remark selected state */}
      {!remarkId && (
        <Card className="border-gray-200 bg-gray-50">
          <CardContent className="p-6 text-center">
            <ImagePlus className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              اختر ملاحظة لرفع الصور المرتبطة بها
            </p>
          </CardContent>
        </Card>
      )}

      {/* Photo Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">معاينة الصورة</DialogTitle>
            <DialogDescription className="text-right">
              تفاصيل الصورة والبيانات الوصفية
            </DialogDescription>
          </DialogHeader>

          {previewPhoto && (
            <div className="space-y-4">
              {/* Full-size preview */}
              <div className="rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center max-h-[60vh]">
                <img
                  src={previewPhoto.base64}
                  alt="معاينة الصورة"
                  className="w-full h-full object-contain"
                />
              </div>

              <Separator />

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">حجم الصورة</p>
                  <p className="font-medium text-gray-900">
                    {formatFileSize(previewPhoto.base64.length * 0.75)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">مضغوط</p>
                  <p className="font-medium text-gray-900">
                    {previewPhoto.compressed ? (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        نعم
                      </span>
                    ) : (
                      <span className="text-gray-500">لا</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">حالة الرفع</p>
                  <p className="font-medium">
                    {getPhotoStatus(previewPhoto) === 'uploaded' && (
                      <span className="flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        مرفوع
                      </span>
                    )}
                    {getPhotoStatus(previewPhoto) === 'pending' && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <Loader2 className="w-3.5 h-3.5" />
                        معلق
                      </span>
                    )}
                    {getPhotoStatus(previewPhoto) === 'failed' && (
                      <span className="flex items-center gap-1 text-red-600">
                        <AlertCircle className="w-3.5 h-3.5" />
                        فشل
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">تاريخ الإنشاء</p>
                  <p className="font-medium text-gray-900">
                    {formatTimestamp(previewPhoto.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={closePreview}
              className="border-gray-300"
            >
              إغلاق
            </Button>
            {previewPhoto && getPhotoStatus(previewPhoto) === 'failed' && (
              <Button
                type="button"
                onClick={() => {
                  handleRetryUpload(previewPhoto)
                  closePreview()
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                إعادة المحاولة
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================
// Photo Queue Item Sub-component
// ============================================================

interface PhotoQueueItemProps {
  photo: LocalPhoto
  status: PhotoStatus
  onPreview: (photo: LocalPhoto) => void
  onDelete: (photoId: string) => void
  onRetry: (photo: LocalPhoto) => void
}

function PhotoQueueItem({ photo, status, onPreview, onDelete, onRetry }: PhotoQueueItemProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 transition-colors group">
      {/* Thumbnail */}
      <button
        type="button"
        onClick={() => onPreview(photo)}
        className="shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
        aria-label="معاينة الصورة"
      >
        <img
          src={photo.base64}
          alt="صورة مصغرة"
          className="w-full h-full object-cover"
        />
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {/* Status Badge */}
          {status === 'uploaded' && (
            <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs px-1.5 py-0">
              <CheckCircle2 className="w-3 h-3 ml-0.5" />
              مرفوع
            </Badge>
          )}
          {status === 'pending' && (
            <Badge className="bg-amber-100 text-amber-700 border-0 text-xs px-1.5 py-0">
              <Loader2 className="w-3 h-3 ml-0.5" />
              معلق
            </Badge>
          )}
          {status === 'failed' && (
            <Badge variant="destructive" className="text-xs px-1.5 py-0">
              <AlertCircle className="w-3 h-3 ml-0.5" />
              فشل
            </Badge>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate">
          حجم الصورة: {formatFileSize(photo.base64.length * 0.75)}
          {photo.compressed && (
            <span className="text-emerald-600 mr-1">• مضغوط</span>
          )}
        </p>
        <p className="text-xs text-gray-400">
          {formatTimestamp(photo.createdAt)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onPreview(photo)}
          className="h-8 w-8 p-0 text-gray-400 hover:text-emerald-600"
          aria-label="عرض الصورة"
        >
          <Eye className="w-4 h-4" />
        </Button>

        {status === 'failed' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRetry(photo)}
            className="h-8 w-8 p-0 text-gray-400 hover:text-amber-600"
            aria-label="إعادة المحاولة"
          >
            <Upload className="w-4 h-4" />
          </Button>
        )}

        {status !== 'uploaded' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDelete(photo.id)}
            className="h-8 w-8 p-0 text-gray-400 hover:text-red-600"
            aria-label="حذف الصورة"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
