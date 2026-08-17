import { addToSyncQueue } from './offline-db'
import { useAuthStore } from './auth-store'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'
async function request<T>(path:string,options:RequestInit={}):Promise<T>{
  const send=()=>fetch(`${API_BASE}${path}`,{...options,credentials:'include',headers:{'Content-Type':'application/json',...(useAuthStore.getState().tokens?.accessToken?{Authorization:`Bearer ${useAuthStore.getState().tokens!.accessToken}`}:{}) ,...(options.headers||{})}})
  let res=await send(); if(res.status===401){await useAuthStore.getState().refreshAccessToken();res=await send()}
  const body=await res.json().catch(()=>({})); if(!res.ok)throw new Error(body.detail||body.error||`HTTP ${res.status}`); return body as T
}
export interface WorkOrder{id:number;org_id:number;project_id:number;unit_id:number|null;title:string;description:string|null;wo_type:string;priority:string;status:string;completion_pct:number;rework_flag:boolean;rework_reason:string|null;rework_authorized_by:number|null;created_by:number;server_timestamp:string;created_at:string;updated_at:string}
export interface WorkOrderPage{items:WorkOrder[];total:number;page:number;page_size:number;has_more?:boolean}
export async function listWorkOrders(projectId:string|number,page=1,pageSize=100){return request<WorkOrderPage>(`/execution/work-orders?project_id=${encodeURIComponent(projectId)}&page=${page}&page_size=${pageSize}`)}
export async function createWorkOrder(payload:Record<string,unknown>){return request<WorkOrder>('/execution/work-orders',{method:'POST',body:JSON.stringify(payload)})}
export async function updateWorkOrder(id:number,payload:Record<string,unknown>){return request<WorkOrder>(`/execution/work-orders/${id}`,{method:'PATCH',body:JSON.stringify(payload)})}
export async function assignWorkOrder(id:number,userId:number,notes?:string){return request(`/execution/work-orders/${id}/assign`,{method:'POST',body:JSON.stringify({user_id:userId,notes})})}
export interface ExecutionState{id:number;org_id:number;unit_id:number;boq_item_id:number;completion_pct:number;status:string;state_version:number;actual_quantity:number|null;last_event_id:string|null}
export interface ExecutionStatePage{items:ExecutionState[];total:number;page:number;page_size:number;has_more:boolean}
export async function listExecutionState(projectId:string|number,pageSize=500){return request<ExecutionStatePage>(`/execution/state?project_id=${encodeURIComponent(projectId)}&page=1&page_size=${pageSize}`)}
export async function getExecutionState(unitId:number,boqItemId:number){try{return await request<ExecutionState>(`/execution/state/${unitId}/${boqItemId}`)}catch{return null}}
export async function submitProgressEvent(args:{unitId:number;boqItemId:number;expectedVersion:number;completionPct:number;currentPct:number;reworkReason?:string;occurredAt?:string}){const delta=args.completionPct-args.currentPct;const payload={sync_uuid:crypto.randomUUID(),entity_type:'BOQ_ITEM',entity_id:String(args.boqItemId),unit_id:args.unitId,event_class:'PROGRESS',event_type:delta<0?'REWORK':'DELTA_ADD',metric_type:'PERCENTAGE',value:{pct:Math.abs(delta)},occurred_at:args.occurredAt||new Date().toISOString(),expected_version:args.expectedVersion,reason:delta<0?args.reworkReason:undefined};return request('/execution/events',{method:'POST',body:JSON.stringify({events:[payload]})})}
export async function queueProgressOffline(orgId:string,item:{unitId:string;boqItemId:string;completionPct:number;reworkFlag:boolean;reworkReason:string}){await addToSyncQueue({operationUuid:crypto.randomUUID(),entityType:'boqProgress',entityId:`${item.unitId}:${item.boqItemId}`,operationType:'BULK_PROGRESS',endpoint:'/api/v1/execution/bulk-progress',method:'POST',payload:JSON.stringify({updates:[{unit_id:Number(item.unitId),boq_item_id:Number(item.boqItemId),completion_pct:item.completionPct,rework_flag:item.reworkFlag,rework_reason:item.reworkReason||null}]}),maxRetries:3,serverData:null})}
