'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Loader2, Plus } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export interface ProjectCreationDialogProps {
  orgId: string
  onCreated?: () => void | Promise<void>
  compact?: boolean
}

export function ProjectCreationDialog({ orgId, onCreated, compact = false }: ProjectCreationDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [location, setLocation] = useState('')
  const [totalUnits, setTotalUnits] = useState('')
  const { toast } = useToast()
  const reset = () => { setName(''); setCode(''); setLocation(''); setTotalUnits('') }

  const handleSubmit = async () => {
    if (!name.trim() || !code.trim()) { toast({ title: 'خطأ', description: 'يرجى إدخال اسم المشروع ورمزه', variant: 'destructive' }); return }
    setLoading(true)
    try {
      const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, name: name.trim(), code: code.trim(), location: location.trim() || null, totalUnits: Number.parseInt(totalUnits, 10) || 0 }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'فشل في إنشاء المشروع')
      toast({ title: 'تم إنشاء المشروع', description: `تم إنشاء «${name.trim()}» بنجاح` })
      setOpen(false); reset(); await onCreated?.()
    } catch (error) { toast({ title: 'تعذر إنشاء المشروع', description: error instanceof Error ? error.message : 'حدث خطأ غير متوقع', variant: 'destructive' }) }
    finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size={compact ? 'sm' : 'default'} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" dir="rtl"><Plus className="h-4 w-4" />مشروع جديد</Button></DialogTrigger>
      <DialogContent className="sm:max-w-[480px]" dir="rtl">
        <DialogHeader><DialogTitle className="text-right text-lg font-bold">إنشاء مشروع جديد</DialogTitle><DialogDescription className="text-right">أدخل بيانات المشروع الأساسية. بعد الإنشاء يمكنك إعداد القواميس والوحدات وجدول الكميات.</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2"><Label className="block text-right">اسم المشروع *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="اسم المشروع" className="text-right" dir="rtl" /></div>
          <div className="space-y-2"><Label className="block text-right">رمز المشروع *</Label><Input value={code} onChange={e => setCode(e.target.value)} placeholder="PRJ-001" className="text-right font-mono" dir="rtl" /></div>
          <div className="space-y-2"><Label className="block text-right">الموقع</Label><Input value={location} onChange={e => setLocation(e.target.value)} placeholder="الموقع أو المنطقة" className="text-right" dir="rtl" /></div>
          <div className="space-y-2"><Label className="block text-right">عدد الوحدات المتوقع</Label><Input type="number" min="0" value={totalUnits} onChange={e => setTotalUnits(e.target.value)} placeholder="0" className="text-right" dir="rtl" /></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>إلغاء</Button><Button onClick={handleSubmit} disabled={loading || !name.trim() || !code.trim()} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">{loading && <Loader2 className="h-4 w-4 animate-spin" />}إنشاء المشروع</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
