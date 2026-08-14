"use client"
const API_BASE=process.env.NEXT_PUBLIC_API_URL||'http://localhost:8000/api/v1'
function token(){try{const raw=localStorage.getItem('fieldops-auth');return raw?JSON.parse(raw)?.state?.tokens?.accessToken||null:null}catch{return null}}
async function request<T>(path:string,options:RequestInit={}):Promise<T>{const response=await fetch(`${API_BASE}${path}`,{...options,headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`}:{})}});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.detail||`HTTP ${response.status}`)}return response.json()}
export interface DiaryEntry{id:string;org_id:number;project_id:number;diary_date:string;weather:string|null;workforce:Record<string,unknown>;equipment:string[];visits_total:number;visits_accepted:number;observations:string|null;gps_tag:Record<string,unknown>|null;attachments:string[];created_by:number;created_at:string;updated_at:string}
export const listDiary=(projectId?:string)=>request<{items:DiaryEntry[];total:number}>(`/field-diary${projectId?`?project_id=${encodeURIComponent(projectId)}`:''}`)
export const saveDiary=(payload:Omit<DiaryEntry,'id'|'org_id'|'created_by'|'created_at'|'updated_at'>)=>request<DiaryEntry>('/field-diary',{method:'POST',body:JSON.stringify(payload)})
export const getReportingSummary=()=>request<any>('/reporting/summary')
export const getProjectProgress=()=>request<any>('/reporting/project-progress')
export const getWorkOrderSummary=()=>request<any>('/reporting/work-orders')
export async function downloadIPC(format:'csv'|'xlsx'='xlsx'){const response=await fetch(`${API_BASE}/reporting/ipc`,{method:'POST',headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`}:{})},body:JSON.stringify({format,include_holds:true})});if(!response.ok)throw new Error(`IPC export failed: HTTP ${response.status}`);const blob=await response.blob();const disposition=response.headers.get('content-disposition')||'';const match=disposition.match(/filename=([^;]+)/i);return{blob,filename:match?.[1]?.replaceAll('"','')||`FieldOps-IPC.${format}`}}
