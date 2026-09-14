import logging

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)

from app.config import (
    DATABASE_URL,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    CLUB_NAME,
    CLUB_SHORT,
)


class Base(DeclarativeBase):
    pass


engine = create_async_engine(DATABASE_URL, echo=False)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    # Import models so Base.metadata knows all tables
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate_add_columns(conn)
        await _migrate_drop_constraints(conn)
        await _backfill_score_club(conn)

    await _backfill_categories()
    await _merge_pair_skaters()
    await _bootstrap()


async def _migrate_add_columns(conn) -> None:
    """Add columns that may be missing in existing SQLite databases."""
    _MIGRATIONS = [
        ("competitions", "rink", "VARCHAR(255)"),
        ("scores", "skating_level", "VARCHAR(20)"),
        ("scores", "age_group", "VARCHAR(30)"),
        ("scores", "gender", "VARCHAR(10)"),
        ("category_results", "skating_level", "VARCHAR(20)"),
        ("category_results", "age_group", "VARCHAR(30)"),
        ("category_results", "gender", "VARCHAR(10)"),
        ("users", "must_change_password", "BOOLEAN DEFAULT 0"),
        ("users", "email_notifications", "BOOLEAN DEFAULT 1"),
        ("users", "last_login_at", "DATETIME"),
        ("skaters", "training_tracked", "BOOLEAN DEFAULT 0"),
        ("skaters", "manual_create", "BOOLEAN DEFAULT 0"),
        ("app_settings", "training_enabled", "INTEGER DEFAULT 0"),
        ("app_settings", "smtp_host", "VARCHAR(255)"),
        ("app_settings", "smtp_port", "INTEGER DEFAULT 587"),
        ("app_settings", "smtp_user", "VARCHAR(255)"),
        ("app_settings", "smtp_password", "TEXT"),
        ("app_settings", "smtp_from", "VARCHAR(255)"),
        ("app_settings", "smtp_from_name", "VARCHAR(255)"),
        ("competitions", "ligue", "VARCHAR(50)"),
        ("competitions", "date_end", "DATE"),
        ("competitions", "polling_enabled", "BOOLEAN DEFAULT 0"),
        ("competitions", "polling_activated_at", "DATETIME"),
        ("competitions", "team_medians", "JSON"),
        ("app_settings", "default_team_medians", "JSON"),
        ("scores", "is_titular", "BOOLEAN"),
        ("scores", "club", "VARCHAR(255)"),
        ("category_results", "club", "VARCHAR(255)"),
        ("skaters", "licence_number", "VARCHAR(50)"),
        ("app_settings", "french_ranking_url", "VARCHAR(500)"),
        ("app_settings", "account_requests_enabled", "INTEGER DEFAULT 0"),
        ("app_settings", "french_ranking_club_names", "JSON"),
        ("users", "tutorial_seen_at", "DATETIME"),
        ("app_settings", "support_email", "VARCHAR(255)"),
    ]
    for table, column, col_type in _MIGRATIONS:
        try:
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
            logger.info("Added column %s.%s", table, column)
        except Exception:
            pass  # Column already exists

    # SQLite's ALTER TABLE ADD COLUMN cannot add a UNIQUE constraint, so
    # skaters.licence_number needs an explicit unique index for migrated
    # databases to match what Base.metadata.create_all gives fresh ones.
    # NULLs are treated as distinct by SQLite unique indexes, so existing
    # rows (licence_number IS NULL) are unaffected.
    try:
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "ix_skaters_licence_number ON skaters (licence_number)"
            )
        )
        logger.info("Ensured unique index on skaters.licence_number")
    except Exception:
        pass  # Index already exists or column not yet present


