// FieldOps V4 — Dictionary Screen
// Enhanced BoQ Dictionary Management with Category Filter, Items Table, and Arabic RTL

'use client'

import React, { useState, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogTrigger, DialogDescription
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  BookOpen, Plus, Search, Filter, Trash2, Eye, Loader2,
  ChevronDown, ChevronUp, WifiOff, List, Package, X,
  AlertCircle, FileText, ArrowRight, Building2, Ruler, Hash
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { addToSyncQueue, db } from '@/lib/offline-db'

// ============================================================
// Types
// ============================================================

interface DictionaryData {
  id: string; orgId: string; name: string; category: string; description: string | null;
  isActive: boolean; createdBy: string | null; items: DictionaryItemData[]
}

interface DictionaryItemData {
  id: string; dictionaryId: string; trade: string; description: string;
  quantity: number; unitOfMeasure: string; sortOrder: number
}

interface DictionaryScreenProps {
  dictionaries: DictionaryData[]
  orgId: string
  onRefresh: () => void
}

// ============================================================
// Constants
// ============================================================

const CATEGORY_LABELS: Record<string, string> = {
  BATHROOM: 'حمام',
  WELL: 'بئر',
  SHELTER: 'مأوى',
  RESIDENTIAL: 'سكني',
  COMMERCIAL: 'تجاري',
  KITCHEN: 'مطبخ',
  GENERAL: 'عام',
}

const CATEGORY_COLORS: Record<string, string> = {
  BATHROOM: 'bg-blue-100 text-blue-800 border-blue-200',
  WELL: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  SHELTER: 'bg-amber-100 text-amber-800 border-amber-200',
  RESIDENTIAL: 'bg-purple-100 text-purple-800 border-purple-200',
  COMMERCIAL: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  KITCHEN: 'bg-orange-100 text-orange-800 border-orange-200',
  GENERAL: 'bg-gray-100 text-gray-800 border-gray-200',
}

const CATEGORIES = [
  { id: 'BATHROOM', name: 'BATHROOM' },
  { id: 'WELL', name: 'WELL' },
  { id: 'SHELTER', name: 'SHELTER' },
  { id: 'RESIDENTIAL', name: 'RESIDENTIAL' },
  { id: 'COMMERCIAL', name: 'COMMERCIAL' },
  { id: 'KITCHEN', name: 'KITCHEN' },
  { id: 'GENERAL', name: 'GENERAL' },
]

const UNIT_OPTIONS = [
  { value: 'm²', label: 'متر مربع (m²)' },
  { value: 'm', label: 'متر طولي (m)' },
  { value: 'm³', label: 'متر مكعب (m³)' },
  { value: 'kg', label: 'كيلوغرام (kg)' },
  { value: 'unit', label: 'وحدة (unit)' },
  { value: 'set', label: 'مجموعة (set)' },
  { value: 'lot', label: 'دفعة (lot)' },
  { value: 'ls', label: 'مبلغ مقطوع (ls)' },
]

// ============================================================
// DictionaryScreen Component
// ============================================================

export function DictionaryScreen({ dictionaries, orgId, onRefresh }: DictionaryScreenProps) {
  const { toast } = useToast()

  // State
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [selectedDict, setSelectedDict] = useState<DictionaryData | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showAddItemDialog, setShowAddItemDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [showDeleteItemConfirm, setShowDeleteItemConfirm] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [expandedDict, setExpandedDict] = useState<string | null>(null)

  // Create dictionary form
  const [newDict, setNewDict] = useState({
    name: '',
    category: 'GENERAL',
    description: '',
    items: [] as Array<{ trade: string; description: string; quantity: number; unitOfMeasure: string; sortOrder: number }>,
  })

  // Add item form
  const [newItem, setNewItem] = useState({
    trade: '',
    description: '',
    quantity: 1,
    unitOfMeasure: 'unit',
    sortOrder: 0,
  })

  // Filtered dictionaries
  const filteredDictionaries = useMemo(() => {
    return dictionaries.filter(d => {
      const matchesSearch = d.name.includes(searchTerm) || (d.description || '').includes(searchTerm)
      const matchesCategory = categoryFilter === 'ALL' || d.category === categoryFilter
      return matchesSearch && matchesCategory
    })
  }, [dictionaries, searchTerm, categoryFilter])

  // Stats
  const totalItems = dictionaries.reduce((sum, d) => sum + d.items.length, 0)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    dictionaries.forEach(d => {
      counts[d.category] = (counts[d.category] || 0) + 1
    })
    return counts
  }, [dictionaries])

  // Create dictionary handler
  const handleCreateDictionary = useCallback(async () => {
    if (!newDict.name || !newDict.category) {
      toast({ title: 'خطأ', description: 'يرجى ملء اسم القاموس والفئة', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      // Save locally first
      const localDictId = `dict-local-${Date.now()}-${Math.random().toString(36).substring(7)}`
      await db.dictionaries.put({
        id: localDictId,
        orgId,
        name: newDict.name,
        category: newDict.category,
        description: newDict.description || null,
        isActive: true,
        items: JSON.stringify(newDict.items),
        lastSyncedAt: Date.now(),
      })

      // Add to sync queue
      await addToSyncQueue({
        operationUuid: `op-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        entityType: 'dictionary',
        operationType: 'CREATE',
        endpoint: '/api/projects/dictionary',
        method: 'POST',
        payload: JSON.stringify({
          orgId,
          name: newDict.name,
          category: newDict.category,
          description: newDict.description,
          items: newDict.items,
          createdBy: 'current-user',
        }),
        maxRetries: 3,
      })

      // Try online API
      const res = await fetch('/api/projects/dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          name: newDict.name,
          category: newDict.category,
          description: newDict.description,
          items: newDict.items,
          createdBy: 'current-user',
        }),
      })
      const data = await res.json()

      if (res.ok) {
        toast({ title: 'تم إنشاء القاموس بنجاح', description: `تم إنشاء ${newDict.name} مع ${newDict.items.length} بند` })
      } else {
        toast({ title: 'تم الحفظ محلياً', description: data.error || 'سيتم المزامنة عند الاتصال', variant: 'destructive' })
      }

      setShowCreateDialog(false)
      setNewDict({
        name: '',
        category: 'GENERAL',
        description: '',
        items: [],
      })
      onRefresh()
    } catch (err) {
      toast({ title: 'تم الحفظ محلياً', description: 'سيتم المزامنة عند الاتصال بالإنترنت' })
      setShowCreateDialog(false)
      setNewDict({ name: '', category: 'GENERAL', description: '', items: [] })
      onRefresh()
    } finally {
      setCreating(false)
    }
  }, [newDict, orgId, onRefresh, toast])

  // Delete dictionary handler
  const handleDeleteDictionary = useCallback(async (dictId: string) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/dictionary?id=${dictId}`, {
        method: 'DELETE',
      })
      const data = await res.json()

      if (res.ok) {
        toast({ title: 'تم حذف القاموس بنجاح' })
      } else {
        toast({ title: 'خطأ', description: data.error || 'فشل حذف القاموس', variant: 'destructive' })
      }

      setShowDeleteConfirm(null)
      setSelectedDict(null)
      onRefresh()
    } catch (err) {
      toast({ title: 'خطأ', description: 'فشل حذف القاموس', variant: 'destructive' })
      setShowDeleteConfirm(null)
    } finally {
      setDeleting(false)
    }
  }, [onRefresh, toast])

  // Add item to temp list (for create dialog)
  const handleAddItemToTemp = useCallback(() => {
    if (!newItem.trade || !newItem.description) {
      toast({ title: 'خطأ', description: 'يرجى ملء الحقل والوصف', variant: 'destructive' })
      return
    }
    setNewDict(prev => ({
      ...prev,
      items: [...prev.items, { ...newItem, sortOrder: prev.items.length }],
    }))
    setNewItem({ trade: '', description: '', quantity: 1, unitOfMeasure: 'unit', sortOrder: 0 })
  }, [newItem, toast])

  // Remove item from temp list
  const handleRemoveItemFromTemp = useCallback((index: number) => {
    setNewDict(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index).map((item, i) => ({ ...item, sortOrder: i })),
    }))
  }, [])

  // Add item to existing dictionary (via sync queue)
  const handleAddItemToDictionary = useCallback(async () => {
    if (!selectedDict || !newItem.trade || !newItem.description) {
      toast({ title: 'خطأ', description: 'يرجى ملء جميع الحقول المطلوبة', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      // Update locally
      const updatedItems = [...selectedDict.items, { ...newItem, id: `item-local-${Date.now()}`, dictionaryId: selectedDict.id, sortOrder: selectedDict.items.length }]
      await db.dictionaries.update(selectedDict.id, {
        items: JSON.stringify(updatedItems),
        lastSyncedAt: Date.now(),
      })

      // Add to sync queue
      await addToSyncQueue({
        operationUuid: `op-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        entityType: 'dictionary',
        operationType: 'UPDATE',
        endpoint: `/api/projects/dictionary`,
        method: 'POST',
        payload: JSON.stringify({
          orgId,
          dictionaryId: selectedDict.id,
          addItem: newItem,
        }),
        maxRetries: 3,
      })

      toast({ title: 'تم إضافة البند بنجاح', description: 'سيتم المزامنة عند الاتصال' })
      setShowAddItemDialog(false)
      setNewItem({ trade: '', description: '', quantity: 1, unitOfMeasure: 'unit', sortOrder: 0 })
      onRefresh()
    } catch (err) {
      toast({ title: 'خطأ', description: 'فشل إضافة البند', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }, [selectedDict, newItem, orgId, onRefresh, toast])

  // Delete item from dictionary
  const handleDeleteItem = useCallback(async (itemId: string) => {
    if (!selectedDict) return
    setDeleting(true)
    try {
      const updatedItems = selectedDict.items.filter(i => i.id !== itemId)
      await db.dictionaries.update(selectedDict.id, {
        items: JSON.stringify(updatedItems),
        lastSyncedAt: Date.now(),
      })

      await addToSyncQueue({
        operationUuid: `op-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        entityType: 'dictionary',
        operationType: 'DELETE',
        endpoint: `/api/projects/dictionary`,
        method: 'DELETE',
        payload: JSON.stringify({ dictionaryId: selectedDict.id, itemId }),
        maxRetries: 3,
      })

      toast({ title: 'تم حذف البند بنجاح' })
      setShowDeleteItemConfirm(null)
      onRefresh()
    } catch (err) {
      toast({ title: 'خطأ', description: 'فشل حذف البند', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }, [selectedDict, onRefresh, toast])

  // Apply dictionary to unit (navigate to projects)
  const handleApplyToUnit = useCallback(() => {
    toast({ title: 'تطبيق القاموس', description: 'سيتم توجيهك إلى المشاريع لتطبيق القاموس على الوحدات' })
  }, [toast])

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-emerald-600" />
            قاموس البنود
          </h2>
          <p className="text-sm text-gray-500 mt-1">إدارة قواميس بنود المشاريع — تطبيق على الوحدات السكنية</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-xs bg-amber-50 border-amber-200 text-amber-700">
            <WifiOff className="w-3 h-3 ml-1" />
            يدعم العمل أوفلاين
          </Badge>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 ml-1" />
            قاموس جديد
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-emerald-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{dictionaries.length}</p>
            <p className="text-xs text-gray-500 mt-1">إجمالي القواميس</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{totalItems}</p>
            <p className="text-xs text-gray-500 mt-1">إجمالي البنود</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">{Object.keys(categoryCounts).length}</p>
            <p className="text-xs text-gray-500 mt-1">فئات مختلفة</p>
          </CardContent>
        </Card>
        <Card className="border-amber-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">
              {dictionaries.length > 0 ? Math.round(totalItems / dictionaries.length) : 0}
            </p>
            <p className="text-xs text-gray-500 mt-1">متوسط البنود/قاموس</p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="بحث بالاسم أو الوصف..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10 text-right"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <Filter className="w-4 h-4 ml-2" />
            <SelectValue placeholder="تصفية حسب الفئة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">جميع الفئات</SelectItem>
            {CATEGORIES.map(cat => (
              <SelectItem key={cat.id} value={cat.id}>
                {CATEGORY_LABELS[cat.name] || cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Category Distribution */}
      {Object.keys(categoryCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(categoryCounts).map(([cat, count]) => (
            <Badge
              key={cat}
              variant="outline"
              className={`text-xs cursor-pointer ${CATEGORY_COLORS[cat] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
              onClick={() => setCategoryFilter(categoryFilter === cat ? 'ALL' : cat)}
            >
              {CATEGORY_LABELS[cat] || cat}: {count}
            </Badge>
          ))}
        </div>
      )}

      {/* Main Content — List or Detail */}
      {selectedDict ? (
        // ===== Dictionary Detail View =====
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setSelectedDict(null)}>
                <ArrowRight className="w-4 h-4 ml-1" />
                العودة
              </Button>
              <div>
                <h3 className="text-lg font-bold text-gray-900">{selectedDict.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    variant="outline"
                    className={`text-xs ${CATEGORY_COLORS[selectedDict.category] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
                  >
                    {CATEGORY_LABELS[selectedDict.category] || selectedDict.category}
                  </Badge>
                  <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                    <List className="w-3 h-3 ml-1" />
                    {selectedDict.items.length} بند
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleApplyToUnit}>
                <Building2 className="w-3.5 h-3.5 ml-1" />
                تطبيق على وحدة
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => setShowDeleteConfirm(selectedDict.id)}
              >
                <Trash2 className="w-3.5 h-3.5 ml-1" />
                حذف القاموس
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setShowAddItemDialog(true)}
              >
                <Plus className="w-3.5 h-3.5 ml-1" />
                إضافة بند
              </Button>
            </div>
          </div>

          {/* Description */}
          {selectedDict.description && (
            <Alert className="border-gray-200 bg-gray-50">
              <FileText className="w-4 h-4 text-gray-500" />
              <AlertDescription className="text-xs text-gray-600">
                {selectedDict.description}
              </AlertDescription>
            </Alert>
          )}

          {/* Items Table */}
          {selectedDict.items.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">لا توجد بنود في هذا القاموس</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setShowAddItemDialog(true)}
                >
                  <Plus className="w-3.5 h-3.5 ml-1" />
                  إضافة أول بند
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[calc(100vh-480px)]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs text-right w-12">#</TableHead>
                        <TableHead className="text-xs text-right">الحقل</TableHead>
                        <TableHead className="text-xs text-right">الوصف</TableHead>
                        <TableHead className="text-xs text-right">الكمية</TableHead>
                        <TableHead className="text-xs text-right">وحدة القياس</TableHead>
                        <TableHead className="text-xs text-right w-16">إجراء</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedDict.items
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((item, idx) => (
                        <TableRow key={item.id} className="hover:bg-gray-50">
                          <TableCell className="text-xs text-gray-500 font-mono">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            <div className="flex items-center gap-1.5">
                              <Ruler className="w-3 h-3 text-gray-400" />
                              {item.trade}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-gray-600 max-w-xs truncate">
                            {item.description}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-[10px] bg-gray-50">
                              {item.unitOfMeasure}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                              onClick={() => setShowDeleteItemConfirm(item.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        // ===== Dictionary List View =====
        <ScrollArea className="max-h-[calc(100vh-380px)]">
          <div className="space-y-3">
            {filteredDictionaries.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center">
                  <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">لا توجد قواميس مطابقة للبحث</p>
                </CardContent>
              </Card>
            ) : (
              filteredDictionaries.map(dict => (
                <Card
                  key={dict.id}
                  className="transition-all hover:shadow-md border-gray-200 cursor-pointer"
                  onClick={() => setSelectedDict(dict)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          dict.category === 'BATHROOM' ? 'bg-blue-100' :
                          dict.category === 'WELL' ? 'bg-emerald-100' :
                          dict.category === 'SHELTER' ? 'bg-amber-100' :
                          dict.category === 'RESIDENTIAL' ? 'bg-purple-100' :
                          dict.category === 'COMMERCIAL' ? 'bg-cyan-100' :
                          dict.category === 'KITCHEN' ? 'bg-orange-100' :
                          'bg-gray-100'
                        }`}>
                          <BookOpen className={`w-5 h-5 ${
                            dict.category === 'BATHROOM' ? 'text-blue-600' :
                            dict.category === 'WELL' ? 'text-emerald-600' :
                            dict.category === 'SHELTER' ? 'text-amber-600' :
                            dict.category === 'RESIDENTIAL' ? 'text-purple-600' :
                            dict.category === 'COMMERCIAL' ? 'text-cyan-600' :
                            dict.category === 'KITCHEN' ? 'text-orange-600' :
                            'text-gray-600'
                          }`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-gray-900 truncate">{dict.name}</h3>
                          {dict.description && (
                            <p className="text-xs text-gray-500 mt-0.5 truncate">{dict.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Category Badge */}
                        <Badge
                          variant="outline"
                          className={`text-xs hidden sm:inline-flex ${CATEGORY_COLORS[dict.category] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
                        >
                          {CATEGORY_LABELS[dict.category] || dict.category}
                        </Badge>

                        {/* Item Count Badge */}
                        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                          <List className="w-3 h-3 ml-1" />
                          {dict.items.length}
                        </Badge>

                        {/* View button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedDict(dict)
                          }}
                        >
                          <Eye className="w-3.5 h-3.5 ml-1" />
                          عرض
                        </Button>

                        {/* Expand/Collapse */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedDict(expandedDict === dict.id ? null : dict.id)
                          }}
                        >
                          {expandedDict === dict.id ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Mobile category badge */}
                    <div className="flex sm:hidden mt-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${CATEGORY_COLORS[dict.category] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
                      >
                        {CATEGORY_LABELS[dict.category] || dict.category}
                      </Badge>
                    </div>

                    {/* Expanded Preview */}
                    {expandedDict === dict.id && dict.items.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                          <Package className="w-3.5 h-3.5 text-gray-500" />
                          معاينة البنود ({dict.items.length})
                        </h4>
                        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 max-h-48 overflow-y-auto">
                          {dict.items
                            .sort((a, b) => a.sortOrder - b.sortOrder)
                            .slice(0, 10)
                            .map((item, idx) => (
                            <div key={item.id} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-gray-400 font-mono w-6 shrink-0">{idx + 1}.</span>
                                <span className="font-medium text-gray-700 truncate">{item.trade}</span>
                                <span className="text-gray-400 truncate hidden sm:inline">— {item.description}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 mr-2">
                                <span className="font-mono text-gray-600">{item.quantity}</span>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-white">
                                  {item.unitOfMeasure}
                                </Badge>
                              </div>
                            </div>
                          ))}
                          {dict.items.length > 10 && (
                            <p className="text-xs text-gray-400 text-center mt-2">
                              +{dict.items.length - 10} بنود إضافية
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      )}

      {/* Create Dictionary Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-600" />
              إنشاء قاموس جديد
            </DialogTitle>
            <DialogDescription>
              أضف قاموس بنود جديد مع بنوده التفصيلية
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="dict-name" className="text-sm">اسم القاموس *</Label>
              <Input
                id="dict-name"
                placeholder="مثال: بنود حمام نموذجي"
                value={newDict.name}
                onChange={(e) => setNewDict(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">الفئة *</Label>
              <Select value={newDict.category} onValueChange={(val) => setNewDict(prev => ({ ...prev, category: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الفئة" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1 py-0 ${CATEGORY_COLORS[cat.name] || ''}`}
                      >
                        {CATEGORY_LABELS[cat.name] || cat.name}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dict-desc" className="text-sm">الوصف</Label>
              <Textarea
                id="dict-desc"
                placeholder="وصف اختياري للقاموس..."
                value={newDict.description}
                onChange={(e) => setNewDict(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>

            {/* Items Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">البنود ({newDict.items.length})</Label>
              </div>

              {/* Add item form */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">الحقل *</Label>
                    <Input
                      placeholder="مثال: سباكة"
                      value={newItem.trade}
                      onChange={(e) => setNewItem(prev => ({ ...prev, trade: e.target.value }))}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">الوصف *</Label>
                    <Input
                      placeholder="مثال: تمديدات مياه"
                      value={newItem.description}
                      onChange={(e) => setNewItem(prev => ({ ...prev, description: e.target.value }))}
                      className="text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">الكمية</Label>
                    <Input
                      type="number"
                      min={0}
                      value={newItem.quantity}
                      onChange={(e) => setNewItem(prev => ({ ...prev, quantity: parseFloat(e.target.value) || 0 }))}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-600">وحدة القياس</Label>
                    <Select value={newItem.unitOfMeasure} onValueChange={(val) => setNewItem(prev => ({ ...prev, unitOfMeasure: val }))}>
                      <SelectTrigger className="text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIT_OPTIONS.map(u => (
                          <SelectItem key={u.value} value={u.value} className="text-xs">
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      size="sm"
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      onClick={handleAddItemToTemp}
                      disabled={!newItem.trade || !newItem.description}
                    >
                      <Plus className="w-3.5 h-3.5 ml-1" />
                      إضافة
                    </Button>
                  </div>
                </div>
              </div>

              {/* Items list */}
              {newDict.items.length > 0 && (
                <ScrollArea className="max-h-48">
                  <div className="space-y-1.5">
                    {newDict.items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-xs text-gray-400 font-mono w-6 shrink-0">{idx + 1}.</span>
                          <span className="text-xs font-medium text-gray-700 truncate">{item.trade}</span>
                          <span className="text-xs text-gray-400 truncate hidden sm:inline">— {item.description}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-mono text-gray-600">{item.quantity} {item.unitOfMeasure}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                            onClick={() => handleRemoveItemFromTemp(idx)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>إلغاء</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={handleCreateDictionary}
              disabled={creating || !newDict.name || !newDict.category}
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                  جاري الإنشاء...
                </>
              ) : (
                <>
                  <BookOpen className="w-4 h-4 ml-1" />
                  إنشاء القاموس
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Item to Dictionary Dialog */}
      <Dialog open={showAddItemDialog} onOpenChange={setShowAddItemDialog}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-600" />
              إضافة بند إلى القاموس
            </DialogTitle>
            <DialogDescription>
              إضافة بند جديد إلى &quot;{selectedDict?.name}&quot;
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm">الحقل *</Label>
              <Input
                placeholder="مثال: سباكة"
                value={newItem.trade}
                onChange={(e) => setNewItem(prev => ({ ...prev, trade: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">الوصف *</Label>
              <Input
                placeholder="مثال: تمديدات مياه ساخنة"
                value={newItem.description}
                onChange={(e) => setNewItem(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm">الكمية</Label>
                <Input
                  type="number"
                  min={0}
                  value={newItem.quantity}
                  onChange={(e) => setNewItem(prev => ({ ...prev, quantity: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">وحدة القياس</Label>
                <Select value={newItem.unitOfMeasure} onValueChange={(val) => setNewItem(prev => ({ ...prev, unitOfMeasure: val }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map(u => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAddItemDialog(false)}>إلغاء</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={handleAddItemToDictionary}
              disabled={creating || !newItem.trade || !newItem.description}
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                  جاري الإضافة...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 ml-1" />
                  إضافة البند
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dictionary Confirmation */}
      <Dialog open={showDeleteConfirm !== null} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              تأكيد حذف القاموس
            </DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف هذا القاموس؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              onClick={() => showDeleteConfirm && handleDeleteDictionary(showDeleteConfirm)}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 ml-1" />
              )}
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Item Confirmation */}
      <Dialog open={showDeleteItemConfirm !== null} onOpenChange={() => setShowDeleteItemConfirm(null)}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              تأكيد حذف البند
            </DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف هذا البند من القاموس؟
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteItemConfirm(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              onClick={() => showDeleteItemConfirm && handleDeleteItem(showDeleteItemConfirm)}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 ml-1" />
              )}
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
