# backend/app/services/import_service.py
from __future__ import annotations

from datetime import date as date_type, datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.competition import Competition
from app.models.skater import Skater
from app.models.score import Score
from app.models.category_result import CategoryResult
from app.models.skater_alias import SkaterAlias
from app.services.scraper_factory import get_scraper
from app.services.downloader import download_pdfs, url_to_slug
from app.services.parser import parse_elements, extract_segment_code
from app.services.name_parser import parse_skater_name
from app.services.category_parser import parse_category


def _normalize_couple_club(club: str | None, first_name: str, last_name: str) -> str | None:
    """For couples (first_name="" and last_name contains " / "), take only the first club.

    France Clubs rules require both partners to compete for the same club.
    Some sources list both clubs as "Club A / Club B"; we normalize to "Club A".
    """
    if not first_name and " / " in last_name and club and "/" in club:
        return club.split("/", 1)[0].strip() or None
    return club


async def _get_or_create_skater(
    session: AsyncSession,
    raw_name: str,
    nationality: str | None,
    club: str | None,
    competition_date: date_type | None = None,
) -> Skater:
    first_name, last_name = parse_skater_name(raw_name)
    club = _normalize_couple_club(club, first_name, last_name)
    stmt = select(Skater).where(
        Skater.first_name == first_name,
        Skater.last_name == last_name,
    )
    skater = (await session.execute(stmt)).scalar_one_or_none()

    # For pairs (first_name="" and last_name contains " / "), look for old-format
    # duplicates where the first partner's first name was incorrectly stored in
    # first_name (e.g. first_name="Laurence", last_name="FOURNIER BEAUDRY / Guillaume CIZERON").
    # Migrate old record to new format and reassign scores.
    if not skater and first_name == "" and " / " in last_name:
        parts = last_name.split(" / ", 1)
        first_part_words = parts[0].split()
        # Try each possible split of the first partner's name
        for i in range(1, len(first_part_words)):
            candidate_first = " ".join(first_part_words[:i])
            candidate_last = " ".join(first_part_words[i:]) + " / " + parts[1]
            old_stmt = select(Skater).where(
                Skater.first_name == candidate_first,
                Skater.last_name == candidate_last,
            )
            old_skater = (await session.execute(old_stmt)).scalar_one_or_none()
            if old_skater:
                # Migrate old record to correct format
                old_skater.first_name = ""
                old_skater.last_name = last_name
                skater = old_skater
                break

    # Check aliases (from merged skaters)
    if not skater:
        alias_stmt = select(SkaterAlias).where(
            SkaterAlias.first_name == first_name,
            SkaterAlias.last_name == last_name,
        )
        alias = (await session.execute(alias_stmt)).scalar_one_or_none()
        if alias:
            skater = await session.get(Skater, alias.skater_id)

    if not skater:
        skater = Skater(
            first_name=first_name,
            last_name=last_name,
            nationality=nationality,
            club=club,
        )
        session.add(skater)
        await session.flush()
    else:
        if not skater.nationality and nationality:
            skater.nationality = nationality
        if club:
            # Only update Skater.club if this competition is the most recent
            if competition_date:
                latest_stmt = (
                    select(func.max(Competition.date))
                    .join(Score, Score.competition_id == Competition.id)
                    .where(Score.skater_id == skater.id, Score.club.isnot(None))
                )
                latest = (await session.execute(latest_stmt)).scalar_one_or_none()
                if latest is None or competition_date >= latest:
                    skater.club = club
            else:
                skater.club = club
    return skater


def _orphan_skater_query():
    """Query for skaters with no scores, no category results, and no aliases."""
    from sqlalchemy import exists
    return select(Skater).where(
        ~exists(select(Score.id).where(Score.skater_id == Skater.id)),
        ~exists(select(CategoryResult.id).where(CategoryResult.skater_id == Skater.id)),
        ~exists(select(SkaterAlias.id).where(SkaterAlias.skater_id == Skater.id)),
    )


