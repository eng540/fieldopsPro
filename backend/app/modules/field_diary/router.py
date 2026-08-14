"""Daily Site Diary API — tenant-scoped, offline-sync friendly."""
from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.iam.dependencies import get_current_user
from app.modules.projects.models import Project
from .models import FieldDiaryEntry
from .schemas import FieldDiaryCreate, FieldDiaryListResponse, FieldDiaryRead

router = APIRouter()


@router.get("", response_model=FieldDiaryListResponse)
async def list_diary(
    project_id: int | None = Query(default=None, gt=0),
    from_date: date | None = None,
    to_date: date | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = current_user["org_id"]
    query = select(FieldDiaryEntry).where(FieldDiaryEntry.org_id == org_id)
    count = select(func.count()).select_from(FieldDiaryEntry).where(FieldDiaryEntry.org_id == org_id)
    if project_id is not None:
        query = query.where(FieldDiaryEntry.project_id == project_id)
        count = count.where(FieldDiaryEntry.project_id == project_id)
    if from_date:
        query = query.where(FieldDiaryEntry.diary_date >= from_date)
        count = count.where(FieldDiaryEntry.diary_date >= from_date)
    if to_date:
        query = query.where(FieldDiaryEntry.diary_date <= to_date)
        count = count.where(FieldDiaryEntry.diary_date <= to_date)
    rows = (await db.execute(query.order_by(FieldDiaryEntry.diary_date.desc(), FieldDiaryEntry.created_at.desc()))).scalars().all()
    total = (await db.execute(count)).scalar_one()
    return {"items": rows, "total": total}


@router.post("", response_model=FieldDiaryRead, status_code=201)
async def create_diary(
    data: FieldDiaryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    org_id = current_user["org_id"]
    user_id = current_user["id"]
    project = (await db.execute(select(Project).where(Project.id == data.project_id, Project.org_id == org_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    existing = (await db.execute(select(FieldDiaryEntry).where(
        FieldDiaryEntry.org_id == org_id,
        FieldDiaryEntry.project_id == data.project_id,
        FieldDiaryEntry.diary_date == data.diary_date,
        FieldDiaryEntry.created_by == user_id,
    ))).scalar_one_or_none()
    if existing:
        for key, value in data.model_dump().items():
            setattr(existing, key, value)
        await db.flush()
        await db.refresh(existing)
        return existing
    entry = FieldDiaryEntry(id=str(uuid4()), org_id=org_id, created_by=user_id, **data.model_dump())
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    return entry


@router.get("/{entry_id}", response_model=FieldDiaryRead)
async def get_diary(entry_id: str, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)):
    row = (await db.execute(select(FieldDiaryEntry).where(FieldDiaryEntry.id == entry_id, FieldDiaryEntry.org_id == current_user["org_id"]))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Diary entry not found")
    return row
