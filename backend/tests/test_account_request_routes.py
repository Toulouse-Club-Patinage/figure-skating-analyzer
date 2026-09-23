# backend/tests/test_account_request_routes.py
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.account_request import AccountRequest
from app.models.user import User

NEUTRAL = {"detail": "Si les informations fournies sont valides, vous recevrez un email."}


@pytest.fixture(autouse=True)
def _reset_limiter():
    from app.auth.rate_limit import account_request_limiter, login_limiter

    for limiter in (account_request_limiter, login_limiter):
        limiter._attempts.clear()
    yield
    for limiter in (account_request_limiter, login_limiter):
        limiter._attempts.clear()


async def _seed(db_session):
    db_session.add(
        AppSettings(
            club_name="Toulouse Club Patinage",
            club_short="TCP",
            french_ranking_url=None,
            account_requests_enabled=True,
        )
    )
    await db_session.commit()


async def test_reponse_neutre_quand_la_licence_est_inconnue(client, db_session):
    await _seed(db_session)
    resp = await client.post(
        "/api/auth/request-account",
        json={
            "email": "parent@exemple.fr",
            "display_name": "Marie DUPONT",
            "licences": [{"licence_number": "999999", "birth_date": "2010-01-01"}],
        },
    )
    assert resp.status_code == 202
    assert resp.json() == NEUTRAL


async def test_la_demande_est_tracee(client, db_session):
    await _seed(db_session)
    await client.post(
        "/api/auth/request-account",
        json={
            "email": "parent@exemple.fr",
            "display_name": "Marie DUPONT",
            "licences": [{"licence_number": "999999", "birth_date": "2010-01-01"}],
        },
    )
    rows = (await db_session.execute(select(AccountRequest))).scalars().all()
    assert len(rows) == 1
    assert rows[0].email == "parent@exemple.fr"


async def test_refuse_une_charge_utile_invalide(client, db_session):
    await _seed(db_session)
    resp = await client.post(
        "/api/auth/request-account",
        json={"email": "", "display_name": "", "licences": []},
    )
    assert resp.status_code == 400


async def test_refuse_si_la_fonctionnalite_est_desactivee(client, db_session):
    db_session.add(
        AppSettings(club_name="TCP", club_short="TCP", account_requests_enabled=False)
    )
    await db_session.commit()

    resp = await client.post(
        "/api/auth/request-account",
        json={
            "email": "parent@exemple.fr",
            "display_name": "Marie",
            "licences": [{"licence_number": "1", "birth_date": "2010-01-01"}],
        },
    )
    assert resp.status_code == 403


async def test_limite_le_nombre_de_demandes(client, db_session):
    await _seed(db_session)
    payload = {
        "email": "spam@exemple.fr",
        "display_name": "Spam",
        "licences": [{"licence_number": "1", "birth_date": "2010-01-01"}],
    }
    for _ in range(3):
        await client.post("/api/auth/request-account", json=payload)
    resp = await client.post("/api/auth/request-account", json=payload)
    assert resp.status_code == 429


async def test_login_refuse_un_mot_de_passe_temporaire_perime(client, db_session):
    # `id` explicite : l'app ASGI est réutilisée entre les tests et la session
    # que voient les handlers garde ses objets en identity map
    # (expire_on_commit=False). Deux demandes portant la même clé primaire se
    # masqueraient l'une l'autre d'un test à l'autre.
    from app.auth.passwords import hash_password

    user = User(
        email="perime@exemple.fr",
        display_name="Périmé",
        role="skater",
        password_hash=hash_password("Temporaire123"),
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        AccountRequest(
            id=901,
            email="perime@exemple.fr",
            display_name="Périmé",
            licence_numbers=["1"],
            status="created",
            user_id=user.id,
            created_at=datetime.now(timezone.utc) - timedelta(days=8),
        )
    )
    await db_session.commit()

    resp = await client.post(
        "/api/auth/login", json={"email": "perime@exemple.fr", "password": "Temporaire123"}
    )
    assert resp.status_code == 401

    row = (
        await db_session.execute(
            select(AccountRequest).where(AccountRequest.email == "perime@exemple.fr")
        )
    ).scalar_one()
    assert row.status == "expired"


