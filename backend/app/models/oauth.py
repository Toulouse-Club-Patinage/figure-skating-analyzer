from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class OAuthClient(Base):
    """Client OAuth enregistré dynamiquement (RFC 7591) — en pratique, Claude."""

    __tablename__ = "oauth_clients"

    client_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # OAuthClientInformationFull.model_dump(mode="json", exclude_none=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class OAuthAuthRequest(Base):
    """Demande d'autorisation en attente de consentement, puis code d'autorisation.

    Une ligne naît dans /authorize ; le consentement y ajoute user_id + code_hash ;
    l'échange du code la supprime (usage unique).
    """

    __tablename__ = "oauth_auth_requests"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), ForeignKey("oauth_clients.client_id"), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    redirect_uri_provided_explicitly: Mapped[bool] = mapped_column(Boolean, nullable=False)
    code_challenge: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[str | None] = mapped_column(Text, nullable=True)
    scopes: Mapped[list] = mapped_column(JSON, nullable=False)
    resource: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    code_hash: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    code_expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)


class OAuthToken(Base):
    """Jeton d'accès ou de rafraîchissement, stocké haché (SHA-256).

    family_id regroupe tous les jetons issus d'un même consentement : c'est
    l'unité affichée dans « Applications connectées » et révoquée d'un bloc.
    """

    __tablename__ = "oauth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "access" | "refresh"
    family_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    client_id: Mapped[str] = mapped_column(String(64), ForeignKey("oauth_clients.client_id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    user_token_version: Mapped[int] = mapped_column(Integer, nullable=False)
    scopes: Mapped[list] = mapped_column(JSON, nullable=False)
    resource: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    granted_at: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    last_used_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    consumed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revoked_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