async def _migrate_drop_constraints(conn) -> None:
    """Drop constraints that are no longer needed.

    SQLite does not support ALTER TABLE DROP CONSTRAINT, so we must
    recreate the table without the constraint.
    """
    # Check if self_evaluations still has the unique constraint
    try:
        result = await conn.execute(
            text("SELECT sql FROM sqlite_master WHERE type='table' AND name='self_evaluations'")
        )
        row = result.fetchone()
        if row and "uq_self_eval_skater_date" in (row[0] or ""):
            logger.info("Recreating self_evaluations table to drop unique constraint")
            await conn.execute(text("ALTER TABLE self_evaluations RENAME TO _self_evaluations_old"))
            await conn.execute(text("""
                CREATE TABLE self_evaluations (
                    id INTEGER NOT NULL PRIMARY KEY,
                    skater_id INTEGER NOT NULL,
                    mood_id INTEGER,
                    date DATE NOT NULL,
                    notes TEXT,
                    element_ratings JSON,
                    shared BOOLEAN NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    FOREIGN KEY(skater_id) REFERENCES skaters (id) ON DELETE CASCADE,
                    FOREIGN KEY(mood_id) REFERENCES training_moods (id) ON DELETE SET NULL
                )
            """))
            await conn.execute(text("""
                INSERT INTO self_evaluations
                SELECT * FROM _self_evaluations_old
            """))
            await conn.execute(text("DROP TABLE _self_evaluations_old"))
            logger.info("Dropped unique constraint uq_self_eval_skater_date")
    except Exception:
        logger.exception("Failed to drop unique constraint on self_evaluations")

    # Widen weekly_reviews unique constraint to include coach_id
    try:
        result = await conn.execute(
            text("SELECT sql FROM sqlite_master WHERE type='table' AND name='weekly_reviews'")
        )
        row = result.fetchone()
        sql = row[0] or "" if row else ""
        if "uq_review_skater_week" in sql and "uq_review_skater_week_coach" not in sql:
            logger.info("Recreating weekly_reviews table to widen unique constraint with coach_id")
            await conn.execute(text("ALTER TABLE weekly_reviews RENAME TO _weekly_reviews_old"))
            await conn.execute(text("""
                CREATE TABLE weekly_reviews (
                    id INTEGER NOT NULL PRIMARY KEY,
                    skater_id INTEGER NOT NULL,
                    coach_id VARCHAR(36) NOT NULL,
                    week_start DATE NOT NULL,
                    attendance VARCHAR(20) NOT NULL,
                    engagement INTEGER NOT NULL,
                    progression INTEGER NOT NULL,
                    attitude INTEGER NOT NULL,
                    strengths TEXT NOT NULL,
                    improvements TEXT NOT NULL,
                    visible_to_skater BOOLEAN NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    CONSTRAINT uq_review_skater_week_coach UNIQUE (skater_id, week_start, coach_id),
                    FOREIGN KEY(skater_id) REFERENCES skaters (id) ON DELETE CASCADE,
                    FOREIGN KEY(coach_id) REFERENCES users (id) ON DELETE CASCADE
                )
            """))
            await conn.execute(text("""
                INSERT INTO weekly_reviews
                SELECT * FROM _weekly_reviews_old
            """))
            await conn.execute(text("DROP TABLE _weekly_reviews_old"))
            logger.info("Widened unique constraint to uq_review_skater_week_coach")
    except Exception:
        logger.exception("Failed to widen unique constraint on weekly_reviews")


async def _backfill_score_club(conn) -> None:
    """One-time backfill: copy skater.club to scores/category_results where club is NULL."""
    await conn.execute(text("""
        UPDATE scores SET club = (
            SELECT skaters.club FROM skaters WHERE skaters.id = scores.skater_id
        ) WHERE scores.club IS NULL
    """))
    await conn.execute(text("""
        UPDATE category_results SET club = (
            SELECT skaters.club FROM skaters WHERE skaters.id = category_results.skater_id
        ) WHERE category_results.club IS NULL
    """))
    logger.info("Backfilled score/category_result club from skater.club")


async def _backfill_categories() -> None:
    """Parse category field for existing rows that lack structured fields."""
    from app.models.score import Score
    from app.models.category_result import CategoryResult
    from app.services.category_parser import parse_category

    async with async_session_factory() as session:
        result = await session.execute(
            select(Score).where(Score.skating_level.is_(None), Score.category.isnot(None))
        )
        scores = result.scalars().all()
        for score in scores:
            parsed = parse_category(score.category)
            score.skating_level = parsed["skating_level"]
            score.age_group = parsed["age_group"]
            score.gender = parsed["gender"]

        result = await session.execute(
            select(CategoryResult).where(
                CategoryResult.skating_level.is_(None), CategoryResult.category.isnot(None)
            )
        )
        cat_results = result.scalars().all()
        for cr in cat_results:
            parsed = parse_category(cr.category)
            cr.skating_level = parsed["skating_level"]
            cr.age_group = parsed["age_group"]
            cr.gender = parsed["gender"]

        if scores or cat_results:
            await session.commit()
            logger.info("Backfilled categories: %d scores, %d category_results", len(scores), len(cat_results))


