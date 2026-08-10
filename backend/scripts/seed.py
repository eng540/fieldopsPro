"""FieldOps V4.0 — Seed Script

Populates the database with demo data for development and testing.
Run: python -m scripts.seed

This script creates:
1. Demo organization (NRC)
2. Default roles (SUPER_ADMIN, ORG_ADMIN, PROJECT_MANAGER, FIELD_ENGINEER)
3. Demo users with hashed passwords
4. Demo project with units and BoQ items
"""
import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory, Base, engine
from app.core.security import get_password_hash
from app.modules.iam.models import (
    AuditAction, AuditLog, Organization, ProjectUser, Role, Session, User, UserRole
)
from app.modules.projects.models import Project, ProjectUnit, BoqItem
from app.modules.execution.models import WorkOrder, WorkOrderStatus


# ─────────────────────────────────────────
# SEED DATA
# ─────────────────────────────────────────

DEMO_ORG = {
    "name": "اللجنة النرويجية للاجئين (NRC)",
    "code": "NRC",
}

DEMO_ROLES = [
    {"name": "SUPER_ADMIN", "description": "مدير النظام الأعلى — صلاحيات كاملة"},
    {"name": "ORG_ADMIN", "description": "مدير المنظمة — إدارة المستخدمين والمشاريع"},
    {"name": "PROJECT_MANAGER", "description": "مدير مشروع — إدارة أعمال البند والتنفيذ"},
    {"name": "FIELD_ENGINEER", "description": "مهندس ميداني — إدخال البيانات والملاحظات"},
]

DEMO_USERS = [
    {"email": "admin@fieldops.sa", "name": "أحمد المدير", "password": "demo1234", "role": "SUPER_ADMIN"},
    {"email": "orgadmin@fieldops.sa", "name": "محمد مدير المنظمة", "password": "demo1234", "role": "ORG_ADMIN"},
    {"email": "pm@fieldops.sa", "name": "سارة مدير المشروع", "password": "demo1234", "role": "PROJECT_MANAGER"},
    {"email": "field@fieldops.sa", "name": "خالد المهندس", "password": "demo1234", "role": "FIELD_ENGINEER"},
    {"email": "viewer@fieldops.sa", "name": "نورة المشاهد", "password": "demo1234", "role": "FIELD_ENGINEER"},
]

DEMO_PROJECT = {
    "name": "مشروع إعادة تأهيل المدرسة",
    "code": "SCH-2024-001",
    "status": "ACTIVE",
}

DEMO_UNITS = [
    {"name": "الطابق الأرضي", "code": "GF", "type": "FLOOR"},
    {"name": "الطابق الأول", "code": "F1", "type": "FLOOR"},
    {"name": "الطابق الثاني", "code": "F2", "type": "FLOOR"},
]

DEMO_BOQ_ITEMS = [
    {"name": "أعمال الهدم", "code": "DEM-001", "unit": "م3", "quantity": 150.0, "unit_rate": 45.0, "category": "هدم"},
    {"name": "أعمال البناء", "code": "BLD-001", "unit": "م3", "quantity": 200.0, "unit_rate": 120.0, "category": "بناء"},
    {"name": "أعمال الدهان", "code": "PNT-001", "unit": "م2", "quantity": 500.0, "unit_rate": 25.0, "category": "تشطيب"},
    {"name": "أعمال السباكة", "code": "PLB-001", "unit": "م", "quantity": 80.0, "unit_rate": 65.0, "category": "سباكة"},
    {"name": "أعمال الكهرباء", "code": "ELC-001", "unit": "نقطة", "quantity": 120.0, "unit_rate": 85.0, "category": "كهرباء"},
]


