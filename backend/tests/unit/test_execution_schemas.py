"""Schema Validation Tests — FieldOps V4.0 Sprint-2 CP-2

Tests Pydantic schema validation rules:
- WorkOrderCreate: required fields, min/max lengths, defaults
- WorkOrderUpdate: optional fields, rework validation (ADR-003)
- WorkOrderAssignmentCreate: required fields
- Pagination: bounds validation
"""
import pytest
from pydantic import ValidationError

from app.modules.execution.schemas import (
    AssignmentStatus,
    PaginationParams,
    SyncOperationType,
    SyncStatus,
    WorkOrderAssignmentCreate,
    WorkOrderCreate,
    WorkOrderFilterParams,
    WorkOrderListResponse,
    WorkOrderPriority,
    WorkOrderRead,
    WorkOrderStatus,
    WorkOrderType,
    WorkOrderUpdate,
)


class TestWorkOrderCreateSchema:
    """Validate WorkOrderCreate schema rules."""

    def test_valid_creation_with_required_fields_only(self):
        """Minimal valid creation with only title and project_id."""
        wo = WorkOrderCreate(
            title="Fix crack in foundation slab",
            project_id=12,
        )
        assert wo.title == "Fix crack in foundation slab"
        assert wo.project_id == 12
        assert wo.wo_type == WorkOrderType.CORRECTIVE  # default
        assert wo.priority == WorkOrderPriority.MEDIUM  # default
        assert wo.description is None
        assert wo.unit_id is None

    def test_valid_creation_with_all_fields(self):
        """Full creation with all optional fields."""
        wo = WorkOrderCreate(
            title="Replace corroded plumbing pipes",
            description="Section 3B pipes show advanced corrosion per inspection report IR-2024-042",
            project_id=15,
            unit_id=1042,
            wo_type=WorkOrderType.CORRECTIVE,
            priority=WorkOrderPriority.HIGH,
            location_data={"lat": 14.8021, "lng": 42.9513, "accuracy": 5.0},
            extra_data={"estimated_hours": 8, "materials_required": True},
        )
        assert wo.wo_type == WorkOrderType.CORRECTIVE
        assert wo.priority == WorkOrderPriority.HIGH
        assert wo.location_data["lat"] == 14.8021
        assert wo.extra_data["estimated_hours"] == 8

    def test_title_min_length_validation(self):
        """Title must be at least 3 characters."""
        with pytest.raises(ValidationError) as exc_info:
            WorkOrderCreate(title="AB", project_id=1)
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("title",) for e in errors)

    def test_title_max_length_validation(self):
        """Title must not exceed 255 characters."""
        with pytest.raises(ValidationError) as exc_info:
            WorkOrderCreate(title="X" * 256, project_id=1)
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("title",) for e in errors)

    def test_title_exactly_255_is_valid(self):
        """Title at exactly 255 chars should be valid."""
        wo = WorkOrderCreate(title="A" * 255, project_id=1)
        assert len(wo.title) == 255

    def test_project_id_must_be_positive(self):
        """project_id must be > 0."""
        with pytest.raises(ValidationError) as exc_info:
            WorkOrderCreate(title="Valid title", project_id=0)
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("project_id",) for e in errors)

    def test_project_id_negative_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            WorkOrderCreate(title="Valid title", project_id=-1)
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("project_id",) for e in errors)

    def test_unit_id_must_be_positive_when_provided(self):
        with pytest.raises(ValidationError):
            WorkOrderCreate(title="Valid title", project_id=1, unit_id=0)

    def test_all_work_order_types_accepted(self):
        """All enum values must be accepted."""
        for wo_type in WorkOrderType:
            wo = WorkOrderCreate(title="Test", project_id=1, wo_type=wo_type)
            assert wo.wo_type == wo_type

    def test_all_priorities_accepted(self):
        for priority in WorkOrderPriority:
            wo = WorkOrderCreate(title="Test", project_id=1, priority=priority)
            assert wo.priority == priority

    def test_missing_title_raises_validation_error(self):
        with pytest.raises(ValidationError):
            WorkOrderCreate(project_id=1)

    def test_missing_project_id_raises_validation_error(self):
        with pytest.raises(ValidationError):
            WorkOrderCreate(title="Test WO")


