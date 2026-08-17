"""Projects Pydantic Schemas — FieldOps V4.0"""
from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=255); code: str = Field(min_length=1, max_length=50); description: str | None = None; location: str | None = None; start_date: str | None = None; end_date: str | None = None
    @field_validator("code")
    @classmethod
    def code_uppercase(cls, v: str) -> str: return v.upper().strip()


class BOQItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str | None = Field(default=None, max_length=80); category: str | None = Field(default=None, max_length=120); trade: str = Field(min_length=1, max_length=100); description: str = Field(min_length=1); quantity: float = Field(ge=0); rate: float = Field(default=0, ge=0); unit_of_measure: str = Field(default="item", max_length=50); sequence: int = Field(default=0, ge=0); extra_data: dict[str, Any] | None = None


class BOQItemRead(BaseModel):
    id: int; org_id: int; project_id: int; code: str; category: str | None; trade: str; description: str; quantity: float; rate: float; amount: float; unit_of_measure: str; sequence: int; completion_pct: float; is_active: bool; created_at: datetime
    model_config = {"from_attributes": True}


class UnitBoQAssignmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    planned_quantity: float = Field(default=0, ge=0); is_active: bool = True; extra_data: dict[str, Any] | None = None


class UnitBoQAssignmentRead(BaseModel):
    id: int; org_id: int; unit_id: int; boq_item_id: int; planned_quantity: float; is_active: bool; extra_data: dict[str, Any] | None; created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


class UnitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255); code: str = Field(min_length=1, max_length=50); unit_type: str | None = None; floor: int | None = None; area_sqm: float | None = None
    @field_validator("code")
    @classmethod
    def code_uppercase(cls, v: str) -> str: return v.upper().strip()


class UnitRead(BaseModel):
    id: int; org_id: int; project_id: int; name: str; code: str; unit_type: str | None; floor: int | None; area_sqm: float | None; status: str; completion_pct: float; is_active: bool; created_at: datetime; updated_at: datetime
    boq_items: list[BOQItemRead] = Field(default_factory=list)
    model_config = {"from_attributes": True}


class UnitListResponse(BaseModel): items: list[UnitRead]; total: int


class ProjectRead(BaseModel):
    id: int; org_id: int; name: str; code: str; description: str | None; status: str; location: str | None; start_date: str | None; end_date: str | None; total_units: int; completion_pct: float; is_active: bool; created_at: datetime; updated_at: datetime
    units: list[UnitRead] = Field(default_factory=list); boq_items: list[BOQItemRead] = Field(default_factory=list); assignments: list[Any] = Field(default_factory=list)
    model_config = {"from_attributes": True}


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=2, max_length=255); description: str | None = None; status: str | None = None; location: str | None = None; start_date: str | None = None; end_date: str | None = None; is_active: bool | None = None


class ProjectListResponse(BaseModel): items: list[ProjectRead]; total: int; page: int; page_size: int; has_more: bool


class DictionaryCreate(BaseModel):
    kind: str = Field(min_length=1, max_length=80); key: str = Field(min_length=1, max_length=120); value: str = Field(min_length=1, max_length=255); project_id: int | None = None; sort_order: int = 0; extra_data: dict[str, Any] | None = None


class DictionaryRead(BaseModel):
    id: int; org_id: int; project_id: int | None; kind: str; key: str; value: str; sort_order: int; is_active: bool; extra_data: dict[str, Any] | None; created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


class DictionaryUpdate(BaseModel):
    value: str | None = Field(default=None, min_length=1, max_length=255); sort_order: int | None = None; is_active: bool | None = None; extra_data: dict[str, Any] | None = None
