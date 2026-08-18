"""Quality Control Router — FieldOps V4.0.

The remark row is the materialized current state. Every lifecycle transition is
also appended to remark_status_events, giving the system a complete, auditable
execution-quality trail suitable for offline synchronization and governance.
"""
from datetime import datetime, timezone
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.iam.dependencies import get_current_user
from app.modules.quality.models import (
    Remark,
    RemarkSeverity,
    RemarkStatus,
    RemarkStatusEvent,
    RemarkTemplate,
    REMARK_STATUS_TRANSITIONS,
)
from app.modules.quality.schemas import (
    RemarkCreate,
    RemarkListResponse,
    RemarkStatusEventListResponse,
    RemarkStatusUpdate,
    RemarkTemplateCreate,
    RemarkRead,
    RemarkTemplateRead,
)
from app.modules.projects.models import ProjectUnit

router = APIRouter()
_AUTO_HOLD_SEVERITIES = {RemarkSeverity.CRITICAL.value, RemarkSeverity.MAJOR.value}
_TRANSITION_ROLES = {"FIELD_ENGINEER", "PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}
_VERIFICATION_ROLES = {"PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}


@router.post("/remarks", response_model=RemarkRead, status_code=201)
async def create_remark(data: RemarkCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> Remark:
    org_id, user_id = current_user["org_id"], current_user["id"]
    role = current_user.get("role", "")
    if role == "VIEWER":
        raise HTTPException(status_code=403, detail="VIEWER role cannot create quality remarks.")
    existing = (await db.execute(select(Remark).where(Remark.id == data.id, Remark.org_id == org_id))).scalar_one_or_none()
    if existing:
        return existing
    if not data.template_id and not data.custom_issue:
        raise HTTPException(status_code=422, detail="Provide template_id or custom_issue.")
    remark = Remark(org_id=org_id, created_by=user_id, status=RemarkStatus.OPEN.value, **data.model_dump())
    db.add(remark)
    await db.flush()
    db.add(RemarkStatusEvent(
        org_id=org_id, remark_id=remark.id, from_status=None, to_status=RemarkStatus.OPEN.value,
        reason="Remark created", actor_id=user_id,
        event_metadata={"severity": remark.severity, "source": "quality.create"},
    ))
    if remark.severity in _AUTO_HOLD_SEVERITIES:
        await _create_governance_hold(db, org_id, remark, user_id)
    await db.flush()
    await db.refresh(remark)
    return remark


@router.patch("/remarks/{remark_id}", response_model=RemarkRead)
async def update_remark_status(remark_id: str, data: RemarkStatusUpdate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> Remark:
    org_id, user_id = current_user["org_id"], current_user["id"]
    role = current_user.get("role", "")
    target = data.status.value
    if role not in _TRANSITION_ROLES:
        raise HTTPException(status_code=403, detail=f"Role '{role}' cannot change remark status.")
    if target in {RemarkStatus.VERIFIED.value, RemarkStatus.RESOLVED.value, RemarkStatus.CLOSED.value} and role not in _VERIFICATION_ROLES:
        raise HTTPException(status_code=403, detail="Verification and closure require project management or admin authority.")

    result = await db.execute(select(Remark).where(Remark.id == remark_id, Remark.org_id == org_id).with_for_update())
    remark = result.scalar_one_or_none()
    if not remark:
        raise HTTPException(status_code=404, detail=f"Remark {remark_id} not found.")
    current = remark.status
    if target == current:
        raise HTTPException(status_code=409, detail=f"Remark is already in status {current}.")
    if target not in REMARK_STATUS_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=409, detail=f"Invalid remark transition: {current} -> {target}.")
    if target == RemarkStatus.REWORK_REQUIRED.value and (not data.reason or len(data.reason.strip()) < 20):
        raise HTTPException(status_code=422, detail="REWORK_REQUIRED requires a reason of at least 20 characters.")
    if target == RemarkStatus.RESUBMITTED.value and (not data.reason or len(data.reason.strip()) < 10):
        raise HTTPException(status_code=422, detail="RESUBMITTED requires a reason of at least 10 characters.")
    if target in {RemarkStatus.VERIFIED.value, RemarkStatus.RESOLVED.value} and not (data.resolution_notes or remark.resolution_notes):
        raise HTTPException(status_code=422, detail="Verification requires resolution_notes.")
    if target == RemarkStatus.CLOSED.value and current not in {RemarkStatus.VERIFIED.value, RemarkStatus.RESOLVED.value}:
        raise HTTPException(status_code=409, detail="Only VERIFIED/RESOLVED remarks can be CLOSED.")

    remark.status = target
    if data.resolution_notes:
        remark.resolution_notes = data.resolution_notes
    if data.resolution_photos is not None:
        remark.resolution_photos = data.resolution_photos
    if target in {RemarkStatus.VERIFIED.value, RemarkStatus.RESOLVED.value, RemarkStatus.CLOSED.value}:
        remark.resolved_at = datetime.now(timezone.utc)

    db.add(RemarkStatusEvent(
        org_id=org_id, remark_id=remark.id, from_status=current, to_status=target,
        reason=data.reason, resolution_notes=data.resolution_notes, actor_id=user_id,
        event_metadata={"source": "quality.lifecycle", "role": role},
    ))
    if target == RemarkStatus.REWORK_REQUIRED.value:
        await _create_governance_rework(db, org_id, remark, user_id, data.reason or "QC rework required")
    await db.flush()
    await db.refresh(remark)
    return remark


@router.get("/remarks", response_model=RemarkListResponse)
async def list_remarks(unit_id: int | None = Query(None), severity: str | None = Query(None), remark_status: str | None = Query(None, alias="status"), work_order_id: int | None = Query(None), db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict:
    org_id = current_user["org_id"]
    filters = [Remark.org_id == org_id, ProjectUnit.org_id == org_id]
    if unit_id is not None: filters.append(Remark.unit_id == unit_id)
    if severity: filters.append(Remark.severity == severity)
    if remark_status: filters.append(Remark.status == remark_status)
    if work_order_id is not None: filters.append(Remark.work_order_id == work_order_id)
    rows = (await db.execute(
        select(Remark, ProjectUnit)
        .join(ProjectUnit, ProjectUnit.id == Remark.unit_id)
        .where(*filters)
        .order_by(Remark.created_at.desc())
    )).all()
    items = []
    for remark, unit in rows:
        item = {column.name: getattr(remark, column.name) for column in Remark.__table__.columns}
        item["unit"] = {
            "id": unit.id,
            "name": unit.name,
            "code": unit.code,
            "project_id": unit.project_id,
            "unit_type": unit.unit_type,
        }
        items.append(item)
    closed = {RemarkStatus.CLOSED.value, RemarkStatus.RESOLVED.value}
    return {"items": items, "total": len(items), "open_count": sum(1 for r, _ in rows if r.status not in closed), "critical_count": sum(1 for r, _ in rows if r.severity == RemarkSeverity.CRITICAL.value)}


@router.get("/remarks/{remark_id}/history", response_model=RemarkStatusEventListResponse)
async def get_remark_history(remark_id: str, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict:
    org_id = current_user["org_id"]
    exists = (await db.execute(select(Remark.id).where(Remark.id == remark_id, Remark.org_id == org_id))).scalar_one_or_none()
    if not exists:
        raise HTTPException(status_code=404, detail=f"Remark {remark_id} not found.")
    items = (await db.execute(select(RemarkStatusEvent).where(RemarkStatusEvent.remark_id == remark_id, RemarkStatusEvent.org_id == org_id).order_by(RemarkStatusEvent.occurred_at.asc(), RemarkStatusEvent.id.asc()))).scalars().all()
    return {"items": items, "total": len(items)}


@router.post("/templates", response_model=RemarkTemplateRead, status_code=201)
async def create_template(data: RemarkTemplateCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> RemarkTemplate:
    if current_user.get("role") not in {"PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}:
        raise HTTPException(status_code=403, detail="Only management/admin roles can create QC templates.")
    tmpl = RemarkTemplate(org_id=current_user["org_id"], created_by=current_user["id"], **data.model_dump())
    db.add(tmpl)
    await db.flush()
    await db.refresh(tmpl)
    return tmpl


@router.get("/templates", response_model=list[RemarkTemplateRead])
async def list_templates(category: str | None = Query(None), db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> list[RemarkTemplate]:
    q = select(RemarkTemplate).where(RemarkTemplate.org_id == current_user["org_id"], RemarkTemplate.is_active.is_(True))
    if category: q = q.where(RemarkTemplate.category == category)
    return (await db.execute(q.order_by(RemarkTemplate.category, RemarkTemplate.issue))).scalars().all()


async def _create_governance_hold(db: AsyncSession, org_id: int, remark: Remark, triggered_by: int) -> None:
    from app.modules.governance.models import GovernanceDecision
    db.add(GovernanceDecision(
        org_id=org_id, unit_id=remark.unit_id, boq_item_id=None, remark_id=remark.id,
        decision="HOLD", payment_pct=0.0, flag=f"Auto-Hold: {remark.severity} defect detected",
        matched_rule="AUTO_HOLD_ON_MAJOR_DEFECT", reason=f"QC remark severity={remark.severity} triggered automatic payment hold.",
        policy_version=1, explainability={"rule": "AUTO_HOLD_ON_MAJOR_DEFECT", "severity": remark.severity, "auto_hold": True},
        triggered_by=triggered_by, is_overridden=False,
    ))


async def _create_governance_rework(db: AsyncSession, org_id: int, remark: Remark, triggered_by: int, reason: str) -> None:
    from app.modules.governance.models import GovernanceDecision
    db.add(GovernanceDecision(
        org_id=org_id, unit_id=remark.unit_id, boq_item_id=None, remark_id=remark.id,
        decision="REWORK", payment_pct=0.0, flag="QC rework required", matched_rule="QC_REWORK_REQUIRED",
        reason=reason, policy_version=1, explainability={"rule": "QC_REWORK_REQUIRED", "severity": remark.severity},
        triggered_by=triggered_by, is_overridden=False,
    ))


_UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/tmp/fieldops_uploads")
_MAX_FILE_BYTES = 10 * 1024 * 1024
_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic"}
_MAX_FILES_PER_REMARK = 20


@router.post("/remarks/{remark_id}/photos")
async def upload_remark_photos(remark_id: str, files: list[UploadFile] = File(...), db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict:
    org_id = current_user["org_id"]
    remark = (await db.execute(select(Remark).where(Remark.id == remark_id, Remark.org_id == org_id).with_for_update())).scalar_one_or_none()
    if not remark: raise HTTPException(status_code=404, detail=f"Remark {remark_id} not found.")
    if current_user.get("role") == "VIEWER": raise HTTPException(status_code=403, detail="VIEWER role cannot upload evidence.")
    existing = list(remark.photos or [])
    if len(existing) + len(files) > _MAX_FILES_PER_REMARK: raise HTTPException(status_code=422, detail=f"Max {_MAX_FILES_PER_REMARK} photos per remark.")
    urls = []
    for upload in files:
        if (upload.content_type or "") not in _ALLOWED_MIME: raise HTTPException(status_code=415, detail=f"Unsupported file type: {upload.content_type}.")
        content = await upload.read()
        if len(content) > _MAX_FILE_BYTES: raise HTTPException(status_code=413, detail=f"File '{upload.filename}' exceeds 10 MB.")
        urls.append(await _save_file(content, upload.filename or "photo.jpg", remark_id))
    remark.photos = existing + urls
    await db.flush()
    return {"remark_id": remark_id, "uploaded": len(urls), "total_photos": len(remark.photos), "urls": urls}


async def _save_file(content: bytes, filename: str, remark_id: str) -> str:
    from app.core.config import settings
    ext = os.path.splitext(filename)[-1].lower() or ".jpg"
    new_name = f"remarks/{remark_id}/{uuid.uuid4().hex[:8]}{ext}"
    if settings.S3_ACCESS_KEY_ID and settings.S3_SECRET_ACCESS_KEY:
        try:
            import aioboto3
            session = aioboto3.Session()
            kwargs = {"aws_access_key_id": settings.S3_ACCESS_KEY_ID, "aws_secret_access_key": settings.S3_SECRET_ACCESS_KEY, "region_name": settings.S3_REGION}
            if settings.S3_ENDPOINT_URL: kwargs["endpoint_url"] = settings.S3_ENDPOINT_URL
            async with session.client("s3", **kwargs) as client:
                await client.put_object(Bucket=settings.S3_BUCKET_NAME, Key=new_name, Body=content, ContentType={".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic"}.get(ext, "image/jpeg"))
            if settings.S3_PUBLIC_URL_PREFIX: return f"{settings.S3_PUBLIC_URL_PREFIX.rstrip('/')}/{new_name}"
            if settings.S3_ENDPOINT_URL: return f"{settings.S3_ENDPOINT_URL.rstrip('/')}/{settings.S3_BUCKET_NAME}/{new_name}"
            return f"https://{settings.S3_BUCKET_NAME}.s3.{settings.S3_REGION}.amazonaws.com/{new_name}"
        except Exception:
            pass
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    path = os.path.join(settings.UPLOAD_DIR, new_name.replace("/", "_"))
    try:
        import aiofiles
        async with aiofiles.open(path, "wb") as f: await f.write(content)
    except ImportError:
        with open(path, "wb") as f: f.write(content)
    return f"/uploads/{new_name.replace('/', '_')}"
