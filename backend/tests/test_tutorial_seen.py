# backend/tests/test_tutorial_seen.py
"""État « tutoriel vu » : colonne, exposition, et bascule par les préférences.

Le tutoriel est proposé à la première connexion. Cet état doit survivre au
changement d'appareil, d'où une colonne en base plutôt qu'un localStorage.
"""

import pytest


@pytest.mark.asyncio
async def test_login_expose_tutorial_seen_faux_par_defaut(client, admin_user):
    user, password = admin_user
    resp = await client.post(
        "/api/auth/login",
        json={"email": user.email, "password": password},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["tutorial_seen"] is False


@pytest.mark.asyncio
async def test_preferences_marque_le_tutoriel_comme_vu(
    client, admin_user, admin_token, db_session
):
    user, _ = admin_user
    resp = await client.patch(
        "/api/me/preferences",
        json={"tutorial_seen": True},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["tutorial_seen"] is True

    await db_session.refresh(user)
    assert user.tutorial_seen_at is not None


@pytest.mark.asyncio
async def test_preferences_ne_remet_jamais_a_zero(
    client, admin_user, admin_token, db_session
):
    """Écriture seule vers « vu » : relancer le tutoriel ne réarme pas l'invite."""
    user, _ = admin_user
    for payload in ({"tutorial_seen": True}, {"tutorial_seen": False}):
        await client.patch(
            "/api/me/preferences",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}"},
        )

    await db_session.refresh(user)
    assert user.tutorial_seen_at is not None


@pytest.mark.asyncio
async def test_preferences_conserve_les_notifications_email(
    client, admin_user, admin_token, db_session
):
    """Le nouveau champ ne doit pas écraser la préférence voisine."""
    user, _ = admin_user
    await client.patch(
        "/api/me/preferences",
        json={"email_notifications": False},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    await client.patch(
        "/api/me/preferences",
        json={"tutorial_seen": True},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    await db_session.refresh(user)
    assert user.email_notifications is False
    assert user.tutorial_seen_at is not None
