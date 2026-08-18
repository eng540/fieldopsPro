"""PROJECTS Router — FieldOps V4.0

Project configuration is the source of truth for project BOQ definitions.
Units only reference/apply BOQ definitions through UnitBoQAssignment.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.modules.iam.dependencies import get_current_user
from app.modules.projects.models import BOQItem, Project, ProjectDictionary, ProjectUnit, UnitBoQAssignment
from app.modules.projects.schemas import (
    BOQItemCreate, BOQItemRead, ProjectCreate, ProjectListResponse, ProjectRead, ProjectUpdate,
    UnitCreate, UnitListResponse, UnitRead, UnitBoQAssignmentCreate, UnitBoQAssignmentRead,
    DictionaryCreate, DictionaryRead, DictionaryUpdate,
)

router = APIRouter()


def project_with_relationships(project_id: int, org_id: int):
    return select(Project).where(Project.id == project_id, Project.org_id == org_id).options(
        selectinload(Project.boq_items),
        selectinload(Project.units).selectinload(ProjectUnit.boq_items),
    )


@router.post("", response_model=ProjectRead, status_code=201)
async def create_project(data: ProjectCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> Project:
    org_id = current_user["org_id"]
    existing = await db.execute(select(Project).where(Project.org_id == org_id, Project.code == data.code.upper()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Project code '{data.code}' already exists in org.")
    project = Project(org_id=org_id, created_by=current_user["id"], **data.model_dump())
    db.add(project)
    await db.flush()
    project = (await db.execute(project_with_relationships(project.id, org_id))).scalar_one()
    project.assignments = []
    return project


@router.get("/dictionaries", response_model=list[DictionaryRead])
async def list_dictionaries(kind: str | None = Query(None), project_id: int | None = Query(None), db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> list[ProjectDictionary]:
    org_id = current_user["org_id"]
    query = select(ProjectDictionary).where(ProjectDictionary.org_id == org_id, ProjectDictionary.is_active.is_(True))
    if kind:
        query = query.where(ProjectDictionary.kind == kind)
    if project_id is not None:
        query = query.where((ProjectDictionary.project_id == project_id) | (ProjectDictionary.project_id.is_(None)))
    return list((await db.execute(query.order_by(ProjectDictionary.sort_order, ProjectDictionary.value))).scalars().all())


@router.post("/dictionaries", response_model=DictionaryRead, status_code=201)
async def create_dictionary(data: DictionaryCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> ProjectDictionary:
    org_id = current_user["org_id"]
    if data.project_id is not None:
        project = (await db.execute(select(Project).where(Project.id == data.project_id, Project.org_id == org_id))).scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
    existing = await db.execute(select(ProjectDictionary).where(ProjectDictionary.org_id == org_id, ProjectDictionary.project_id == data.project_id, ProjectDictionary.kind == data.kind, ProjectDictionary.key == data.key))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Dictionary key already exists in this scope")
    item = ProjectDictionary(org_id=org_id, **data.model_dump())
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


@router.patch("/dictionaries/{dictionary_id}", response_model=DictionaryRead)
async def update_dictionary(dictionary_id: int, data: DictionaryUpdate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> ProjectDictionary:
    item = (await db.execute(select(ProjectDictionary).where(ProjectDictionary.id == dictionary_id, ProjectDictionary.org_id == current_user["org_id"]))).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Dictionary entry not found")
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(item, key, value)
    await db.flush()
    await db.refresh(item)
    return item


@router.get("", response_model=ProjectListResponse)
async def list_projects(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), status_filter: str | None = Query(None, alias="status"), db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict:
    org_id = current_user["org_id"]
    query = select(Project).where(Project.org_id == org_id, Project.is_active.is_(True)).options(
        selectinload(Project.boq_items), selectinload(Project.units).selectinload(ProjectUnit.boq_items)
    )
    count_query = select(func.count()).select_from(Project).where(Project.org_id == org_id, Project.is_active.is_(True))
    if status_filter:
        query = query.where(Project.status == status_filter)
        count_query = count_query.where(Project.status == status_filter)
    total = (await db.execute(count_query)).scalar_one()
    items = (await db.execute(query.order_by(Project.created_at.desc()).offset((page-1)*page_size).limit(page_size))).scalars().all()
    for item in items:
        item.assignments = []
    return {"items": items, "total": total, "page": page, "page_size": page_size, "has_more": (page-1)*page_size+len(items) < total}


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(project_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> Project:
    project = (await db.execute(project_with_relationships(project_id, current_user["org_id"]))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")
    project.assignments = []
    return project


@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(project_id: int, data: ProjectUpdate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> Project:
    org_id = current_user["org_id"]
    project = (await db.execute(select(Project).where(Project.id == project_id, Project.org_id == org_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(project, k, v)
    await db.flush()
    project = (await db.execute(project_with_relationships(project_id, org_id))).scalar_one()
    project.assignments = []
    return project


@router.post("/{project_id}/units", response_model=UnitRead, status_code=201)
async def create_unit(project_id: int, data: UnitCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> ProjectUnit:
    org_id = current_user["org_id"]
    project = (await db.execute(select(Project).where(Project.id == project_id, Project.org_id == org_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")
    unit = ProjectUnit(org_id=org_id, project_id=project_id, **data.model_dump())
    db.add(unit)
    project.total_units = (project.total_units or 0) + 1
    await db.flush()
    unit = (await db.execute(select(ProjectUnit).where(ProjectUnit.id == unit.id).options(selectinload(ProjectUnit.boq_items)))).scalar_one()
    return unit


@router.get("/{project_id}/units", response_model=UnitListResponse)
async def list_units(project_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> dict:
    items = (await db.execute(
        select(ProjectUnit).where(ProjectUnit.project_id == project_id, ProjectUnit.org_id == current_user["org_id"])
        .options(selectinload(ProjectUnit.boq_items))
    )).scalars().all()
    return {"items": items, "total": len(items)}


@router.get("/{project_id}/boq", response_model=list[BOQItemRead])
async def list_project_boq(project_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> list[BOQItem]:
    org_id = current_user["org_id"]
    project = (await db.execute(select(Project.id).where(Project.id == project_id, Project.org_id == org_id))).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return list((await db.execute(select(BOQItem).where(BOQItem.project_id == project_id, BOQItem.org_id == org_id, BOQItem.is_active.is_(True)).order_by(BOQItem.sequence, BOQItem.code))).scalars().all())


@router.post("/{project_id}/boq", response_model=BOQItemRead, status_code=201)
async def create_project_boq(project_id: int, data: BOQItemCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> BOQItem:
    org_id = current_user["org_id"]
    project = (await db.execute(select(Project).where(Project.id == project_id, Project.org_id == org_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if data.code:
        code = data.code.strip().upper()
        duplicate = (await db.execute(select(BOQItem).where(BOQItem.project_id == project_id, BOQItem.code == code))).scalar_one_or_none()
        if duplicate:
            raise HTTPException(status_code=409, detail="BOQ code already exists in this project")
    else:
        count = (await db.execute(select(func.count()).select_from(BOQItem).where(BOQItem.project_id == project_id))).scalar_one()
        code = f"BOQ-{count + 1:04d}"
    item = BOQItem(org_id=org_id, project_id=project_id, code=code, amount=float(data.quantity * data.rate), **data.model_dump(exclude={"code"}))
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


@router.post("/{project_id}/units/{unit_id}/boq/{boq_item_id}", response_model=UnitBoQAssignmentRead, status_code=201)
async def assign_boq_to_unit(project_id: int, unit_id: int, boq_item_id: int, data: UnitBoQAssignmentCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> UnitBoQAssignment:
    org_id = current_user["org_id"]
    unit = (await db.execute(select(ProjectUnit).where(ProjectUnit.id == unit_id, ProjectUnit.project_id == project_id, ProjectUnit.org_id == org_id))).scalar_one_or_none()
    item = (await db.execute(select(BOQItem).where(BOQItem.id == boq_item_id, BOQItem.project_id == project_id, BOQItem.org_id == org_id, BOQItem.is_active.is_(True)))).scalar_one_or_none()
    if not unit or not item:
        raise HTTPException(status_code=404, detail="Unit or BOQ item not found in project")
    existing = (await db.execute(select(UnitBoQAssignment).where(UnitBoQAssignment.unit_id == unit_id, UnitBoQAssignment.boq_item_id == boq_item_id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="BOQ item is already assigned to this unit")
    assignment = UnitBoQAssignment(org_id=org_id, unit_id=unit_id, boq_item_id=boq_item_id, **data.model_dump())
    db.add(assignment)
    await db.flush()
    await db.refresh(assignment)
    return assignment


@router.post("/{project_id}/units/{unit_id}/boq", response_model=BOQItemRead, status_code=201)
async def legacy_create_or_assign_boq(project_id: int, unit_id: int, data: BOQItemCreate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> BOQItem:
    """Compatibility facade: assign an existing project BOQ item; never create BOQ from a unit context."""
    org_id = current_user["org_id"]
    unit = (await db.execute(select(ProjectUnit).where(ProjectUnit.id == unit_id, ProjectUnit.project_id == project_id, ProjectUnit.org_id == org_id))).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found in project")

    query = select(BOQItem).where(
        BOQItem.project_id == project_id,
        BOQItem.org_id == org_id,
        BOQItem.is_active.is_(True),
        BOQItem.trade == data.trade,
        BOQItem.description == data.description,
        BOQItem.unit_of_measure == data.unit_of_measure,
    )
    if data.code:
        query = query.where(BOQItem.code == data.code.strip().upper())
    item = (await db.execute(query)).scalars().first()
    if item is None:
        raise HTTPException(
            status_code=409,
            detail="Master BOQ item not found; create it under project BOQ before assigning it to a unit",
        )

    existing = (await db.execute(select(UnitBoQAssignment).where(UnitBoQAssignment.unit_id == unit_id, UnitBoQAssignment.boq_item_id == item.id))).scalar_one_or_none()
    if existing is None:
        db.add(UnitBoQAssignment(org_id=org_id, unit_id=unit_id, boq_item_id=item.id, planned_quantity=data.quantity))
        await db.flush()
    return item


@router.get("/{project_id}/units/{unit_id}/boq", response_model=list[BOQItemRead])
async def list_unit_boq(project_id: int, unit_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(get_current_user)) -> list[BOQItem]:
    org_id = current_user["org_id"]
    unit = (await db.execute(select(ProjectUnit).where(ProjectUnit.id == unit_id, ProjectUnit.project_id == project_id, ProjectUnit.org_id == org_id))).scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found in project")
    return list((await db.execute(
        select(BOQItem).join(UnitBoQAssignment, UnitBoQAssignment.boq_item_id == BOQItem.id)
        .where(UnitBoQAssignment.unit_id == unit_id, BOQItem.project_id == project_id, BOQItem.org_id == org_id, UnitBoQAssignment.is_active.is_(True))
        .order_by(BOQItem.sequence, BOQItem.code)
    )).scalars().all())
