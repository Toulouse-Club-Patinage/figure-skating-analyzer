from __future__ import annotations

from datetime import datetime


def parse_time(value: str) -> tuple[int, int] | None:
    """"HH:MM" → (h, m), None si invalide."""
    parts = value.split(":")
    if len(parts) != 2 or not all(p.isdigit() and len(p) == 2 for p in parts):
        return None
    h, m = int(parts[0]), int(parts[1])
    if h > 23 or m > 59:
        return None
    return h, m


def should_run_now(*, enabled: bool, time: str, last_run_at: str | None, now: datetime) -> bool:
    """Vrai si le jalon HH:MM du jour (dans le fuseau de `now`) est passé et
    qu'aucune sauvegarde n'a tourné depuis. Un serveur éteint à l'heure prévue
    rattrape donc la sauvegarde au premier tick qui suit son redémarrage."""
    if not enabled:
        return False
    hm = parse_time(time)
    if hm is None:
        return False
    milestone = now.replace(hour=hm[0], minute=hm[1], second=0, microsecond=0)
    if now < milestone:
        return False
    if not last_run_at:
        return True
    try:
        last = datetime.fromisoformat(last_run_at)
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=now.tzinfo)
    return last < milestone