_SCORE_VALUE_FIELDS = ("total_score", "technical_score", "component_score", "deductions")


def _differs(old: float | None, new: float | None) -> bool:
    """True when a scraped value (non-null) differs from the stored one."""
    if new is None:
        return False
    return old is None or round(old, 2) != round(new, 2)


def _score_values_changed(score: Score, r) -> bool:
    return any(_differs(getattr(score, f), getattr(r, f)) for f in _SCORE_VALUE_FIELDS)


def _change(
    kind: str,
    skater_id: int,
    category: str | None,
    segment: str | None = None,
    total_score: float | None = None,
    rank: int | None = None,
) -> dict:
    """A result change worth notifying (see notification_service.notify_competition_changes)."""
    return {
        "skater_id": skater_id,
        "kind": kind,
        "category": category,
        "segment": segment,
        "total_score": total_score,
        "rank": rank,
    }


async def run_import(session: AsyncSession, competition_id: int, force: bool = False) -> dict:
    """Import competition results. Returns the import result dict."""
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise ValueError(f"Competition {competition_id} not found")

    scraper = get_scraper(comp.url)
    events, results, cat_results, comp_info, index_html = await scraper.scrape(comp.url)

    if comp_info.name and (comp.name == comp.url or not comp.name or comp.name == "index.htm"):
        comp.name = comp_info.name
    if comp_info.date and not comp.date:
        comp.date = date_type.fromisoformat(comp_info.date)
    if comp_info.date_end and not comp.date_end:
        comp.date_end = date_type.fromisoformat(comp_info.date_end)

    # Detect metadata from URL + HTML content
    from app.services.competition_metadata import detect_metadata
    meta = detect_metadata(
        comp.url, index_html,
        scraped_city=comp_info.city,
        scraped_country=comp_info.country,
    )
    # Always fill in ligue and date_end if missing (even if metadata confirmed)
    if meta.get("ligue") and not comp.ligue:
        comp.ligue = meta["ligue"]

    if not comp.metadata_confirmed:
        # Overwrite all detectable fields when metadata is not yet confirmed
        if meta["competition_type"]:
            comp.competition_type = meta["competition_type"]
        if meta["city"]:
            comp.city = meta["city"]
        if meta["country"]:
            comp.country = meta["country"]
        if meta["season"]:
            comp.season = meta["season"]
        if comp_info.rink:
            comp.rink = comp_info.rink

    # Auto-enable polling for future or in-progress competitions
    today = date_type.today()
    end = comp.date_end or comp.date
    if end and end >= today and not comp.polling_enabled:
        comp.polling_enabled = True
        comp.polling_activated_at = datetime.now(timezone.utc)

    imported = 0
    skipped = 0
    cat_imported = 0
    cat_skipped = 0
    errors = []
    changes: list[dict] = []

    for r in results:
        try:
            skater = await _get_or_create_skater(session, r.name, r.nationality, r.club, comp.date)
            existing = await session.execute(
                select(Score).where(
                    Score.competition_id == comp.id,
                    Score.skater_id == skater.id,
                    Score.category == r.category,
                    Score.segment == r.segment,
                )
            )
            existing_score = existing.scalar_one_or_none()
            if existing_score:
                corrected = _score_values_changed(existing_score, r)
                if force:
                    # Update all scraped fields, but preserve enriched data (elements, pdf_path)
                    existing_score.rank = r.rank
                    existing_score.total_score = r.total_score
                    existing_score.technical_score = r.technical_score
                    existing_score.component_score = r.component_score
                    existing_score.deductions = r.deductions
                    existing_score.starting_number = r.starting_number
                    if r.event_date:
                        existing_score.event_date = date_type.fromisoformat(r.event_date)
                    pf, pl = parse_skater_name(r.name)
                    existing_score.club = _normalize_couple_club(r.club, pf, pl)
                    parsed = parse_category(r.category)
                    existing_score.skating_level = parsed["skating_level"]
                    existing_score.age_group = parsed["age_group"]
                    existing_score.gender = parsed["gender"]
                    # Only overwrite components if not already enriched with per-judge data
                    if r.components and (
                        not existing_score.components
                        or isinstance(next(iter(existing_score.components.values()), None), (int, float))
                    ):
                        existing_score.components = r.components
                    # elements and pdf_path are intentionally preserved (set by run_enrich)
                else:
                    # Update rank (may change as more skaters complete the segment)
                    if r.rank is not None and existing_score.rank != r.rank:
                        existing_score.rank = r.rank
                    if corrected:
                        for field in _SCORE_VALUE_FIELDS:
                            value = getattr(r, field)
                            if value is not None:
                                setattr(existing_score, field, value)
                if corrected:
                    changes.append(_change(
                        "score_corrected", skater.id, existing_score.category,
                        existing_score.segment, existing_score.total_score, existing_score.rank,
                    ))
                skipped += 1
                continue
            score = Score(
                competition_id=comp.id,
                skater_id=skater.id,
                segment=r.segment or "UNKNOWN",
                category=r.category,
                rank=r.rank,
                total_score=r.total_score,
                technical_score=r.technical_score,
                component_score=r.component_score,
                components=r.components,
                deductions=r.deductions,
                starting_number=r.starting_number,
                event_date=date_type.fromisoformat(r.event_date) if r.event_date else None,
            )
            parsed = parse_category(r.category)
            score.skating_level = parsed["skating_level"]
            score.age_group = parsed["age_group"]
            score.gender = parsed["gender"]
            pf, pl = parse_skater_name(r.name)
            score.club = _normalize_couple_club(r.club, pf, pl)
            session.add(score)
            changes.append(_change("new_score", skater.id, score.category, score.segment, score.total_score, score.rank))
            imported += 1
        except Exception as e:
            errors.append({"skater": r.name, "error": str(e)})

    for cr in cat_results:
        try:
            skater = await _get_or_create_skater(session, cr.name, cr.nationality, cr.club, comp.date)
            existing = await session.execute(
                select(CategoryResult).where(
                    CategoryResult.competition_id == comp.id,
                    CategoryResult.skater_id == skater.id,
                    CategoryResult.category == cr.category,
                )
            )
            existing_cr = existing.scalar_one_or_none()
            if existing_cr:
                total_changed = _differs(existing_cr.combined_total, cr.combined_total)
                # Update ranks and totals (change as competition progresses)
                if cr.overall_rank is not None:
                    existing_cr.overall_rank = cr.overall_rank
                if cr.combined_total is not None:
                    existing_cr.combined_total = cr.combined_total
                if cr.sp_rank is not None:
                    existing_cr.sp_rank = cr.sp_rank
                if cr.fs_rank is not None:
                    existing_cr.fs_rank = cr.fs_rank
                if cr.segment_count is not None:
                    existing_cr.segment_count = cr.segment_count
                if force:
                    if cr.club is not None:
                        existing_cr.club = cr.club
                    parsed = parse_category(cr.category)
                    existing_cr.skating_level = parsed["skating_level"]
                    existing_cr.age_group = parsed["age_group"]
                    existing_cr.gender = parsed["gender"]
                if total_changed:
                    changes.append(_change(
                        "final_result", skater.id, existing_cr.category,
                        total_score=existing_cr.combined_total, rank=existing_cr.overall_rank,
                    ))
                cat_skipped += 1
                continue
            cat_result = CategoryResult(
                competition_id=comp.id,
                skater_id=skater.id,
                category=cr.category or "UNKNOWN",
                overall_rank=cr.overall_rank,
                combined_total=cr.combined_total,
                segment_count=cr.segment_count,
                sp_rank=cr.sp_rank,
                fs_rank=cr.fs_rank,
            )
            parsed = parse_category(cr.category)
            cat_result.skating_level = parsed["skating_level"]
            cat_result.age_group = parsed["age_group"]
            cat_result.gender = parsed["gender"]
            cat_result.club = cr.club
            session.add(cat_result)
            if cat_result.combined_total is not None:
                changes.append(_change(
                    "final_result", skater.id, cat_result.category,
                    total_score=cat_result.combined_total, rank=cat_result.overall_rank,
                ))
            cat_imported += 1
        except Exception as e:
            errors.append({"skater": cr.name, "error": str(e)})

    status = "success" if not errors else "partial"
    import_log = {
        "status": status,
        "events_found": len(events),
        "scores_imported": imported,
        "scores_skipped": skipped,
        "category_results_imported": cat_imported,
        "category_results_skipped": cat_skipped,
        "errors": errors,
    }
    comp.last_import_log = import_log

    await session.commit()

    # Clean up orphaned skaters (no scores and no category results)
    orphan_stmt = _orphan_skater_query()
    orphans = (await session.execute(orphan_stmt)).scalars().all()
    for orphan in orphans:
        await session.delete(orphan)
    if orphans:
        await session.commit()

    return {"competition_id": competition_id, **import_log, "changes": changes}


