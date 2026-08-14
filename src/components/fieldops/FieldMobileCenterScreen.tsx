'use client'

import { useEffect, useState } from 'react'
import { Database, LockKeyhole, RefreshCw, ShieldCheck, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getPendingSyncCount, db } from '@/lib/offline-db'
import { useOnlineStatus } from '@/lib/sync-hooks'
import { processSyncQueue } from '@/lib/api-client'

export function FieldMobileCenterScreen() {
  const online = useOnlineStatus(); const [pending,setPending]=useState(0); const [storage,setStorage]=useState(0); const [busy,setBusy]=useState(false)
  const refresh=async()=>{ setPending(await getPendingSyncCount()); try { const count=await db.projects.count()+await db.units.count()+await db.boqItems.count()+await db.remarks.count(); setStorage(count) } catch {} }
  useEffect(()=>{ refresh(); const id=setInterval(refresh,5000); return()=>clearInterval(id)},[])
  const sync=async()=>{setBusy(true);try{await processSyncQueue()}finally{await refresh();setBusy(false)}}
  return <div className="space-y-5"><div><h2 className="text-2xl font-bold">مركز العمل الميداني</h2><p className="text-sm text-gray-500 mt-1">حالة PWA والتخزين المحلي والمزامنة وحماية بيانات الجهاز</p></div>
    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4"><div className="bg-white border rounded-xl p-5"><div className="flex justify-between"><span>الاتصال</span>{online?<Wifi className="text-emerald-600"/>:<WifiOff className="text-amber-600"/>}</div><b className="text-xl">{online?'متصل':'غير متصل'}</b><p className="text-xs text-gray-500 mt-1">العمل يستمر محلياً عند الانقطاع</p></div><div className="bg-white border rounded-xl p-5"><div className="flex justify-between"><span>طابور المزامنة</span><RefreshCw/></div><b className="text-xl">{pending}</b><p className="text-xs text-gray-500 mt-1">عمليات تنتظر الرفع</p></div><div className="bg-white border rounded-xl p-5"><div className="flex justify-between"><span>البيانات المحلية</span><Database/></div><b className="text-xl">{storage}</b><p className="text-xs text-gray-500 mt-1">سجلات متاحة للاستخدام الميداني</p></div><div className="bg-white border rounded-xl p-5"><div className="flex justify-between"><span>الأمان</span><ShieldCheck className="text-emerald-600"/></div><b className="text-xl">Tenant Scoped</b><p className="text-xs text-gray-500 mt-1">المصادقة وRLS على الخادم</p></div></div>
    <div className="bg-white border rounded-xl p-5"><h3 className="font-bold mb-4">إجراءات التشغيل الميداني</h3><div className="flex flex-wrap gap-2"><Button onClick={sync} disabled={!online||busy}><RefreshCw className={busy?'animate-spin':''}/> مزامنة الطابور</Button><Button variant="outline" onClick={()=>window.location.reload()}><Database/> تحديث التطبيق</Button><Badge variant="outline" className="px-3 py-2"><LockKeyhole className="w-4 h-4 ml-1"/>جلسة محمية بالمصادقة</Badge></div><p className="text-xs text-gray-500 mt-4">التعارضات تُحوّل إلى Conflict Resolution Panel ولا يتم الكتابة فوق حالة الخادم بصمت.</p></div></div>
}
