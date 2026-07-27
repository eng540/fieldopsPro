"""Quality Control Router — FieldOps V4.0 (Sprint-3)

Endpoints (5):
1. POST  /quality/remarks           — Create remark (UUID-idempotent, append-only)
2. PATCH /quality/remarks/{id}      — Update status / resolve
3. GET   /quality/remarks           — List remarks (filtered)
4. POST  /quality/templates         — Create remark template
5. GET   /quality/templates         — List templates

Constitutional:
- Remarks use client UUID → offline idempotency
- CRITICAL/MAJOR → auto-triggers Governance HOLD
- org_id always from JWT
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.iam.dependencies import get_current_user
from app.modules.quality.models import Remark, RemarkSeverity, RemarkStatus, RemarkTemplate
from app.modules.quality.schemas import (
    RemarkCreate, RemarkListResponse, RemarkRead,
    RemarkStatusUpdate, RemarkTemplateCreate, RemarkTemplateRead,
)

router = APIRouter()

_AUTO_HOLD_SEVERITIES = {RemarkSeverity.CRITICAL.value, RemarkSeverity.MAJOR.value}


@router.post("/remarks", response_model=RemarkRead, status_code=201)
async def create_remark(
    data: RemarkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> Remark:
    """Append-only. UUID from client ensures offline idempotency."""
    org_id = current_user["org_id"]

    existing = (await db.execute(
        select(Remark).where(Remark.id == data.id)
    )).scalar_one_or_none()
    if existing:
        return existing

    if not data.template_id and not data.custom_issue:
        raise HTTPException(status_code=422, detail="Provide template_id or custom_issue.")

    remark = Remark(org_id=org_id, created_by=current_user["id"], **data.model_dump())
    db.add(remark)
    await db.flush()

    if remark.severity in _AUTO_HOLD_SEVERITIES:
        await _auto_hold(db, org_id, remark, current_user["id"])

    await db.refresh(remark)
    return remark


@router.patch("/remarks/{remark_id}", response_model=RemarkRead)
async def update_remark_status(
    remark_id: str,
    data: RemarkStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> Remark:
    org_id = current_user["org_id"]
    remark = (await db.execute(
        select(Remark).where(Remark.id == remark_id, Remark.org_id == org_id)
    )).scalar_one_or_none()
    if not remark:
        raise HTTPException(status_code=404, detail=f"Remark {remark_id} not found.")

    remark.status = data.status
    if data.resolution_notes:
        remark.resolution_notes = data.resolution_notes
    if data.resolution_photos:
        remark.resolution_photos = data.resolution_photos
    if data.status in (RemarkStatus.RESOLVED.value, RemarkStatus.CLOSED.value):
        remark.resolved_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(remark)
    return remark


@router.get("/remarks", response_model=RemarkListResponse)
async def list_remarks(
    unit_id: int | None = Query(None),
    severity: str | None = Query(None),
    remark_status: str | None = Query(None, alias="status"),
    work_order_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    org_id = current_user["org_id"]
    q = select(Remark).where(Remark.org_id == org_id)
    if unit_id:       q = q.where(Remark.unit_id == unit_id)
    if severity:      q = q.where(Remark.severity == severity)
    if remark_status: q = q.where(Remark.status == remark_status)
    if work_order_id: q = q.where(Remark.work_order_id == work_order_id)
    items = (await db.execute(q.order_by(Remark.created_at.desc()))).scalars().all()
    return {
        "items": items,
        "total": len(items),
        "open_count": sum(1 for r in items if r.status == RemarkStatus.OPEN.value),
        "critical_count": sum(1 for r in items if r.severity == RemarkSeverity.CRITICAL.value),
    }


@router.post("/templates", response_model=RemarkTemplateRead, status_code=201)
async def create_template(
    data: RemarkTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> RemarkTemplate:
    tmpl = RemarkTemplate(
        org_id=current_user["org_id"],
        created_by=current_user["id"],
        **data.model_dump(),
    )
    db.add(tmpl)
    await db.flush()
    await db.refresh(tmpl)
    return tmpl


@router.get("/templates", response_model=list[RemarkTemplateRead])
async def list_templates(
    category: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> list[RemarkTemplate]:
    q = select(RemarkTemplate).where(
        RemarkTemplate.org_id == current_user["org_id"],
        RemarkTemplate.is_active.is_(True),
    )
    if category:
        q = q.where(RemarkTemplate.category == category)
    return (await db.execute(q.order_by(RemarkTemplate.category))).scalars().all()


async def _auto_hold(db: AsyncSession, org_id: int, remark: Remark, triggered_by: int) -> None:
    """Auto-trigger governance HOLD on CRITICAL/MAJOR severity."""
    try:
        from app.modules.governance.models import GovernanceDecision
        decision = GovernanceDecision(
            org_id=org_id,
            unit_id=remark.unit_id,
            boq_item_id=None,
            remark_id=remark.id,
            decision="HOLD",
            payment_pct=0.0,
            flag=f"Auto-Hold: {remark.severity} defect detected",
            matched_rule="AUTO_HOLD_ON_MAJOR_DEFECT",
            reason=f"QC remark severity={remark.severity} triggered automatic payment hold.",
            policy_version=1,
            explainability={
                "rule": "AUTO_HOLD_ON_MAJOR_DEFECT",
                "severity": remark.severity,
                "auto_hold": True,
            },
            triggered_by=triggered_by,
            is_overridden=False,
        )
        db.add(decision)
        await db.flush()
    except Exception:
        pass  # governance table may not exist yet — non-fatal


# ═══════════════════════════════════════════════════════════════════════════
# ENDPOINT 6: PHOTO UPLOAD — POST /quality/remarks/{id}/photos (Sprint-4 M1.3)
# ═══════════════════════════════════════════════════════════════════════════

import os, uuid as _uuid
from fastapi import UploadFile, File
from fastapi.responses import JSONResponse

_UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/tmp/fieldops_uploads")
_MAX_FILE_BYTES = 10 * 1024 * 1024   # 10 MB per file
_ALLOWED_MIME   = {"image/jpeg", "image/png", "image/webp", "image/heic"}
_MAX_FILES_PER_REMARK = 20


@router.post(
    "/remarks/{remark_id}/photos",
    summary="Upload photos for a QC remark",
    description=(
        "Uploads one or more photos attached to a remark. "
        "Supported types: JPEG, PNG, WebP, HEIC. Max 10 MB per file, max 20 files per remark. "
        "Returns list of saved URLs. "
        "In production: swap _save_file() for S3/B2 presigned upload."
    ),
    responses={
        200: {"description": "Photos uploaded, remark updated"},
        404: {"description": "Remark not found"},
        413: {"description": "File too large (>10 MB)"},
        415: {"description": "Unsupported media type"},
        422: {"description": "Max 20 photos per remark exceeded"},
    },
)
async def upload_remark_photos(
    remark_id: str,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    org_id = current_user["org_id"]

    # Fetch remark
    remark = (await db.execute(
        select(Remark).where(Remark.id == remark_id, Remark.org_id == org_id)
    )).scalar_one_or_none()
    if not remark:
        raise HTTPException(status_code=404, detail=f"Remark {remark_id} not found.")

    existing_photos: list = remark.photos or []
    if len(existing_photos) + len(files) > _MAX_FILES_PER_REMARK:
        raise HTTPException(
            status_code=422,
            detail=f"Max {_MAX_FILES_PER_REMARK} photos per remark. "
                   f"Already has {len(existing_photos)}, attempted to add {len(files)}.",
        )

    saved_urls: list[str] = []

    for upload in files:
        # Validate MIME type
        content_type = upload.content_type or ""
        if content_type not in _ALLOWED_MIME:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported file type: {content_type}. Allowed: {sorted(_ALLOWED_MIME)}",
            )

        # Read file and check size
        content = await upload.read()
        if len(content) > _MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File '{upload.filename}' exceeds 10 MB limit ({len(content)/(1024*1024):.1f} MB).",
            )

        # Save file (local dev storage; replace with S3 in production)
        url = await _save_file(content, upload.filename or "photo.jpg", remark_id)
        saved_urls.append(url)

    # Update remark.photos (append new URLs)
    remark.photos = existing_photos + saved_urls
    await db.flush()
    await db.refresh(remark)

    return {
        "remark_id":    remark_id,
        "uploaded":     len(saved_urls),
        "total_photos": len(remark.photos),
        "urls":         saved_urls,
    }


async def _save_file(content: bytes, filename: str, remark_id: str) -> str:
    """Save file to local disk. Replace with S3/B2 presigned upload in production."""
    import aiofiles
    os.makedirs(_UPLOAD_DIR, exist_ok=True)
    ext      = os.path.splitext(filename)[-1].lower() or ".jpg"
    new_name = f"{remark_id}_{_uuid.uuid4().hex[:8]}{ext}"
    path     = os.path.join(_UPLOAD_DIR, new_name)

    try:
        import aiofiles
        async with aiofiles.open(path, "wb") as f:
            await f.write(content)
    except ImportError:
        # aiofiles not installed — sync fallback for dev
        with open(path, "wb") as f:
            f.write(content)

    return f"/uploads/{new_name}"   # Served via static mount in main.py
