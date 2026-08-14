from datetime import date, datetime
from typing import Any
from pydantic import BaseModel, Field, field_validator

class FieldDiaryCreate(BaseModel):
    project_id: int = Field(gt=0)
    diary_date: date
    weather: str | None = Field(default=None, max_length=120)
    workforce: dict[str, Any] = Field(default_factory=dict)
    equipment: list[str] = Field(default_factory=list, max_length=100)
    visits_total: int = Field(default=0, ge=0)
    visits_accepted: int = Field(default=0, ge=0)
    observations: str | None = Field(default=None, max_length=10000)
    gps_tag: dict[str, Any] | None = None
    attachments: list[str] = Field(default_factory=list, max_length=100)
    @field_validator("visits_accepted")
    @classmethod
    def accepted_cannot_exceed_total(cls, value: int, info):
        total = info.data.get("visits_total")
        if total is not None and value > total: raise ValueError("visits_accepted cannot exceed visits_total")
        return value

class FieldDiaryRead(FieldDiaryCreate):
    id: str; org_id: int; created_by: int; created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}
class FieldDiaryListResponse(BaseModel):
    items: list[FieldDiaryRead]; total: int
