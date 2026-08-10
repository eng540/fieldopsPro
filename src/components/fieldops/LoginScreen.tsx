// FieldOps V4 — Login Screen
// Sprint 5 Phase 3 — Enterprise Authentication UI

'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Building2, Eye, EyeOff, Loader2, Shield, Wifi,
  AlertCircle, CheckCircle2, Server,
  Key, Mail, Lock
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'

export function LoginScreen() {
  const { login, isLoading, error, clearError } = useAuthStore()

  const [email, setEmail] = useState('admin@fieldops.sa')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
    } catch {
      // Error is handled in store
    }
  }

  const demoAccounts = [
    { email: 'admin@fieldops.sa', name: 'مدير النظام', role: 'SUPER_ADMIN' },
    { email: 'orgadmin@fieldops.sa', name: 'مدير المنظمة', role: 'ORG_ADMIN' },
    { email: 'pm@fieldops.sa', name: 'مدير مشروع', role: 'PROJECT_MANAGER' },
    { email: 'field@fieldops.sa', name: 'مهندس ميداني', role: 'FIELD_ENGINEER' },
    { email: 'viewer@fieldops.sa', name: 'مشاهد', role: 'VIEWER' },
  ]

  const roleColors: Record<string, string> = {
    SUPER_ADMIN: 'bg-red-100 text-red-800 border-red-200',
    ORG_ADMIN: 'bg-purple-100 text-purple-800 border-purple-200',
    PROJECT_MANAGER: 'bg-blue-100 text-blue-800 border-blue-200',
    FIELD_ENGINEER: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    VIEWER: 'bg-gray-100 text-gray-800 border-gray-200',
  }

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: 'مدير النظام الأعلى',
    ORG_ADMIN: 'مدير المنظمة',
    PROJECT_MANAGER: 'مدير مشروع',
    FIELD_ENGINEER: 'مهندس ميداني',
    VIEWER: 'مشاهد',
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-4" dir="rtl">
      <div className="w-full max-w-lg">
        {/* Logo & Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-200 mb-4">
            <Building2 className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">FieldOps V4</h1>
          <p className="text-sm text-gray-500 mt-1">منصة العمليات الميدانية المتقدمة</p>
        </div>

        {/* Login Card */}
        <Card className="shadow-xl border-gray-200/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-center">تسجيل الدخول</CardTitle>
            <CardDescription className="text-center">
              أدخل بيانات الاعتماد للوصول إلى النظام
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">البريد الإلكتروني</Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); clearError() }}
                    placeholder="example@fieldops.sa"
                    className="pr-10 h-11"
                    required
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearError() }}
                    placeholder="أدخل كلمة المرور"
                    className="pr-10 pl-10 h-11"
                    required
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري تسجيل الدخول...
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4 ml-2" />
                    تسجيل الدخول
                  </>
                )}
              </Button>

              {/* Server Status */}
              <div className="pt-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Server className="w-3.5 h-3.5" />
                  <span>خادم FastAPI: {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'}</span>
                </div>
              </div>
            </form>

            {/* Demo Accounts */}
            <div className="mt-6">
              <Separator className="mb-4" />
              <div className="text-center mb-3">
                <p className="text-xs text-gray-500">حسابات تجريبية (كلمة المرور: <span dir="ltr" className="font-mono">demo1234</span>)</p>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {demoAccounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => {
                      setEmail(account.email)
                      setPassword('demo1234')
                      clearError()
                    }}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors text-right"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                        <span className="text-xs font-bold text-gray-600">
                          {account.name.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{account.name}</p>
                        <p className="text-xs text-gray-500" dir="ltr">{account.email}</p>
                      </div>
                    </div>
                    <Badge className={`text-[10px] ${roleColors[account.role] || 'bg-gray-100'}`}>
                      {roleLabels[account.role] || account.role}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
            <div className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              مشفر
            </div>
            <div className="flex items-center gap-1">
              <Wifi className="w-3 h-3" />
              يعمل أوفلاين
            </div>
            <div className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              v4.0
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
