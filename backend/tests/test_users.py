import pytest


@pytest.mark.asyncio
async def test_list_users_as_admin(client, admin_token):
    resp = await client.get(
        "/api/users/",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_list_users_as_reader_forbidden(client, reader_token):
    resp = await client.get(
        "/api/users/",
        headers={"Authorization": f"Bearer {reader_token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_user(client, admin_token):
    resp = await client.post(
        "/api/users/",
        json={
            "email": "newuser@test.com",
            "display_name": "New User",
            "role": "reader",
            "password": "password123",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "newuser@test.com"


@pytest.mark.asyncio
async def test_update_user_role(client, admin_token, reader_user):
    user, _ = reader_user
    resp = await client.patch(
        f"/api/users/{user.id}",
        json={"role": "admin"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_delete_last_admin_prevented(client, admin_token, admin_user):
    user, _ = admin_user
    resp = await client.delete(
        f"/api/users/{user.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_skater_user_with_skater_ids(client, admin_token, db_session):
    from app.models.skater import Skater

    skater = Skater(first_name="Luna", last_name="Star", club="TestClub")
    db_session.add(skater)
    await db_session.commit()
    await db_session.refresh(skater)

    resp = await client.post(
        "/api/users/",
        json={
            "email": "parent@test.com",
            "display_name": "Parent Luna",
            "role": "skater",
            "password": "password123",
            "skater_ids": [skater.id],
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "skater"
    assert resp.json()["skater_ids"] == [skater.id]


@pytest.mark.asyncio
async def test_list_users_includes_skater_ids(client, admin_token, db_session):
    from app.models.skater import Skater
    from app.models.user import User
    from app.models.user_skater import UserSkater
    from app.auth.passwords import hash_password

    skater = Skater(first_name="Max", last_name="Power", club="TestClub")
    db_session.add(skater)
    await db_session.flush()
    user = User(email="skateparent@test.com", display_name="SP", role="skater", password_hash=hash_password("pass12345"))
    db_session.add(user)
    await db_session.flush()
    db_session.add(UserSkater(user_id=user.id, skater_id=skater.id))
    await db_session.commit()

    resp = await client.get(
        "/api/users/",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    skater_user = next(u for u in resp.json() if u["email"] == "skateparent@test.com")
    assert skater_user["skater_ids"] == [skater.id]


@pytest.mark.asyncio
async def test_update_role_from_skater_clears_links(client, admin_token, db_session):
    from app.models.skater import Skater
    from app.models.user import User
    from app.models.user_skater import UserSkater
    from app.auth.passwords import hash_password
    from sqlalchemy import select

    skater = Skater(first_name="Zoe", last_name="Clear", club="TestClub")
    db_session.add(skater)
    await db_session.flush()
    user = User(email="toclear@test.com", display_name="TC", role="skater", password_hash=hash_password("pass12345"))
    db_session.add(user)
    await db_session.flush()
    db_session.add(UserSkater(user_id=user.id, skater_id=skater.id))
    await db_session.commit()

    resp = await client.patch(
        f"/api/users/{user.id}",
        json={"role": "reader"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "reader"

    result = await db_session.execute(
        select(UserSkater).where(UserSkater.user_id == user.id)
    )
    assert result.scalars().all() == []


@pytest.mark.asyncio
async def test_create_skater_user_with_linked_skaters(db_session):
    """Verify user_skaters association works at model level."""
    from app.models.user import User
    from app.models.skater import Skater
    from app.models.user_skater import UserSkater
    from sqlalchemy import select

    skater = Skater(first_name="Alice", last_name="Dupont", club="TestClub")
    db_session.add(skater)
    await db_session.flush()

    user = User(
        email="parent@test.com",
        display_name="Parent",
        role="skater",
        password_hash="fakehash",
    )
    db_session.add(user)
    await db_session.flush()

    link = UserSkater(user_id=user.id, skater_id=skater.id)
    db_session.add(link)
    await db_session.commit()

    result = await db_session.execute(
        select(UserSkater).where(UserSkater.user_id == user.id)
    )
    links = result.scalars().all()
    assert len(links) == 1
    assert links[0].skater_id == skater.id


@pytest.fixture
def _reset_login_limiter():
    from app.auth.rate_limit import login_limiter

    login_limiter._attempts.clear()
    yield
    login_limiter._attempts.clear()


@pytest.mark.asyncio
async def test_reset_password_renvoie_un_mot_de_passe_temporaire(
    client, admin_token, reader_user, _reset_login_limiter
):
    user, old_password = reader_user
    resp = await client.post(
        f"/api/users/{user.id}/reset-password",
        json={},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["temp_password"]) >= 12
    assert body["email_sent"] is False

    old = await client.post(
        "/api/auth/login", json={"email": user.email, "password": old_password}
    )
    assert old.status_code == 401

    new = await client.post(
        "/api/auth/login", json={"email": user.email, "password": body["temp_password"]}
    )
    assert new.status_code == 200
    assert new.json()["user"]["must_change_password"] is True


@pytest.mark.asyncio
async def test_reset_password_ignore_une_demande_de_compte_perimee(
    client, db_session, admin_token, _reset_login_limiter
):
    """Le délai de 7 jours repart de la réinitialisation, pas de la demande."""
    from datetime import datetime, timedelta, timezone

    from app.auth.passwords import hash_password
    from app.models.account_request import AccountRequest
    from app.models.user import User

    user = User(
        email="vieille-demande@exemple.fr",
        display_name="Vieille demande",
        role="skater",
        password_hash=hash_password("Temporaire123"),
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        AccountRequest(
            id=951,
            email=user.email,
            display_name=user.display_name,
            licence_numbers=["1"],
            status="created",
            user_id=user.id,
            created_at=datetime.now(timezone.utc) - timedelta(days=10),
        )
    )
    await db_session.commit()

    resp = await client.post(
        f"/api/users/{user.id}/reset-password",
        json={},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    login = await client.post(
        "/api/auth/login",
        json={"email": user.email, "password": resp.json()["temp_password"]},
    )
    assert login.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_envoie_l_email_sur_demande(
    client, admin_token, reader_user, monkeypatch
):
    import app.routes.users as users_routes

    sent: list[dict] = []

    async def fake_smtp(session):
        return {"host": "smtp.test", "port": 587, "user": "", "password": "", "from_addr": "x@test"}

    async def fake_send(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(users_routes, "get_smtp_config", fake_smtp)
    monkeypatch.setattr(users_routes, "send_email", fake_send)

    user, _ = reader_user
    resp = await client.post(
        f"/api/users/{user.id}/reset-password",
        json={"send_email": True},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["email_sent"] is True
    assert sent[0]["to"] == user.email
    assert sent[0]["context"]["temp_password"] == resp.json()["temp_password"]


@pytest.mark.asyncio
async def test_reset_password_interdit_aux_non_admins(client, reader_token, reader_user):
    user, _ = reader_user
    resp = await client.post(
        f"/api/users/{user.id}/reset-password",
        json={},
        headers={"Authorization": f"Bearer {reader_token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reset_password_utilisateur_inconnu(client, admin_token):
    resp = await client.post(
        "/api/users/inconnu/reset-password",
        json={},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 404
