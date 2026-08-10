// FieldOps V4 — Users Screen
// Enhanced User Management with RBAC, Offline Support, and Arabic RTL

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
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Users, Plus, Shield, Search, Filter, Loader2, CheckCircle2,
  XCircle, WifiOff, UserPlus, KeyRound, ChevronDown, ChevronUp,
  Building2, Mail, User, Eye, EyeOff, RefreshCw, AlertCircle
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { addToSyncQueue, db } from '@/lib/offline-db'

// ============================================================
// Types
// ============================================================

interface UserData {
  id: string; orgId: string; email: string; name: string; isActive: boolean;
  assignments: { id: string; projectId: string; project: { id: string; name: string; code: string }; role: { id: string; name: string } }[]
}

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

interface UsersScreenProps {
  users: UserData[]
  projects: ProjectData[]
  orgId: string
  onRefresh: () => void
}

// ============================================================
// Constants
// ============================================================

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'مدير النظام الأعلى',
  ORG_ADMIN: 'مدير المنظمة',
  PROJECT_MANAGER: 'مدير مشروع',
  FIELD_ENGINEER: 'مهندس ميداني',
  VIEWER: 'مشاهد',
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-100 text-red-800 border-red-200',
  ORG_ADMIN: 'bg-purple-100 text-purple-800 border-purple-200',
  PROJECT_MANAGER: 'bg-blue-100 text-blue-800 border-blue-200',
  FIELD_ENGINEER: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  VIEWER: 'bg-gray-100 text-gray-800 border-gray-200',
}

const ROLES = [
  { id: 'SUPER_ADMIN', name: 'SUPER_ADMIN' },
  { id: 'ORG_ADMIN', name: 'ORG_ADMIN' },
  { id: 'PROJECT_MANAGER', name: 'PROJECT_MANAGER' },
  { id: 'FIELD_ENGINEER', name: 'FIELD_ENGINEER' },
  { id: 'VIEWER', name: 'VIEWER' },
]

// ============================================================
// UsersScreen Component
// ============================================================

