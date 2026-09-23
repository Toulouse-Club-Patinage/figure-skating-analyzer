from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Boolean, Integer, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        SAEnum("admin", "reader", "skater", "coach", name="user_role"), nullable=False, default="reader"
    )
    google_oauth_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    # Date d'émission du mot de passe temporaire posé par un admin ; à défaut,
    # le délai de validité se calcule depuis la demande de compte.
    temp_password_set_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    email_notifications: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    tutorial_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
