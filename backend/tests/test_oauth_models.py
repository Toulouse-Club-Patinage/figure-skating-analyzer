import time

from sqlalchemy import select

from app.models.oauth import OAuthAuthRequest, OAuthClient, OAuthToken


async def test_oauth_tables_roundtrip(db_session, admin_user):
    user, _ = admin_user
    db_session.add(OAuthClient(client_id="c1", client_name="Claude", metadata_json={"client_id": "c1"}))
    db_session.add(OAuthAuthRequest(
        id="req1", client_id="c1", redirect_uri="https://claude.ai/api/mcp/auth_callback",
        redirect_uri_provided_explicitly=True, code_challenge="x" * 43, state="s",
        scopes=["skatelab:read"], resource="http://localhost/mcp", expires_at=int(time.time()) + 600,
    ))
    db_session.add(OAuthToken(
        token_hash="h" * 64, kind="access", family_id="f1", client_id="c1", user_id=user.id,
        user_token_version=user.token_version, scopes=["skatelab:read"], resource="http://localhost/mcp",
        expires_at=int(time.time()) + 3600, granted_at=int(time.time()),
    ))
    await db_session.commit()

    tok = (await db_session.execute(select(OAuthToken))).scalar_one()
    assert tok.revoked_at is None and tok.consumed_at is None and tok.last_used_at is None
    req = await db_session.get(OAuthAuthRequest, "req1")
    assert req.user_id is None and req.code_hash is None


def test_public_base_url_has_no_trailing_slash(monkeypatch):
    import importlib
    import app.config as config

    monkeypatch.setenv("PUBLIC_BASE_URL", "https://skatelab.example.org/")
    try:
        assert importlib.reload(config).PUBLIC_BASE_URL == "https://skatelab.example.org"
    finally:
        monkeypatch.delenv("PUBLIC_BASE_URL")
        importlib.reload(config)
