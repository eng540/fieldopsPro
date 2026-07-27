"""Governance Engine Schemas — FieldOps V4.0"""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field


class PolicyCreate(BaseModel):
    name: str = Field(min_length=3, max_length=255)
    description: str | None = None


class PolicyRead(BaseModel):
    id: int
    org_id: int
    name: str
    version: int
    is_active: bool
    description: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class PolicyRuleCreate(BaseModel):
    rule_code: str = Field(min_length=3, max_length=50)
    priority: int = Field(default=100, ge=1, le=999)
    decision: str
    payment_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    condition_json: dict
    flag_message: str = Field(min_length=5, max_length=500)


class PolicyRuleRead(BaseModel):
    id: int
    policy_id: int
    org_id: int
    rule_code: str
    priority: int
    decision: str
    payment_pct: float
    condition_json: dict
    flag_message: str
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class EvaluateRequest(BaseModel):
    unit_id: int
    boq_item_id: int | None = None


class GovernanceDecisionRead(BaseModel):
    id: int
    org_id: int
    unit_id: int
    boq_item_id: int | None
    remark_id: str | None
    decision: str
    payment_pct: float
    flag: str | None
    matched_rule: str | None
    reason: str
    policy_version: int
    explainability: dict
    triggered_by: int
    is_overridden: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class GovernanceDecisionListResponse(BaseModel):
    items: list[GovernanceDecisionRead]
    total: int
    hold_count: int
    stop_count: int
    approve_count: int


class OverrideCreate(BaseModel):
    justification: str = Field(min_length=20, max_length=2000)
    new_payment_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    new_decision: str | None = None


class OverrideRead(BaseModel):
    id: int
    org_id: int
    decision_id: int
    overridden_by: int
    justification: str
    new_payment_pct: float | None
    new_decision: str | None
    created_at: datetime
    model_config = {"from_attributes": True}