async def run_enrich(session: AsyncSession, competition_id: int, force: bool = False) -> dict:
    """Enrich scores with PDF element details. Returns the enrich result dict."""
    comp = await session.get(Competition, competition_id)
    if not comp:
        raise ValueError(f"Competition {competition_id} not found")

    scraper = get_scraper(comp.url)
    events, _, _, _, _ = await scraper.scrape(comp.url)
    pdf_urls = [e.pdf_url for e in events if e.pdf_url]

    if not pdf_urls:
        return {"competition_id": competition_id, "pdfs_downloaded": 0, "scores_enriched": 0, "errors": [], "changes": []}

    slug = url_to_slug(comp.url)
    pdf_paths = await download_pdfs(pdf_urls, slug)

    enriched = 0
    unmatched = []
    errors = []
    changes: list[dict] = []

    for pdf_path in pdf_paths:
        try:
            parsed = parse_elements(pdf_path)
            for entry in parsed:
                skater_name = entry["skater_name"]
                elements = entry["elements"]
                seg_code = extract_segment_code(entry.get("category_segment"))
                pdf_first, pdf_last = parse_skater_name(skater_name)
                stmt = (
                    select(Score)
                    .join(Skater)
                    .where(
                        Score.competition_id == comp.id,
                        Skater.first_name == pdf_first,
                        Skater.last_name == pdf_last,
                    )
                )
                if seg_code:
                    stmt = stmt.where(Score.segment == seg_code)
                result = await session.execute(stmt)
                scores = result.scalars().all()
                # Build enriched components dict from PDF data
                pdf_components = entry.get("components")
                enriched_components = None
                if pdf_components:
                    enriched_components = {
                        c["name"]: {"score": c["score"], "factor": c["factor"], "judges": c["judges"]}
                        for c in pdf_components
                    }

                if scores:
                    for score in scores:
                        if not score.elements or force:
                            first_sheet = not score.elements
                            score.elements = elements
                            score.pdf_path = str(pdf_path)
                            enriched += 1
                            if first_sheet and elements:
                                changes.append(_change(
                                    "sheet_available", score.skater_id, score.category,
                                    score.segment, score.total_score, score.rank,
                                ))
                        if enriched_components and (not score.components or force or isinstance(next(iter(score.components.values()), None), (int, float))):
                            score.components = enriched_components
                else:
                    unmatched.append(skater_name)
        except Exception as e:
            errors.append({"file": str(pdf_path), "error": str(e)})

    await session.commit()
    return {
        "competition_id": competition_id,
        "pdfs_downloaded": len(pdf_paths),
        "scores_enriched": enriched,
        "unmatched": unmatched,
        "errors": errors,
        "changes": changes,
    }