async def test_login_accepte_un_mot_de_passe_temporaire_recent(client, db_session):
    from app.auth.passwords import hash_password

    user = User(
        email="frais@exemple.fr",
        display_name="Frais",
        role="skater",
        password_hash=hash_password("Temporaire123"),
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        AccountRequest(
            id=902,
            email="frais@exemple.fr",
            display_name="Frais",
            licence_numbers=["1"],
            status="created",
            user_id=user.id,
            created_at=datetime.now(timezone.utc) - timedelta(days=2),
        )
    )
    await db_session.commit()

    resp = await client.post(
        "/api/auth/login", json={"email": "frais@exemple.fr", "password": "Temporaire123"}
    )
    assert resp.status_code == 200


async def test_liste_admin_des_demandes(client, db_session, admin_token):
    await _seed(db_session)
    db_session.add(
        AccountRequest(
            email="parent@exemple.fr",
            display_name="Marie",
            licence_numbers=["123456"],
            status="pending_admin",
        )
    )
    await db_session.commit()

    resp = await client.get(
        "/api/admin/account-requests", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["status"] == "pending_admin"


async def test_liste_admin_refusee_aux_non_admins(client, db_session, reader_token):
    await _seed(db_session)
    resp = await client.get(
        "/api/admin/account-requests", headers={"Authorization": f"Bearer {reader_token}"}
    )
    assert resp.status_code in (401, 403)


async def test_approbation_cree_le_compte_et_les_liens(client, db_session, admin_token):
    from app.models.skater import Skater
    from app.models.user_skater import UserSkater

    await _seed(db_session)
    skater = Skater(first_name="Léa", last_name="DUPOND")
    db_session.add(skater)
    await db_session.flush()
    req = AccountRequest(
        email="parent@exemple.fr",
        display_name="Marie DUPONT",
        licence_numbers=["123456"],
        status="pending_admin",
    )
    db_session.add(req)
    await db_session.commit()

    resp = await client.post(
        f"/api/admin/account-requests/{req.id}/approve",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"skater_ids": [skater.id]},
    )
    assert resp.status_code == 200

    user = (
        await db_session.execute(select(User).where(User.email == "parent@exemple.fr"))
    ).scalar_one()
    assert user.role == "skater"
    assert user.must_change_password is True

    links = (
        await db_session.execute(select(UserSkater).where(UserSkater.user_id == user.id))
    ).scalars().all()
    assert len(links) == 1


async def test_approbation_refuse_une_demande_deja_resolue(client, db_session, admin_token):
    await _seed(db_session)
    req = AccountRequest(
        email="parent@exemple.fr",
        display_name="Marie",
        licence_numbers=["1"],
        status="created",
    )
    db_session.add(req)
    await db_session.commit()

    resp = await client.post(
        f"/api/admin/account-requests/{req.id}/approve",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"skater_ids": []},
    )
    assert resp.status_code == 400


async def test_le_front_sait_si_le_formulaire_est_actif(client, db_session):
    await _seed(db_session)
    resp = await client.get("/api/config/account-requests-enabled")
    assert resp.status_code == 200
    assert resp.json() == {"enabled": True}


async def test_login_reste_refuse_apres_expiration_du_mot_de_passe_temporaire(client, db_session):
    """Une fois la demande passée à `expired`, le même mot de passe reste refusé."""
    from app.auth.passwords import hash_password

    user = User(
        email="perime-bis@exemple.fr",
        display_name="Périmé bis",
        role="skater",
        password_hash=hash_password("Temporaire123"),
        must_change_password=True,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        AccountRequest(
            id=903,
            email="perime-bis@exemple.fr",
            display_name="Périmé bis",
            licence_numbers=["1"],
            status="created",
            user_id=user.id,
            created_at=datetime.now(timezone.utc) - timedelta(days=8),
        )
    )
    await db_session.commit()

    payload = {"email": "perime-bis@exemple.fr", "password": "Temporaire123"}
    assert (await client.post("/api/auth/login", json=payload)).status_code == 401
    assert (await client.post("/api/auth/login", json=payload)).status_code == 401
