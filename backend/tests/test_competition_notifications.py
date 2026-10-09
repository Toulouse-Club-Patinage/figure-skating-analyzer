import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models.competition import Competition
from app.models.notification import Notification
from app.models.skater import Skater
from app.models.user import User
from app.models.user_skater import UserSkater
from app.services import notification_service
from app.services.notification_service import format_skater_changes, notify_competition_changes


def change(kind, skater_id, segment=None, total=None, rank=None):
    return {"skater_id": skater_id, "kind": kind, "category": "R1", "segment": segment,
            "total_score": total, "rank": rank}


def test_format_score_and_sheet():
    text = format_skater_changes("Ilan Dupont", [
        change("new_score", 1, "SP", 42.31, 3),
        change("sheet_available", 1, "SP", 42.31, 3),
    ])
    assert text == "Ilan Dupont : Programme court 42,31 (3e), feuille de score disponible (Programme court)"


def test_format_correction_and_final_result():
    text = format_skater_changes("Léa Martin", [
        change("score_corrected", 2, "FS", 80.0, 1),
        change("final_result", 2, None, 118.4, 1),
    ])
    assert text == "Léa Martin : Programme libre 80,00 (1er) — score corrigé, Classement général : 1er (118,40)"


def test_format_unknown_segment_keeps_code():
    assert format_skater_changes("A B", [change("new_score", 1, "PB", None, None)]) == "A B : PB"


@pytest_asyncio.fixture
async def world(db_session):
    comp = Competition(name="CR Castres", url="http://example.com/castres", polling_enabled=True)
    alice = Skater(first_name="Alice", last_name="Dupont", club="TCP")
    bob = Skater(first_name="Bob", last_name="Martin", club="TCP")
    carl = Skater(first_name="Carl", last_name="Noël", club="TCP")
    parent1 = User(email="p1@test.com", password_hash="x", display_name="P1", role="skater",
                   email_notifications=True)
    parent2 = User(email="p2@test.com", password_hash="x", display_name="P2", role="skater",
                   email_notifications=False)
    reader = User(email="r@test.com", password_hash="x", display_name="R", role="reader")
    db_session.add_all([comp, alice, bob, carl, parent1, parent2, reader])
    await db_session.flush()
    db_session.add_all([
        UserSkater(user_id=parent1.id, skater_id=alice.id),
        UserSkater(user_id=parent1.id, skater_id=bob.id),
        UserSkater(user_id=parent2.id, skater_id=alice.id),
        UserSkater(user_id=reader.id, skater_id=alice.id),
    ])
    await db_session.commit()
    return comp, alice, bob, carl, parent1, parent2, reader


@pytest.fixture
def sent(monkeypatch):
    emails = []

    async def fake_send_email(**kwargs):
        emails.append(kwargs)
        return True

    async def fake_smtp(session):
        return {"host": "smtp.test"}

    monkeypatch.setattr(notification_service, "send_email", fake_send_email)
    monkeypatch.setattr(notification_service, "get_smtp_config", fake_smtp)
    return emails


async def _notifs(db_session, user):
    stmt = select(Notification).where(Notification.user_id == user.id)
    return (await db_session.execute(stmt)).scalars().all()


async def test_one_grouped_notification_per_user(db_session, world, sent):
    comp, alice, bob, carl, parent1, parent2, reader = world
    await notify_competition_changes(db_session, comp, [
        change("new_score", alice.id, "SP", 42.31, 3),
        change("new_score", bob.id, "SP", 30.0, 7),
        change("sheet_available", alice.id, "SP", 42.31, 3),
        change("new_score", carl.id, "SP", 25.0, 9),
    ], app_base_url="https://skatelab.test")

    [n1] = await _notifs(db_session, parent1)
    assert n1.type == "competition"
    assert n1.title == "Résultats : CR Castres"
    assert n1.link == f"/competitions/{comp.id}"
    assert n1.message.splitlines() == [
        "Alice Dupont : Programme court 42,31 (3e), feuille de score disponible (Programme court)",
        "Bob Martin : Programme court 30,00 (7e)",
    ]
    [n2] = await _notifs(db_session, parent2)
    assert n2.message.splitlines() == [
        "Alice Dupont : Programme court 42,31 (3e), feuille de score disponible (Programme court)",
    ]
    assert await _notifs(db_session, reader) == []

    assert [e["to"] for e in sent] == ["p1@test.com"]
    assert sent[0]["template_name"] == "skater_competition_notification.html"
    assert sent[0]["context"]["app_url"] == f"https://skatelab.test/competitions/{comp.id}"
    assert len(sent[0]["context"]["lines"]) == 2


async def test_nothing_without_changes(db_session, world, sent):
    comp, *_, parent1, parent2, reader = world
    await notify_competition_changes(db_session, comp, [])
    assert await _notifs(db_session, parent1) == []
    assert sent == []


async def test_nothing_when_polling_disabled(db_session, world, sent):
    comp, alice, *_rest = world
    parent1 = _rest[2]
    comp.polling_enabled = False
    await notify_competition_changes(db_session, comp, [change("new_score", alice.id, "SP", 42.31, 3)])
    assert await _notifs(db_session, parent1) == []


async def test_inactive_user_not_notified(db_session, world, sent):
    comp, alice, *_rest = world
    parent1, parent2 = _rest[2], _rest[3]
    parent2.is_active = False
    await db_session.commit()
    await notify_competition_changes(db_session, comp, [change("new_score", alice.id, "SP", 42.31, 3)])
    assert await _notifs(db_session, parent2) == []
    assert len(await _notifs(db_session, parent1)) == 1
