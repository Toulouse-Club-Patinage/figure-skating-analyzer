import pytest
import pytest_asyncio

from app.models.competition import Competition


@pytest_asyncio.fixture
async def comp(db_session):
    c = Competition(name="Comp", url="http://example.com/guards")
    db_session.add(c)
    await db_session.commit()
    await db_session.refresh(c)
    return c


def _calls(comp_id):
    return [
        ("post", "/api/competitions/", {"url": "http://example.com/new"}),
        ("delete", f"/api/competitions/{comp_id}", None),
        ("post", f"/api/competitions/{comp_id}/import", None),
        ("post", f"/api/competitions/{comp_id}/enrich", None),
        ("post", "/api/competitions/bulk-import", {"urls": ["http://example.com/bulk"]}),
    ]


@pytest_asyncio.fixture
async def non_admin_token(request, reader_token, coach_token, skater_token) -> str:
    return {
        "reader_token": reader_token,
        "coach_token": coach_token,
        "skater_token": skater_token,
    }[request.param]


@pytest.mark.parametrize("non_admin_token", ["reader_token", "coach_token", "skater_token"], indirect=True)
async def test_non_admin_cannot_write_competitions(client, comp, non_admin_token):
    token = non_admin_token
    for method, path, body in _calls(comp.id):
        kwargs = {"headers": {"Authorization": f"Bearer {token}"}}
        if body is not None:
            kwargs["json"] = body
        r = await getattr(client, method)(path, **kwargs)
        assert r.status_code == 403, f"{method.upper()} {path} -> {r.status_code}"


async def test_admin_can_create_and_delete(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = await client.post("/api/competitions/", json={"url": "http://example.com/admin"}, headers=headers)
    assert r.status_code == 201
    r = await client.delete(f"/api/competitions/{r.json()['id']}", headers=headers)
    assert r.status_code == 204
