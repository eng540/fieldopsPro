from __future__ import annotations
from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.core.database import Base

class FieldDiaryEntry(Base):
    __tablename__ = "field_diary_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False)
    diary_date: Mapped[object] = mapped_column(Date, nullable=False)
    weather: Mapped[str | None] = mapped_column(String(120), nullable=True)
    workforce: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    equipment: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    visits_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    visits_accepted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    observations: Mapped[str | None] = mapped_column(Text, nullable=True)
    gps_tag: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    attachments: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    __table_args__ = (Index("ix_field_diary_org_date", "org_id", "diary_date"), Index("ix_field_diary_project_date", "project_id", "diary_date"))
