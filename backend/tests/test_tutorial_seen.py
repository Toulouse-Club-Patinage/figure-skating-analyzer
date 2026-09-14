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
