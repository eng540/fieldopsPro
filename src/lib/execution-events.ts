import { v4 as uuidv4 } from 'uuid'
import { useAuthStore } from './auth-store'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export interface ExecutionEventIntent {
  sync_uuid: string
  entity_type: 'BOQ_ITEM'
  entity_id: string
  unit_id: number
  event_class: 'PROGRESS'
  event_type: 'DELTA_ADD' | 'REWORK'
  metric_type: 'PERCENTAGE'
  value: { pct: number }
  occurred_at: string
  expected_version: number
  transaction_group_id?: string
  reason?: string
  notes?: string
}
export interface ExecutionEventResponse { event_id:string;sync_uuid:string;new_version:number;status:string;recorded_at:string }
export interface ExecutionEventsResponse { succeeded:ExecutionEventResponse[];conflicts:Array<{sync_uuid:string;expected_version:number;actual_version:number;current_state:Record<string,unknown>;resolution_options:string[]}>;failed:Array<{sync_uuid:string;error:string}> }

export function createProgressIntent(input:{unitId:string|number;boqItemId:string|number;expectedVersion:number;deltaPct:number;rework?:boolean;reason?:string;transactionGroupId?:string}):ExecutionEventIntent{
  const unitId=Number(input.unitId),boqItemId=Number(input.boqItemId)
  if(!Number.isInteger(unitId)||unitId<=0)throw new Error('unitId must be a positive integer')
  if(!Number.isInteger(boqItemId)||boqItemId<=0)throw new Error('boqItemId must be a positive integer')
  if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<1)throw new Error('expectedVersion must be >= 1')
  if(!Number.isFinite(input.deltaPct)||input.deltaPct===0)throw new Error('deltaPct must be non-zero')
  if(input.rework&&(!input.reason||input.reason.trim().length<20))throw new Error('سبب الإعادة يجب أن يكون 20 حرفاً على الأقل')
  return{sync_uuid:uuidv4(),entity_type:'BOQ_ITEM',entity_id:String(boqItemId),unit_id:unitId,event_class:'PROGRESS',event_type:input.rework?'REWORK':'DELTA_ADD',metric_type:'PERCENTAGE',value:{pct:input.deltaPct},occurred_at:new Date().toISOString(),expected_version:input.expectedVersion,...(input.transactionGroupId?{transaction_group_id:input.transactionGroupId}:{}),...(input.reason?{reason:input.reason.trim()}: {})}
}

export async function submitExecutionEvents(events:ExecutionEventIntent[],transactionGroupId?:string):Promise<ExecutionEventsResponse>{
  if(!events.length)return{succeeded:[],conflicts:[],failed:[]}
  const send=()=>fetch(`${API_BASE}/execution/events`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',...(useAuthStore.getState().tokens?.accessToken?{Authorization:`Bearer ${useAuthStore.getState().tokens!.accessToken}`}:{})},body:JSON.stringify({events:events.map(e=>transactionGroupId&&!e.transaction_group_id?{...e,transaction_group_id:transactionGroupId}:e)})})
  let response=await send()
  if(response.status===401){await useAuthStore.getState().refreshAccessToken();response=await send()}
  const data=await response.json().catch(()=>({}))
  if(response.status===401)throw new Error('انتهت جلسة الدخول. يرجى تسجيل الدخول مرة أخرى.')
  if(!response.ok)throw new Error(typeof data?.detail==='string'?data.detail:`فشل إرسال الأحداث (HTTP ${response.status})`)
  if(!Array.isArray(data?.succeeded)||!Array.isArray(data?.conflicts)||!Array.isArray(data?.failed))throw new Error('استجابة غير صالحة من محرك التنفيذ')
  return data as ExecutionEventsResponse
}
