"""Governance Engine Router — FieldOps V4.0 (Sprint-3)

Endpoints (6):
1. POST  /governance/policies                      — Create policy
2. POST  /governance/policies/{id}/rules           — Add rule to policy
3. GET   /governance/policies/{id}/rules           — List rules for policy
4. POST  /governance/evaluate                      — Evaluate unit against active policy
5. GET   /governance/decisions                     — List decisions (filtered)
6. POST  /governance/decisions/{id}/override       — Override decision (PM/OrgAdmin only)

Constitutional:
- Decisions are APPEND-ONLY (never mutated, only overridden)
- Override requires min 20-char justification
- explainability JSON on every decision
- org_id from JWT always
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.iam.dependencies import get_current_user
from app.modules.governance.models import (
    GovernanceDecision, GovernanceDecisionType,
    GovernanceOverride, GovernancePolicy, GovernancePolicyRule,
)
from app.modules.governance.schemas import (
    EvaluateRequest, GovernanceDecisionListResponse, GovernanceDecisionRead,
    OverrideCreate, OverrideRead,
    PolicyCreate, PolicyRead, PolicyRuleCreate, PolicyRuleRead,
)

router = APIRouter()

_OVERRIDE_ROLES = {"PROJECT_MANAGER", "ORG_ADMIN", "SUPER_ADMIN"}


# ═══════════════════════════════════════
# POLICIES
# ═══════════════════════════════════════

@router.post("/policies", response_model=PolicyRead, status_code=201)
async def create_policy(
    data: PolicyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> GovernancePolicy:
    policy = GovernancePolicy(
        org_id=current_user["org_id"],
        created_by=current_user["id"],
        **data.model_dump(),
    )
    db.add(policy)
    await db.flush()
    await db.refresh(policy)
    return policy


@router.post("/policies/{policy_id}/rules", response_model=PolicyRuleRead, status_code=201)
async def add_rule(
    policy_id: int,
    data: PolicyRuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> GovernancePolicyRule:
    org_id = current_user["org_id"]
    policy = (await db.execute(
        select(GovernancePolicy).where(
            GovernancePolicy.id == policy_id,
            GovernancePolicy.org_id == org_id,
        )
    )).scalar_one_or_none()
    if not policy:
        raise HTTPException(status_code=404, detail=f"Policy {policy_id} not found.")
    rule = GovernancePolicyRule(policy_id=policy_id, org_id=org_id, **data.model_dump())
    db.add(rule)
    await db.flush()
    await db.refresh(rule)
    return rule


@router.get("/policies/{policy_id}/rules", response_model=list[PolicyRuleRead])
async def list_rules(
    policy_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> list[GovernancePolicyRule]:
    return (await db.execute(
        select(GovernancePolicyRule).where(
            GovernancePolicyRule.policy_id == policy_id,
            GovernancePolicyRule.org_id == current_user["org_id"],
            GovernancePolicyRule.is_active.is_(True),
        ).order_by(GovernancePolicyRule.priority)
    )).scalars().all()


# ═══════════════════════════════════════
# EVALUATE
# ═══════════════════════════════════════

@router.post("/evaluate", response_model=GovernanceDecisionRead, status_code=201)
async def evaluate_unit(
    data: EvaluateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> GovernanceDecision:
    """Run active policy rules against a unit and produce an explainable decision.

    Rule engine (priority order):
    1. Load active policy + rules for org
    2. For each rule (ordered by priority ASC): evaluate condition_json against unit state
    3. First matching rule wins → produces decision
    4. Fallback: APPROVE at 100% if no rule matches
    """
    org_id = current_user["org_id"]

    # Load active policy
    policy = (await db.execute(
        select(GovernancePolicy).where(
            GovernancePolicy.org_id == org_id,
            GovernancePolicy.is_active.is_(True),
        ).order_by(GovernancePolicy.version.desc())
    )).scalar_one_or_none()

    if not policy:
        # No policy configured — default APPROVE
        decision = GovernanceDecision(
            org_id=org_id,
            unit_id=data.unit_id,
            boq_item_id=data.boq_item_id,
            decision=GovernanceDecisionType.APPROVE.value,
            payment_pct=100.0,
            reason="No active policy configured — default approval.",
            policy_version=0,
            explainability={"rule": "DEFAULT_APPROVE", "conditions_met": [], "override_applied": False},
            triggered_by=current_user["id"],
        )
        db.add(decision)
        await db.flush()
        await db.refresh(decision)
        return decision

    # Load rules ordered by priority
    rules = (await db.execute(
        select(GovernancePolicyRule).where(
            GovernancePolicyRule.policy_id == policy.id,
            GovernancePolicyRule.is_active.is_(True),
        ).order_by(GovernancePolicyRule.priority.asc())
    )).scalars().all()

    # Load unit state for evaluation
    from app.modules.quality.models import Remark, RemarkStatus
    open_remarks = (await db.execute(
        select(Remark).where(
            Remark.unit_id == data.unit_id,
            Remark.org_id == org_id,
            Remark.status == RemarkStatus.OPEN.value,
        )
    )).scalars().all()

    unit_state = {
        "open_remarks": len(open_remarks),
        "critical_open": sum(1 for r in open_remarks if r.severity == "CRITICAL"),
        "major_open": sum(1 for r in open_remarks if r.severity == "MAJOR"),
        "minor_open": sum(1 for r in open_remarks if r.severity == "MINOR"),
    }

    matched_rule = None
    conditions_met = []

    for rule in rules:
        cond = rule.condition_json
        match = True
        for key, threshold in cond.items():
            actual = unit_state.get(key, 0)
            if isinstance(threshold, dict):
                op = list(threshold.keys())[0]   # "gte", "gt", "lte", "lt", "eq"
                val = threshold[op]
                if op == "gte" and not (actual >= val): match = False
                elif op == "gt"  and not (actual > val):  match = False
                elif op == "lte" and not (actual <= val): match = False
                elif op == "lt"  and not (actual < val):  match = False
                elif op == "eq"  and not (actual == val): match = False
            else:
                if actual != threshold:
                    match = False
            if match:
                conditions_met.append(f"{key}: {actual} matches {threshold}")

        if match:
            matched_rule = rule
            break

    if matched_rule:
        dec_value    = matched_rule.decision
        pay_pct      = matched_rule.payment_pct
        flag         = matched_rule.flag_message
        rule_code    = matched_rule.rule_code
        reason       = f"Rule {rule_code} matched. {flag}"
    else:
        dec_value = GovernanceDecisionType.APPROVE.value
        pay_pct   = 100.0
        flag      = None
        rule_code = "DEFAULT_APPROVE"
        reason    = "No rule conditions matched — default approval at 100%."

    decision = GovernanceDecision(
        org_id=org_id,
        unit_id=data.unit_id,
        boq_item_id=data.boq_item_id,
        decision=dec_value,
        payment_pct=pay_pct,
        flag=flag,
        matched_rule=rule_code,
        reason=reason,
        policy_version=policy.version,
        explainability={
            "policy_id": policy.id,
            "policy_version": policy.version,
            "unit_state": unit_state,
            "matched_rule": rule_code,
            "conditions_met": conditions_met,
            "override_applied": False,
        },
        triggered_by=current_user["id"],
    )
    db.add(decision)
    await db.flush()
    await db.refresh(decision)
    return decision


# ═══════════════════════════════════════
# DECISIONS
# ═══════════════════════════════════════

@router.get("/decisions", response_model=GovernanceDecisionListResponse)
async def list_decisions(
    unit_id: int | None = Query(None),
    decision_filter: str | None = Query(None, alias="decision"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    org_id = current_user["org_id"]
    q = select(GovernanceDecision).where(GovernanceDecision.org_id == org_id)
    if unit_id:         q = q.where(GovernanceDecision.unit_id == unit_id)
    if decision_filter: q = q.where(GovernanceDecision.decision == decision_filter)
    items = (await db.execute(q.order_by(GovernanceDecision.created_at.desc()))).scalars().all()
    return {
        "items": items,
        "total": len(items),
        "hold_count":    sum(1 for d in items if d.decision == "HOLD"),
        "stop_count":    sum(1 for d in items if d.decision == "STOP"),
        "approve_count": sum(1 for d in items if d.decision in ("APPROVE", "APPROVE_WITH_NOTE")),
    }


@router.post("/decisions/{decision_id}/override", response_model=OverrideRead, status_code=201)
async def override_decision(
    decision_id: int,
    data: OverrideCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> GovernanceOverride:
    """Override a governance decision. Requires PM/OrgAdmin role. WORM record."""
    org_id = current_user["org_id"]
    user_role = current_user.get("role", "")

    if user_role not in _OVERRIDE_ROLES:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{user_role}' cannot override governance decisions. "
                   f"Required: {sorted(_OVERRIDE_ROLES)}",
        )

    decision = (await db.execute(
        select(GovernanceDecision).where(
            GovernanceDecision.id == decision_id,
            GovernanceDecision.org_id == org_id,
        )
    )).scalar_one_or_none()
    if not decision:
        raise HTTPException(status_code=404, detail=f"Decision {decision_id} not found.")

    # Mark original as overridden
    decision.is_overridden = True
    await db.flush()

    override = GovernanceOverride(
        org_id=org_id,
        decision_id=decision_id,
        overridden_by=current_user["id"],
        justification=data.justification,
        new_payment_pct=data.new_payment_pct,
        new_decision=data.new_decision,
    )
    db.add(override)
    await db.flush()
    await db.refresh(override)
    return override
