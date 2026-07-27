"""Governance Engine Models — FieldOps V4.0 (Sprint-3)

Models:
- GovernancePolicy:     Versioned rule matrix per org
- GovernancePolicyRule: Individual rule within a policy
- GovernanceDecision:   Append-only explainable decision per unit
- GovernanceOverride:   PM/OrgAdmin override with justification (WORM)

Constitutional:
- org_id mandatory everywhere
- Decisions are APPEND-ONLY — never updated, only overridden
- explainability JSON required on every decision
- Override needs min 20-char justification + PM/OrgAdmin role
"""
from __future__ import annotations
import enum

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Index,
    Integer, JSON, String, Text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class GovernanceDecisionType(str, enum.Enum):
    APPROVE           = "APPROVE"
    APPROVE_WITH_NOTE = "APPROVE_WITH_NOTE"
    HOLD              = "HOLD"
    STOP              = "STOP"
    REWORK            = "REWORK"


class GovernancePolicy(Base):
    __tablename__ = "governance_policies"

    id: Mapped[int]         = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int]     = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    name: Mapped[str]       = mapped_column(String(255), nullable=False)
    version: Mapped[int]    = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_governance_policies_org_id", "org_id"),)


class GovernancePolicyRule(Base):
    __tablename__ = "governance_policy_rules"

    id: Mapped[int]          = mapped_column(Integer, primary_key=True, autoincrement=True)
    policy_id: Mapped[int]   = mapped_column(Integer, ForeignKey("governance_policies.id"), nullable=False)
    org_id: Mapped[int]      = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    rule_code: Mapped[str]   = mapped_column(String(50), nullable=False)
    priority: Mapped[int]    = mapped_column(Integer, nullable=False, default=100)
    decision: Mapped[str]    = mapped_column(String(30), nullable=False)
    payment_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    condition_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    flag_message: Mapped[str]  = mapped_column(String(500), nullable=False)
    is_active: Mapped[bool]  = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_governance_rules_policy_id", "policy_id"),
        Index("ix_governance_rules_org_id", "org_id"),
    )


class GovernanceDecision(Base):
    """Append-only explainable governance decision."""
    __tablename__ = "governance_decisions"

    id: Mapped[int]          = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int]      = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    unit_id: Mapped[int]     = mapped_column(Integer, ForeignKey("project_units.id"), nullable=False)
    boq_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("boq_items.id"), nullable=True)
    remark_id: Mapped[str | None]   = mapped_column(String(36), nullable=True)
    decision: Mapped[str]    = mapped_column(String(30), nullable=False)
    payment_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    flag: Mapped[str | None] = mapped_column(String(500), nullable=True)
    matched_rule: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reason: Mapped[str]      = mapped_column(Text, nullable=False)
    policy_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    explainability: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    triggered_by: Mapped[int]  = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    is_overridden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[object]  = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_governance_decisions_org_id", "org_id"),
        Index("ix_governance_decisions_unit_id", "unit_id"),
        Index("ix_governance_decisions_decision", "decision"),
    )


class GovernanceOverride(Base):
    """WORM override record — PM/OrgAdmin justification required."""
    __tablename__ = "governance_overrides"

    id: Mapped[int]            = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int]        = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    decision_id: Mapped[int]   = mapped_column(Integer, ForeignKey("governance_decisions.id"), nullable=False)
    overridden_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    justification: Mapped[str] = mapped_column(Text, nullable=False)
    new_payment_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    new_decision: Mapped[str | None]      = mapped_column(String(30), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_governance_overrides_org_id", "org_id"),
        Index("ix_governance_overrides_decision_id", "decision_id"),
    )
