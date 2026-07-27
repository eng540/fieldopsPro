"""Projects Pydantic Schemas — FieldOps V4.0"""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    code: str = Field(min_length=1, max_length=50)
    description: str | None = None
    location: str | None = None
    start_date: str | None = None
    end_date: str | None = None

    @field_validator("code")
    @classmethod
    def code_uppercase(cls, v: str) -> str:
        return v.upper().strip()


class ProjectRead(BaseModel):
    id: int
    org_id: int
    name: str
    code: str
    description: str | None
    status: str
    location: str | None
    start_date: str | None
    end_date: str | None
    total_units: int
    completion_pct: float
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    description: str | None = None
    status: str | None = None
    location: str | None = None
    start_date: str | None = None
    end_date: str | None = None


class ProjectListResponse(BaseModel):
    items: list[ProjectRead]
    total: int
    page: int
    page_size: int
    has_more: bool


class UnitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=50)
    unit_type: str | None = None
    floor: int | None = None
    area_sqm: float | None = None

    @field_validator("code")
    @classmethod
    def code_uppercase(cls, v: str) -> str:
        return v.upper().strip()


class UnitRead(BaseModel):
    id: int
    org_id: int
    project_id: int
    name: str
    code: str
    unit_type: str | None
    floor: int | None
    area_sqm: float | None
    status: str
    completion_pct: float
    is_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class UnitListResponse(BaseModel):
    items: list[UnitRead]
    total: int


class BOQItemCreate(BaseModel):
    trade: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1)
    quantity: float = Field(ge=0)
    unit_of_measure: str = Field(default="item", max_length=50)


class BOQItemRead(BaseModel):
    id: int
    org_id: int
    unit_id: int
    trade: str
    description: str
    quantity: float
    unit_of_measure: str
    completion_pct: float
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}
