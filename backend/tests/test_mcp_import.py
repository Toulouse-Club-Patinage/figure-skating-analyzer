"""Outils MCP d'écriture : import de compétitions (admin + scope skatelab:import)."""
import secrets

import pytest
import pytest_asyncio
from sqlalchemy import select

import app.database as db_mod
from app.mcp.oauth_provider import IMPORT_SCOPE, SCOPE, now
from app.models.competition import Competition
from app.models.job import Job
from tests.mcp_helpers import issue_test_tokens, mcp_call, register_test_client, tool_json


@pytest_asyncio.fixture(autouse=True)
async def setup_job_queue(db_session):
    from app.services.job_queue import job_queue
    job_queue.set_session_factory(lambda: db_session, owns_session=False)
    yield
    while not job_queue._queue.empty():
        job_queue._queue.get_nowait()


async def _token(oauth_provider, user, scopes=None):
    if scopes is None:
        return (await issue_test_tokens(oauth_provider, user)).access_token
    client = await register_test_client(oauth_provider)
    async with db_mod.async_session_factory() as session:
        token = await oauth_provider.issue_tokens(
            session, client_id=client.client_id, user=user, scopes=scopes,
            family_id=secrets.token_urlsafe(16), granted_at=now(),
        )
        await session.commit()
    return token.access_token


async def call(mcp_http, token, name, **arguments):
    return await mcp_call(mcp_http, token, "tools/call", {"name": name, "arguments": arguments})


def _error(result) -> str:
    assert result["isError"] is True, result
    return result["content"][0]["text"]


async def test_import_tool_is_not_read_only(mcp_http, oauth_provider, admin_user):
    token = await _token(oauth_provider, admin_user[0])
    tools = {t["name"]: t for t in (await mcp_call(mcp_http, token, "tools/list"))["tools"]}
    ann = tools["import_competitions"]["annotations"]
    assert ann["readOnlyHint"] is False and ann["destructiveHint"] is False
    assert tools["get_import_job"]["annotations"]["readOnlyHint"] is True


async def test_admin_imports_competitions(mcp_http, oauth_provider, admin_user, db_session):
    token = await _token(oauth_provider, admin_user[0])
    url = "https://ligue-occitanie-sg.com/Resultats/2025-2026/CSNPA-X/index.htm"
    body = tool_json(await call(mcp_http, token, "import_competitions", urls=[url, url],
                                season="2025-2026", enrich=True))
    assert body["total"] == 4  # 2 × (import + enrich), compétition non dupliquée

    comps = (await db_session.execute(select(Competition).where(Competition.url == url))).scalars().all()
    assert len(comps) == 1 and comps[0].season == "2025-2026"
    jobs = (await db_session.execute(select(Job))).scalars().all()
    assert {j.type for j in jobs} == {"import", "enrich"}

    job = tool_json(await call(mcp_http, token, "get_import_job", job_id=body["job_ids"][0]))
    assert job["competition_id"] == comps[0].id and job["status"] == "queued"


async def test_admin_without_import_scope_is_refused(mcp_http, oauth_provider, admin_user, db_session):
    token = await _token(oauth_provider, admin_user[0], scopes=[SCOPE, "offline_access"])
    result = await call(mcp_http, token, "import_competitions", urls=["https://example.com/a/index.htm"])
    assert "reconnect" in _error(result).lower()
    assert (await db_session.execute(select(Competition))).scalars().all() == []


@pytest_asyncio.fixture
async def non_admin(request, reader_user, coach_user, skater_user_with_skater):
    return {"reader": reader_user, "coach": coach_user, "skater": skater_user_with_skater}[request.param][0]


@pytest.mark.parametrize("non_admin", ["reader", "coach", "skater"], indirect=True)
async def test_non_admin_is_refused(mcp_http, oauth_provider, db_session, non_admin):
    user = non_admin
    token = await _token(oauth_provider, user, scopes=[SCOPE, IMPORT_SCOPE])
    result = await call(mcp_http, token, "import_competitions", urls=["https://example.com/a/index.htm"])
    assert "administrateur" in _error(result)
    assert (await db_session.execute(select(Competition))).scalars().all() == []
    result = await call(mcp_http, token, "get_import_job", job_id="0123456789ab")
    assert "administrateur" in _error(result)


@pytest.mark.parametrize("url", [
    "ftp://example.com/x", "file:///etc/passwd", "https://localhost/x", "http://127.0.0.1/x",
    "http://10.0.0.3/x", "http://[::1]/x", "http://169.254.169.254/latest", "pas une url",
])
async def test_invalid_urls_are_refused(mcp_http, oauth_provider, admin_user, db_session, url):
    token = await _token(oauth_provider, admin_user[0])
    result = await call(mcp_http, token, "import_competitions", urls=[url])
    assert "URL" in _error(result)
    assert (await db_session.execute(select(Competition))).scalars().all() == []


async def test_url_count_is_capped(mcp_http, oauth_provider, admin_user):
    token = await _token(oauth_provider, admin_user[0])
    urls = [f"https://example.com/{i}/index.htm" for i in range(21)]
    assert "20" in _error(await call(mcp_http, token, "import_competitions", urls=urls))
    assert "URL" in _error(await call(mcp_http, token, "import_competitions", urls=[]))
