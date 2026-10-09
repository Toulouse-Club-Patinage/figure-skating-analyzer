"""Tests for skater role access control guards."""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


@pytest_asyncio.fixture
async def skater_setup(db_session: AsyncSession):
    """Create a skater user linked to one skater, plus an unlinked skater."""
    from app.models.user import User
    from app.models.skater import Skater
    from app.models.user_skater import UserSkater
    from app.auth.passwords import hash_password
    from app.auth.tokens import create_access_token

    skater1 = Skater(first_name="Alice", last_name="Dupont", club="TestClub")
    skater2 = Skater(first_name="Bob", last_name="Martin", club="TestClub")
    db_session.add_all([skater1, skater2])
    await db_session.flush()

    password = "skaterpass1"
    user = User(
        email="skater@test.com",
        password_hash=hash_password(password),
        display_name="Skater Parent",
        role="skater",
    )
    db_session.add(user)
    await db_session.flush()

    link = UserSkater(user_id=user.id, skater_id=skater1.id)
    db_session.add(link)
    await db_session.commit()
    await db_session.refresh(skater1)
    await db_session.refresh(skater2)
    await db_session.refresh(user)

    token = create_access_token(user_id=user.id, role=user.role)

    return {
        "user": user,
        "token": token,
        "linked_skater": skater1,
        "unlinked_skater": skater2,
    }


@pytest.mark.asyncio
async def test_skater_can_access_linked_skater(client: AsyncClient, skater_setup):
    """Skater CAN access their linked skater."""
    token = skater_setup["token"]
    skater_id = skater_setup["linked_skater"].id
    resp = await client.get(
        f"/api/skaters/{skater_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["first_name"] == "Alice"


@pytest.mark.asyncio
async def test_skater_cannot_access_unlinked_skater(client: AsyncClient, skater_setup):
    """Skater CANNOT access an unlinked skater."""
    token = skater_setup["token"]
    skater_id = skater_setup["unlinked_skater"].id
    resp = await client.get(
        f"/api/skaters/{skater_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_skater_cannot_access_dashboard(client: AsyncClient, skater_setup):
    """Skater CANNOT access the dashboard."""
    token = skater_setup["token"]
    resp = await client.get(
        "/api/dashboard/",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_skater_cannot_list_all_skaters(client: AsyncClient, skater_setup):
    """Skater CANNOT list all skaters."""
    token = skater_setup["token"]
    resp = await client.get(
        "/api/skaters/",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_skater_without_results_lists_no_competition(client: AsyncClient, skater_setup):
    """Skater sees only competitions where a linked skater has results — none here."""
    token = skater_setup["token"]
    resp = await client.get(
        "/api/competitions/",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_admin_can_list_all_skaters(client: AsyncClient, admin_token: str, skater_setup):
    """Admin CAN still list all skaters."""
    resp = await client.get(
        "/api/skaters/",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_reader_can_list_all_skaters(client: AsyncClient, reader_token: str, skater_setup):
    """Reader CAN still list all skaters."""
    resp = await client.get(
        "/api/skaters/",
        headers={"Authorization": f"Bearer {reader_token}"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_me_skaters_returns_linked_skaters(client: AsyncClient, skater_token: str, skater_user_with_skater):
    """GET /api/me/skaters returns linked skaters for skater role."""
    resp = await client.get(
        "/api/me/skaters",
        headers={"Authorization": f"Bearer {skater_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["first_name"] == "Alice"
    assert data[0]["last_name"] == "Dupont"


@pytest.mark.asyncio
async def test_me_skaters_returns_empty_for_admin(client: AsyncClient, admin_token: str):
    """GET /api/me/skaters returns empty list for admin role."""
    resp = await client.get(
        "/api/me/skaters",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []
