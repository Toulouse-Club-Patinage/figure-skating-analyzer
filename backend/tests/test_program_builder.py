import pytest


# ── GET /api/program-builder/sov ─────────────────────────────────────────


async def test_get_sov_as_coach(client, coach_token):
    resp = await client.get(
        "/api/program-builder/sov",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["season"] == "2026-2027"
    assert "elements" in data
    assert "3Lz" in data["elements"]
    el = data["elements"]["3Lz"]
    assert el["type"] == "jump"
    assert el["category"] == "single"
    assert isinstance(el["base_value"], (int, float))
    assert len(el["goe"]) == 10


async def test_get_sov_as_admin(client, admin_token):
    resp = await client.get(
        "/api/program-builder/sov",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert "elements" in resp.json()


async def test_get_sov_rejected_for_reader(client, reader_token):
    resp = await client.get(
        "/api/program-builder/sov",
        headers={"Authorization": f"Bearer {reader_token}"},
    )
    assert resp.status_code == 403


async def test_get_sov_rejected_for_skater(client, skater_token):
    resp = await client.get(
        "/api/program-builder/sov",
        headers={"Authorization": f"Bearer {skater_token}"},
    )
    assert resp.status_code == 403


async def test_get_sov_rejected_unauthenticated(client):
    resp = await client.get("/api/program-builder/sov")
    assert resp.status_code == 401


# ── GET /api/program-builder/rules ───────────────────────────────────────


async def test_get_rules_as_coach(client, coach_token):
    resp = await client.get(
        "/api/program-builder/rules",
        headers={"Authorization": f"Bearer {coach_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["season"] == "2026-2027"
    assert "categories" in data
    assert len(data["categories"]) >= 10


async def test_get_rules_as_admin(client, admin_token):
    resp = await client.get(
        "/api/program-builder/rules",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert "categories" in resp.json()


async def test_get_rules_rejected_for_reader(client, reader_token):
    resp = await client.get(
        "/api/program-builder/rules",
        headers={"Authorization": f"Bearer {reader_token}"},
    )
    assert resp.status_code == 403


async def test_get_rules_rejected_for_skater(client, skater_token):
    resp = await client.get(
        "/api/program-builder/rules",
        headers={"Authorization": f"Bearer {skater_token}"},
    )
    assert resp.status_code == 403
