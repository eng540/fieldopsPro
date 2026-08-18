'use client'

import { useEffect, useState } from 'react'
import { Database, LockKeyhole, RefreshCw, ShieldCheck, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getPendingSyncCount, db } from '@/lib/offline-db'
import { useOnlineStatus } from '@/lib/sync-hooks'
import { processSyncQueue } from '@/lib/api-client'

export function FieldMobileCenterScreen() {
  const online = useOnlineStatus()
  const [pending, setPending] = useState(0)
  const [storage, setStorage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const refresh = async () => {
    setPending(await getPendingSyncCount())
    try {
      setStorage(await db.projects.count() + await db.units.count() + await db.boqItems.count() + await db.remarks.count())
    } catch {
      setStorage(0)
    }
  }

  useEffect(() => {
    void refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [])

  const sync = async () => {
    if (!online || busy) return
    setBusy(true)
    setSyncMessage('جاري المزامنة...')
    try {
      const result = await processSyncQueue()
      if (result.failed > 0 || result.conflicts.length > 0) {
        setSyncMessage(`اكتملت المحاولة مع ${result.failed} فشل/تعارض، والمتبقي في الطابور: ${result.remaining}.`)
      } else if (result.remaining > 0) {
        setSyncMessage(`لم تكتمل المزامنة؛ المتبقي في الطابور: ${result.remaining}.`)
      } else {
        setSyncMessage(`اكتملت المزامنة بنجاح. تمت معالجة ${result.processed} عملية.`)
      }
    } catch (error) {
      setSyncMessage(`فشلت المزامنة: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold">مركز العمل الميداني</h2>
        <p className="text-sm text-gray-500">PWA والتخزين المحلي والمزامنة وحماية جلسة الجهاز</p>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border rounded-xl p-5"><div className="flex justify-between">الاتصال{online ? <Wifi className="text-emerald-600" /> : <WifiOff />}</div><b className="text-xl">{online ? 'متصل' : 'غير متصل'}</b></div>
        <div className="bg-white border rounded-xl p-5"><div className="flex justify-between">طابور المزامنة<RefreshCw /></div><b className="text-xl">{pending}</b></div>
        <div className="bg-white border rounded-xl p-5"><div className="flex justify-between">البيانات المحلية<Database /></div><b className="text-xl">{storage}</b></div>
        <div className="bg-white border rounded-xl p-5"><div className="flex justify-between">الأمان<ShieldCheck className="text-emerald-600" /></div><b className="text-xl">Tenant Scoped</b></div>
      </div>
      <div className="bg-white border rounded-xl p-5">
        <h3 className="font-bold mb-4">إجراءات التشغيل</h3>
        <div className="flex flex-wrap gap-2">
          <Button onClick={sync} disabled={!online || busy}><RefreshCw className={busy ? 'animate-spin' : ''} />مزامنة الطابور</Button>
          <Button variant="outline" onClick={() => location.reload()}><Database />تحديث التطبيق</Button>
          <Badge variant="outline" className="px-3 py-2"><LockKeyhole className="w-4 h-4 ml-1" />جلسة محمية</Badge>
        </div>
        {syncMessage && <p className="text-sm mt-4" role="status">{syncMessage}</p>}
        <p className="text-xs text-gray-500 mt-4">التعارضات لا تُستبدل بصمت؛ تبقى في لوحة حل التعارضات.</p>
      </div>
    </div>
  )
}