async def _merge_pair_skaters() -> None:
    """Merge old-format pair skater records into the correct format.

    Old format: first_name="Laurence", last_name="FOURNIER BEAUDRY / Guillaume CIZERON"
    New format: first_name="",         last_name="Laurence FOURNIER BEAUDRY / Guillaume CIZERON"

    Reassigns scores and category_results from old to new, then deletes orphans.
    """
    from app.models.skater import Skater
    from app.models.score import Score
    from app.models.category_result import CategoryResult

    async with async_session_factory() as session:
        # Find old-format pair skaters: non-empty first_name with " / " in last_name
        result = await session.execute(
            select(Skater).where(
                Skater.first_name != "",
                Skater.last_name.contains(" / "),
            )
        )
        old_pairs = result.scalars().all()

        merged = 0
        for old in old_pairs:
            correct_last = f"{old.first_name} {old.last_name}"
            # Check if the correct-format record already exists
            result = await session.execute(
                select(Skater).where(
                    Skater.first_name == "",
                    Skater.last_name == correct_last,
                )
            )
            new = result.scalar_one_or_none()

            if new:
                # Reassign scores from old to new (skip duplicates)
                old_scores = (await session.execute(
                    select(Score).where(Score.skater_id == old.id)
                )).scalars().all()
                for score in old_scores:
                    existing = (await session.execute(
                        select(Score).where(
                            Score.skater_id == new.id,
                            Score.competition_id == score.competition_id,
                            Score.category == score.category,
                            Score.segment == score.segment,
                        )
                    )).scalar_one_or_none()
                    if existing:
                        await session.delete(score)
                    else:
                        score.skater_id = new.id

                # Reassign category_results from old to new (skip duplicates)
                old_crs = (await session.execute(
                    select(CategoryResult).where(CategoryResult.skater_id == old.id)
                )).scalars().all()
                for cr in old_crs:
                    existing = (await session.execute(
                        select(CategoryResult).where(
                            CategoryResult.skater_id == new.id,
                            CategoryResult.competition_id == cr.competition_id,
                            CategoryResult.category == cr.category,
                        )
                    )).scalar_one_or_none()
                    if existing:
                        await session.delete(cr)
                    else:
                        cr.skater_id = new.id

                # Merge metadata
                if not new.nationality and old.nationality:
                    new.nationality = old.nationality
                if not new.club and old.club:
                    new.club = old.club

                await session.delete(old)
            else:
                # No new-format record — just fix the old one in place
                old.last_name = correct_last
                old.first_name = ""

            merged += 1

        if merged:
            await session.commit()
            logger.info("Merged %d old-format pair skater records", merged)

        # Delete orphaned skaters (no scores and no category results, not manually created)
        from sqlalchemy import exists
        orphan_stmt = select(Skater).where(
            ~exists(select(Score.id).where(Score.skater_id == Skater.id)),
            ~exists(select(CategoryResult.id).where(CategoryResult.skater_id == Skater.id)),
            Skater.manual_create != True,  # noqa: E712
        )
        orphans = (await session.execute(orphan_stmt)).scalars().all()
        if orphans:
            for orphan in orphans:
                await session.delete(orphan)
            await session.commit()
            logger.info("Deleted %d orphaned skater records", len(orphans))


async def _bootstrap() -> None:
    """Seed admin user and app settings from env vars on first run."""
    from app.models.user import User
    from app.models.app_settings import AppSettings
    from app.auth.passwords import hash_password

    async with async_session_factory() as session:
        # Bootstrap admin if users table is empty and env vars set
        result = await session.execute(select(User).limit(1))
        if result.scalar_one_or_none() is None and ADMIN_EMAIL and ADMIN_PASSWORD:
            admin = User(
                email=ADMIN_EMAIL,
                password_hash=hash_password(ADMIN_PASSWORD),
                display_name="Admin",
                role="admin",
            )
            session.add(admin)

        # Bootstrap app settings if table is empty and env vars set
        result = await session.execute(select(AppSettings).limit(1))
        if result.scalar_one_or_none() is None and CLUB_NAME:
            settings = AppSettings(
                club_name=CLUB_NAME,
                club_short=CLUB_SHORT or CLUB_NAME[:5].upper(),
                current_season="2025-2026",
            )
            session.add(settings)

        await session.commit()


async def get_session() -> AsyncSession:
    async with async_session_factory() as session:
        yield session
