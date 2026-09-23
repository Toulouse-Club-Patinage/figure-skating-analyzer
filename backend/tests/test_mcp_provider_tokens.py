import pytest
from sqlalchemy import select

from mcp.server.auth.provider import TokenError

from app.mcp import grants
from app.mcp.oauth_provider import hash_secret
from app.models.oauth import OAuthClient, OAuthToken
from tests.mcp_helpers import BASE, issue_test_tokens


async def test_access_token_carries_user_and_role(oauth_provider, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    access = await oauth_provider.load_access_token(tok.access_token)
    assert access.subject == user.id and access.claims == {"role": "admin"}
    assert access.resource == f"{BASE}/mcp" and "skatelab:read" in access.scopes


async def test_unknown_or_expired_access_token(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    assert await oauth_provider.load_access_token("nope") is None
    tok = await issue_test_tokens(oauth_provider, user)
    row = (await db_session.execute(select(OAuthToken).where(
        OAuthToken.token_hash == hash_secret(tok.access_token)))).scalar_one()
    row.expires_at = 0
    await db_session.commit()
    assert await oauth_provider.load_access_token(tok.access_token) is None


async def test_deactivation_and_token_version_cut_access(oauth_provider, db_session, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    user.token_version += 1  # « se déconnecter partout » / changement de mot de passe
    await db_session.commit()
    assert await oauth_provider.load_access_token(tok.access_token) is None

    tok = await issue_test_tokens(oauth_provider, user)
    user.is_active = False
    await db_session.commit()
    assert await oauth_provider.load_access_token(tok.access_token) is None


async def test_refresh_rotates(oauth_provider, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    client = await oauth_provider.get_client(
        (await oauth_provider.load_access_token(tok.access_token)).client_id)
    refresh = await oauth_provider.load_refresh_token(client, tok.refresh_token)
    new = await oauth_provider.exchange_refresh_token(client, refresh, refresh.scopes)
    assert new.refresh_token != tok.refresh_token
    assert await oauth_provider.load_access_token(new.access_token) is not None
    assert await oauth_provider.load_refresh_token(client, new.refresh_token) is not None


async def test_refresh_reuse_revokes_family(oauth_provider, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    client = await oauth_provider.get_client(
        (await oauth_provider.load_access_token(tok.access_token)).client_id)
    refresh = await oauth_provider.load_refresh_token(client, tok.refresh_token)
    new = await oauth_provider.exchange_refresh_token(client, refresh, refresh.scopes)

    assert await oauth_provider.load_refresh_token(client, tok.refresh_token) is None  # rejoué
    assert await oauth_provider.load_access_token(new.access_token) is None           # famille révoquée
    assert await oauth_provider.load_refresh_token(client, new.refresh_token) is None
    with pytest.raises(TokenError) as exc:
        await oauth_provider.exchange_refresh_token(client, refresh, refresh.scopes)
    assert exc.value.error == "invalid_grant"


async def test_revoke_token_revokes_family(oauth_provider, admin_user):
    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    access = await oauth_provider.load_access_token(tok.access_token)
    await oauth_provider.revoke_token(access)
    assert await oauth_provider.load_access_token(tok.access_token) is None


async def test_list_and_revoke_grants(oauth_provider, db_session, admin_user, reader_user):
    admin, _ = admin_user
    reader, _ = reader_user
    await issue_test_tokens(oauth_provider, admin)
    reader_tok = await issue_test_tokens(oauth_provider, reader)

    mine = await grants.list_grants(db_session, reader.id)
    assert len(mine) == 1 and mine[0]["client_name"] == "Claude" and mine[0]["user_display_name"] == "Test Reader"
    assert len(await grants.list_grants(db_session, None)) == 2

    assert not await grants.revoke_grant(db_session, mine[0]["family_id"], admin.id)  # pas à lui
    assert await grants.revoke_grant(db_session, mine[0]["family_id"], reader.id)
    assert await oauth_provider.load_access_token(reader_tok.access_token) is None
    assert await grants.list_grants(db_session, reader.id) == []


async def test_purge_removes_unused_clients(oauth_provider, db_session, admin_user):
    from datetime import datetime, timedelta, timezone

    user, _ = admin_user
    tok = await issue_test_tokens(oauth_provider, user)
    stale = OAuthClient(client_id="stale", client_name="Claude", metadata_json={"client_id": "stale"},
                        created_at=datetime.now(timezone.utc) - timedelta(days=31))
    db_session.add(stale)
    await db_session.commit()

    await grants.purge_stale(db_session)
    assert await db_session.get(OAuthClient, "stale") is None
    assert await oauth_provider.load_access_token(tok.access_token) is not None