class TestWorkOrderUpdateSchema:
    """Validate WorkOrderUpdate schema rules (PATCH semantics)."""

    def test_empty_update_is_valid(self):
        """PATCH with no fields is valid (no-op)."""
        update = WorkOrderUpdate()
        assert update.title is None
        assert update.completion_pct is None

    def test_title_update_only(self):
        """Can update just title."""
        update = WorkOrderUpdate(title="Updated title")
        assert update.title == "Updated title"

    def test_completion_pct_bounds(self):
        """completion_pct must be in [0, 100]."""
        update = WorkOrderUpdate(completion_pct=50.0)
        assert update.completion_pct == 50.0

    def test_completion_pct_zero_accepted(self):
        update = WorkOrderUpdate(completion_pct=0.0)
        assert update.completion_pct == 0.0

    def test_completion_pct_hundred_accepted(self):
        update = WorkOrderUpdate(completion_pct=100.0)
        assert update.completion_pct == 100.0

    def test_completion_pct_negative_rejected(self):
        with pytest.raises(ValidationError):
            WorkOrderUpdate(completion_pct=-1.0)

    def test_completion_pct_over_100_rejected(self):
        with pytest.raises(ValidationError):
            WorkOrderUpdate(completion_pct=101.0)

    def test_rework_flag_without_reason_rejected(self):
        """ADR-003 Rule 3: rework_flag=True requires rework_reason (min 20 chars)."""
        with pytest.raises(ValidationError) as exc_info:
            WorkOrderUpdate(
                completion_pct=30.0,
                rework_flag=True,
            )
        errors = exc_info.value.errors()
        assert any("rework_reason" in str(e["msg"]) for e in errors)

    def test_rework_flag_with_short_reason_rejected(self):
        """rework_reason must be at least 20 characters."""
        with pytest.raises(ValidationError) as exc_info:
            WorkOrderUpdate(
                completion_pct=30.0,
                rework_flag=True,
                rework_reason="Too short",
                rework_authorized_by=5,
            )
        errors = exc_info.value.errors()
        assert any("20 characters" in str(e["msg"]) for e in errors)

    def test_rework_flag_with_valid_reason_accepted(self):
        """Full rework with valid reason and authorizer should be accepted."""
        update = WorkOrderUpdate(
            completion_pct=30.0,
            rework_flag=True,
            rework_reason="Quality inspection revealed insufficient reinforcement in section 3B",
            rework_authorized_by=5,
        )
        assert update.rework_flag is True
        assert update.rework_authorized_by == 5

    def test_rework_with_authorized_by_missing_rejected(self):
        """ADR-003: rework_flag=True requires rework_authorized_by."""
        with pytest.raises(ValidationError) as exc_info:
            WorkOrderUpdate(
                completion_pct=30.0,
                rework_flag=True,
                rework_reason="Quality inspection revealed insufficient reinforcement in section 3B",
            )
        errors = exc_info.value.errors()
        assert any("rework_authorized_by" in str(e["msg"]) for e in errors)

    def test_no_rework_fields_when_flag_false(self):
        """When rework_flag=False, rework fields are not required."""
        update = WorkOrderUpdate(
            completion_pct=75.0,
            rework_flag=False,
        )
        assert update.rework_flag is False
        assert update.rework_reason is None


class TestWorkOrderAssignmentCreateSchema:
    """Validate WorkOrderAssignmentCreate schema."""

    def test_valid_assignment(self):
        assignment = WorkOrderAssignmentCreate(user_id=15)
        assert assignment.user_id == 15
        assert assignment.notes is None

    def test_assignment_with_notes(self):
        assignment = WorkOrderAssignmentCreate(
            user_id=15,
            notes="Focus on section 3B corrosion repair",
        )
        assert assignment.notes == "Focus on section 3B corrosion repair"

    def test_user_id_must_be_positive(self):
        with pytest.raises(ValidationError):
            WorkOrderAssignmentCreate(user_id=0)

    def test_missing_user_id_rejected(self):
        with pytest.raises(ValidationError):
            WorkOrderAssignmentCreate()


class TestPaginationAndFilterSchemas:
    """Validate pagination and filter schemas."""

    def test_default_pagination(self):
        params = PaginationParams()
        assert params.page == 1
        assert params.page_size == 50

    def test_custom_pagination(self):
        params = PaginationParams(page=3, page_size=100)
        assert params.page == 3
        assert params.page_size == 100

    def test_page_zero_rejected(self):
        with pytest.raises(ValidationError):
            PaginationParams(page=0)

    def test_page_size_over_200_rejected(self):
        with pytest.raises(ValidationError):
            PaginationParams(page_size=201)

    def test_filter_params_with_all_fields(self):
        filters = WorkOrderFilterParams(
            status=WorkOrderStatus.IN_PROGRESS,
            priority=WorkOrderPriority.HIGH,
            wo_type=WorkOrderType.CORRECTIVE,
            project_id=12,
            assigned_to=15,
            page=2,
            page_size=25,
        )
        assert filters.status == WorkOrderStatus.IN_PROGRESS
        assert filters.page == 2
        assert filters.page_size == 25


class TestEnumValues:
    """Verify all enum values match expected values."""

    def test_work_order_types(self):
        values = {e.value for e in WorkOrderType}
        assert "CORRECTIVE" in values
        assert "PREVENTIVE" in values
        assert "INSTALLATION" in values
        assert "INSPECTION" in values
        assert "MAINTENANCE" in values

    def test_work_order_priorities(self):
        values = {e.value for e in WorkOrderPriority}
        assert values == {"LOW", "MEDIUM", "HIGH", "CRITICAL"}

    def test_work_order_statuses(self):
        values = {e.value for e in WorkOrderStatus}
        assert "DRAFT" in values
        assert "PENDING_APPROVAL" in values
        assert "APPROVED" in values
        assert "IN_PROGRESS" in values
        assert "COMPLETED" in values
        assert "CANCELLED" in values

    def test_assignment_statuses(self):
        values = {e.value for e in AssignmentStatus}
        assert values == {"ACTIVE", "RELEASED", "REASSIGNED"}

    def test_sync_operation_types(self):
        values = {e.value for e in SyncOperationType}
        assert values == {"CREATE", "UPDATE", "DELETE", "STATUS_CHANGE"}

    def test_sync_statuses(self):
        values = {e.value for e in SyncStatus}
        assert values == {"PENDING", "PROCESSED", "FAILED", "CONFLICT"}