async def seed():
    """Run all seed operations."""
    async with async_session_factory() as db:
        # Check if data already exists
        existing = await db.execute(select(Organization).limit(1))
        if existing.scalar_one_or_none():
            print("⏭️  Database already seeded. Skipping.")
            return

        print("🌱 Seeding FieldOps V4.0 database...")

        # 1. Create Organization
        org = Organization(name=DEMO_ORG["name"], code=DEMO_ORG["code"])
        db.add(org)
        await db.flush()
        print(f"  ✅ Created organization: {org.name} (id={org.id})")

        # 2. Create Roles
        role_map = {}
        for role_data in DEMO_ROLES:
            role = Role(
                org_id=org.id,
                name=role_data["name"],
                description=role_data["description"],
            )
            db.add(role)
            await db.flush()
            role_map[role_data["name"]] = role
            print(f"  ✅ Created role: {role.name}")

        # 3. Create Users
        user_map = {}
        for user_data in DEMO_USERS:
            user = User(
                org_id=org.id,
                email=user_data["email"],
                name=user_data["name"],
                hashed_password=get_password_hash(user_data["password"]),
                is_active=True,
                token_version=1,
            )
            db.add(user)
            await db.flush()
            user_map[user_data["email"]] = user
            print(f"  ✅ Created user: {user.email} ({user.name})")

        # 4. Create Project
        project = Project(
            org_id=org.id,
            name=DEMO_PROJECT["name"],
            code=DEMO_PROJECT["code"],
            status=DEMO_PROJECT["status"],
        )
        db.add(project)
        await db.flush()
        print(f"  ✅ Created project: {project.name} (id={project.id})")

        # 5. Create Units
        for i, unit_data in enumerate(DEMO_UNITS):
            unit = ProjectUnit(
                org_id=org.id,
                project_id=project.id,
                name=unit_data["name"],
                code=unit_data["code"],
                type=unit_data["type"],
                floor_number=i,
            )
            db.add(unit)
            await db.flush()

            # Add BoQ items for each unit
            for j, boq_data in enumerate(DEMO_BOQ_ITEMS):
                boq = BoqItem(
                    org_id=org.id,
                    project_id=project.id,
                    unit_id=unit.id,
                    name=boq_data["name"],
                    code=f"{unit_data['code']}-{boq_data['code']}",
                    unit=boq_data["unit"],
                    quantity=boq_data["quantity"],
                    unit_rate=boq_data["unit_rate"],
                    category=boq_data["category"],
                    completion_pct=0.0,
                )
                db.add(boq)
            await db.flush()

            # Create work orders for first unit
            if i == 0:
                for j, boq_data in enumerate(DEMO_BOQ_ITEMS[:3]):
                    wo = WorkOrder(
                        org_id=org.id,
                        project_id=project.id,
                        unit_id=unit.id,
                        title=boq_data["name"],
                        status=WorkOrderStatus.NOT_STARTED.value,
                        completion_pct=0.0,
                        assigned_to=user_map.get("field@fieldops.sa", list(user_map.values())[0]).id,
                    )
                    db.add(wo)

            print(f"  ✅ Created unit: {unit_data['name']} with BoQ items")

        # 6. Assign users to project with roles
        for user_data in DEMO_USERS:
            user = user_map[user_data["email"]]
            role = role_map[user_data["role"]]
            assignment = ProjectUser(
                org_id=org.id,
                user_id=user.id,
                project_id=project.id,
                role_id=role.id,
            )
            db.add(assignment)
        await db.flush()
        print(f"  ✅ Assigned {len(DEMO_USERS)} users to project")

        # 7. Create audit log entry
        audit = AuditLog(
            org_id=org.id,
            action=AuditAction.USER_CREATED.value,
            resource_type="system",
            resource_id="seed",
            details={"message": "Database seeded with demo data"},
        )
        db.add(audit)
        await db.flush()

        await db.commit()
        print("\n🎉 Seed complete! Demo accounts ready:")
        print("  ┌─────────────────────────────────────────────────────┐")
        for user_data in DEMO_USERS:
            print(f"  │ {user_data['email']:30s} password: {user_data['password']:10s} │")
        print("  └─────────────────────────────────────────────────────┘")


async def create_tables():
    """Create all tables if they don't exist."""
    async with engine.begin() as conn:
        # Import all models so they register with Base metadata
        from app.modules.iam import models as iam_models          # noqa: F401
        from app.modules.execution import models as exec_models   # noqa: F401
        from app.modules.projects import models as proj_models    # noqa: F401
        from app.modules.quality import models as qual_models     # noqa: F401
        from app.modules.governance import models as gov_models   # noqa: F401
        from app.modules.reporting import models as rep_models    # noqa: F401

        await conn.run_sync(Base.metadata.create_all)
        print("✅ Tables created successfully")


async def main():
    """Main entry point."""
    print("🏗️  FieldOps V4.0 — Database Initialization\n")
    await create_tables()
    await seed()
    print("\n✅ Database ready!")


if __name__ == "__main__":
    asyncio.run(main())