export function UsersScreen({ users, projects, orgId, onRefresh }: UsersScreenProps) {
  const { toast } = useToast()

  // State
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [creating, setCreating] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null)

  // Form states
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'VIEWER' })
  const [assignment, setAssignment] = useState({ userId: '', projectId: '', roleId: 'VIEWER' })

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchesSearch = u.name.includes(searchTerm) || u.email.includes(searchTerm)
      const matchesRole = roleFilter === 'ALL' || u.assignments.some(a => a.role.name === roleFilter)
      return matchesSearch && matchesRole
    })
  }, [users, searchTerm, roleFilter])

  // Stats
  const activeCount = users.filter(u => u.isActive).length
  const inactiveCount = users.filter(u => !u.isActive).length
  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    users.forEach(u => {
      u.assignments.forEach(a => {
        counts[a.role.name] = (counts[a.role.name] || 0) + 1
      })
    })
    return counts
  }, [users])

  // Create user handler
  const handleCreateUser = useCallback(async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      toast({ title: 'خطأ', description: 'يرجى ملء جميع الحقول المطلوبة', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      // Save locally first (offline support)
      const localUserId = `user-local-${Date.now()}-${Math.random().toString(36).substring(7)}`
      await db.users.put({
        id: localUserId,
        orgId,
        email: newUser.email,
        name: newUser.name,
        isActive: true,
        assignments: JSON.stringify([]),
        lastSyncedAt: Date.now(),
      })

      // Add to sync queue
      await addToSyncQueue({
        operationUuid: `op-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        entityType: 'user',
        operationType: 'CREATE',
        endpoint: '/api/auth/register',
        method: 'POST',
        payload: JSON.stringify({ orgId, name: newUser.name, email: newUser.email, password: newUser.password, role: newUser.role }),
        maxRetries: 3,
      })

      // Try online API
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, name: newUser.name, email: newUser.email, password: newUser.password, role: newUser.role }),
      })
      const data = await res.json()

      if (res.ok) {
        toast({ title: 'تم إنشاء المستخدم بنجاح', description: `تم إنشاء ${newUser.name}` })
      } else {
        toast({ title: 'تم الحفظ محلياً', description: data.error || 'سيتم المزامنة عند الاتصال', variant: 'destructive' })
      }

      setShowCreateDialog(false)
      setNewUser({ name: '', email: '', password: '', role: 'VIEWER' })
      onRefresh()
    } catch (err) {
      toast({ title: 'تم الحفظ محلياً', description: 'سيتم المزامنة عند الاتصال بالإنترنت' })
      setShowCreateDialog(false)
      setNewUser({ name: '', email: '', password: '', role: 'VIEWER' })
      onRefresh()
    } finally {
      setCreating(false)
    }
  }, [newUser, orgId, onRefresh, toast])

  // Assign role handler
  const handleAssignRole = useCallback(async () => {
    if (!assignment.userId || !assignment.projectId || !assignment.roleId) {
      toast({ title: 'خطأ', description: 'يرجى اختيار المستخدم والمشروع والدور', variant: 'destructive' })
      return
    }
    setAssigning(true)
    try {
      const res = await fetch('/api/auth/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, ...assignment }),
      })
      const data = await res.json()

      if (res.ok) {
        toast({ title: 'تم تعيين الصلاحية بنجاح', description: `تم تعيين الدور على المشروع` })
        setShowAssignDialog(false)
        setAssignment({ userId: '', projectId: '', roleId: 'VIEWER' })
        onRefresh()
      } else {
        toast({ title: 'خطأ', description: data.error || 'فشل تعيين الصلاحية', variant: 'destructive' })
      }
    } catch (err) {
      toast({ title: 'خطأ', description: 'فشل تعيين الصلاحية', variant: 'destructive' })
    } finally {
      setAssigning(false)
    }
  }, [assignment, orgId, onRefresh, toast])

  // Toggle user active/inactive
  const handleToggleActive = useCallback(async (userId: string, currentIsActive: boolean) => {
    setTogglingUserId(userId)
    try {
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isActive: !currentIsActive }),
      })
      const data = await res.json()

      if (res.ok) {
        toast({
          title: !currentIsActive ? 'تم تفعيل المستخدم' : 'تم تعطيل المستخدم',
          description: !currentIsActive ? 'المستخدم نشط الآن' : 'المستخدم غير نشط الآن',
        })
        onRefresh()
      } else {
        toast({ title: 'خطأ', description: data.error || 'فشل تحديث حالة المستخدم', variant: 'destructive' })
      }
    } catch (err) {
      toast({ title: 'خطأ', description: 'فشل تحديث حالة المستخدم', variant: 'destructive' })
    } finally {
      setTogglingUserId(null)
    }
  }, [onRefresh, toast])

  // Get unique roles from all users
  const allRoles = useMemo(() => {
    const roleSet = new Set<string>()
    users.forEach(u => u.assignments.forEach(a => roleSet.add(a.role.name)))
    return Array.from(roleSet)
  }, [users])

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-emerald-600" />
            إدارة المستخدمين
          </h2>
          <p className="text-sm text-gray-500 mt-1">إدارة المستخدمين والصلاحيات وتوزيعهم على المشاريع</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-xs bg-amber-50 border-amber-200 text-amber-700">
            <WifiOff className="w-3 h-3 ml-1" />
            يدعم العمل أوفلاين
          </Badge>
          <Button variant="outline" onClick={() => setShowAssignDialog(true)}>
            <KeyRound className="w-4 h-4 ml-1" />
            تعيين صلاحية
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowCreateDialog(true)}>
            <UserPlus className="w-4 h-4 ml-1" />
            مستخدم جديد
          </Button>
        </div>
      </div>

      {/* RBAC Notice */}
      <Alert className="border-blue-200 bg-blue-50">
        <Shield className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-xs text-blue-800">
          <strong>التحكم بالصلاحيات (RBAC):</strong> هذه الشاشة متاحة فقط لأدوار SUPER_ADMIN و ORG_ADMIN. يمكن تعيين مستخدم واحد في عدة مشاريع بأدوار مختلفة.
        </AlertDescription>
      </Alert>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-emerald-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{users.length}</p>
            <p className="text-xs text-gray-500 mt-1">إجمالي المستخدمين</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{activeCount}</p>
            <p className="text-xs text-gray-500 mt-1">نشط</p>
          </CardContent>
        </Card>
        <Card className="border-red-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{inactiveCount}</p>
            <p className="text-xs text-gray-500 mt-1">غير نشط</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">{Object.keys(roleCounts).length}</p>
            <p className="text-xs text-gray-500 mt-1">أدوار مختلفة</p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="بحث بالاسم أو البريد الإلكتروني..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10 text-right"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <Filter className="w-4 h-4 ml-2" />
            <SelectValue placeholder="تصفية حسب الدور" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">جميع الأدوار</SelectItem>
            {allRoles.map(role => (
              <SelectItem key={role} value={role}>
                {ROLE_LABELS[role] || role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Role Distribution */}
      {Object.keys(roleCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(roleCounts).map(([role, count]) => (
            <Badge
              key={role}
              variant="outline"
              className={`text-xs cursor-pointer ${ROLE_COLORS[role] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
              onClick={() => setRoleFilter(roleFilter === role ? 'ALL' : role)}
            >
              {ROLE_LABELS[role] || role}: {count}
            </Badge>
          ))}
        </div>
      )}

      {/* Users List */}
      <ScrollArea className="max-h-[calc(100vh-380px)]">
        <div className="space-y-3">
          {filteredUsers.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">لا يوجد مستخدمين مطابقين للبحث</p>
              </CardContent>
            </Card>
          ) : (
            filteredUsers.map(user => (
              <Card
                key={user.id}
                className={`transition-all hover:shadow-md ${
                  !user.isActive ? 'opacity-60 border-red-200' : 'border-gray-200'
                }`}
              >
                <CardContent className="p-4">
                  {/* User Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                        user.isActive ? 'bg-emerald-100' : 'bg-red-100'
                      }`}>
                        <span className={`text-sm font-bold ${user.isActive ? 'text-emerald-700' : 'text-red-700'}`}>
                          {user.name.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 truncate">{user.name}</h3>
                          {user.isActive ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                          <Mail className="w-3 h-3 shrink-0" />
                          <span className="truncate">{user.email}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Role badges */}
                      <div className="hidden sm:flex flex-wrap gap-1 max-w-xs">
                        {user.assignments.slice(0, 2).map(a => (
                          <Badge
                            key={a.id}
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${ROLE_COLORS[a.role.name] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
                          >
                            {ROLE_LABELS[a.role.name] || a.role.name}
                          </Badge>
                        ))}
                        {user.assignments.length > 2 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-gray-50 text-gray-600 border-gray-200">
                            +{user.assignments.length - 2}
                          </Badge>
                        )}
                      </div>

                      {/* Toggle active */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-8 text-xs ${user.isActive ? 'text-red-600 hover:text-red-700' : 'text-emerald-600 hover:text-emerald-700'}`}
                        onClick={() => handleToggleActive(user.id, user.isActive)}
                        disabled={togglingUserId === user.id}
                      >
                        {togglingUserId === user.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : user.isActive ? (
                          <>
                            <XCircle className="w-3.5 h-3.5 ml-1" />
                            تعطيل
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 ml-1" />
                            تفعيل
                          </>
                        )}
                      </Button>

                      {/* Expand */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                      >
                        {expandedUser === user.id ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Mobile role badges */}
                  <div className="flex sm:hidden flex-wrap gap-1 mt-2">
                    {user.assignments.map(a => (
                      <Badge
                        key={a.id}
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${ROLE_COLORS[a.role.name] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
                      >
                        {ROLE_LABELS[a.role.name] || a.role.name}
                      </Badge>
                    ))}
                  </div>

                  {/* Expanded Details - RBAC Access */}
                  {expandedUser === user.id && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-blue-600" />
                        صلاحيات الوصول (RBAC)
                      </h4>
                      {user.assignments.length === 0 ? (
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                          <AlertCircle className="w-5 h-5 text-gray-400 mx-auto mb-1" />
                          <p className="text-xs text-gray-500">لا توجد صلاحيات معينة لهذا المستخدم</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 text-xs"
                            onClick={() => {
                              setAssignment(prev => ({ ...prev, userId: user.id }))
                              setShowAssignDialog(true)
                            }}
                          >
                            <KeyRound className="w-3 h-3 ml-1" />
                            تعيين صلاحية
                          </Button>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs text-right">المشروع</TableHead>
                              <TableHead className="text-xs text-right">الدور</TableHead>
                              <TableHead className="text-xs text-right">رمز المشروع</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {user.assignments.map(a => (
                              <TableRow key={a.id}>
                                <TableCell className="text-xs font-medium">
                                  <div className="flex items-center gap-1.5">
                                    <Building2 className="w-3 h-3 text-gray-400" />
                                    {a.project.name}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] ${ROLE_COLORS[a.role.name] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
                                  >
                                    {ROLE_LABELS[a.role.name] || a.role.name}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-gray-500">
                                  {a.project.code}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}

                      {/* User info */}
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div className="bg-gray-50 rounded-lg p-2.5">
                          <p className="text-[10px] text-gray-500 mb-0.5">المعرف</p>
                          <p className="text-xs font-mono text-gray-700 truncate">{user.id}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2.5">
                          <p className="text-[10px] text-gray-500 mb-0.5">الحالة</p>
                          <p className={`text-xs font-medium ${user.isActive ? 'text-emerald-600' : 'text-red-600'}`}>
                            {user.isActive ? 'نشط' : 'غير نشط'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-emerald-600" />
              إنشاء مستخدم جديد
            </DialogTitle>
            <DialogDescription>
              أضف مستخدم جديد إلى المنظمة وحدد دوره
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="user-name" className="text-sm">الاسم الكامل *</Label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="user-name"
                  placeholder="أدخل اسم المستخدم"
                  value={newUser.name}
                  onChange={(e) => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                  className="pr-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email" className="text-sm">البريد الإلكتروني *</Label>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="user-email"
                  type="email"
                  placeholder="example@fieldops.com"
                  value={newUser.email}
                  onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                  className="pr-10"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-password" className="text-sm">كلمة المرور *</Label>
              <div className="relative">
                <Input
                  id="user-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="أدخل كلمة المرور"
                  value={newUser.password}
                  onChange={(e) => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                  className="pr-10 pl-10"
                  dir="ltr"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">الدور الافتراضي</Label>
              <Select value={newUser.role} onValueChange={(val) => setNewUser(prev => ({ ...prev, role: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الدور" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(role => (
                    <SelectItem key={role.id} value={role.id}>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1 py-0 ${ROLE_COLORS[role.name] || ''}`}
                        >
                          {ROLE_LABELS[role.name] || role.name}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>إلغاء</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={handleCreateUser}
              disabled={creating || !newUser.name || !newUser.email || !newUser.password}
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                  جاري الإنشاء...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 ml-1" />
                  إنشاء المستخدم
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Role Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-blue-600" />
              تعيين صلاحية
            </DialogTitle>
            <DialogDescription>
              تعيين دور لمستخدم على مشروع محدد
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm">المستخدم *</Label>
              <Select value={assignment.userId} onValueChange={(val) => setAssignment(prev => ({ ...prev, userId: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر المستخدم" />
                </SelectTrigger>
                <SelectContent>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      <div className="flex items-center gap-2">
                        <span>{u.name}</span>
                        <span className="text-xs text-gray-400">({u.email})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">المشروع *</Label>
              <Select value={assignment.projectId} onValueChange={(val) => setAssignment(prev => ({ ...prev, projectId: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر المشروع" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        <Building2 className="w-3 h-3 text-gray-400" />
                        <span>{p.name}</span>
                        <span className="text-xs text-gray-400">({p.code})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">الدور *</Label>
              <Select value={assignment.roleId} onValueChange={(val) => setAssignment(prev => ({ ...prev, roleId: val }))}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الدور" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(role => (
                    <SelectItem key={role.id} value={role.id}>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1 py-0 ${ROLE_COLORS[role.name] || ''}`}
                      >
                        {ROLE_LABELS[role.name] || role.name}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>إلغاء</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={handleAssignRole}
              disabled={assigning || !assignment.userId || !assignment.projectId || !assignment.roleId}
            >
              {assigning ? (
                <>
                  <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                  جاري التعيين...
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4 ml-1" />
                  تعيين الصلاحية
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
