import json
from pathlib import Path

import pytest

DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "data"


@pytest.fixture(scope="module")
def sov() -> dict:
    with open(DATA_DIR / "sov_2026_2027.json") as f:
        return json.load(f)


def test_season(sov):
    assert sov["season"] == "2026-2027"


def test_euler_has_no_value(sov):
    """2026-27: the Euler is an unlisted jump, worth nothing."""
    eu = sov["elements"]["Eu"]
    assert eu["base_value"] == 0.0
    assert eu["goe"] == [0.0] * 10
    assert "1Eu" not in sov["elements"]


def test_choreographic_spin_exists(sov):
    chsp = sov["elements"]["ChSp1"]
    assert chsp["base_value"] == 3.50
    # Typed as a spin: the Book counts it among the three allowed spins.
    assert chsp["type"] == "spin"
    assert sov["elements"]["ChPSp1"]["base_value"] == 3.50
    assert sov["elements"]["ChPLi1"]["base_value"] == 4.50


def test_choreographic_step_sequence_revalued(sov):
    assert sov["elements"]["ChSq1"]["base_value"] == 3.50


def test_spins_revalued(sov):
    """Spot-check the across-the-board spin increase."""
    assert sov["elements"]["USp1"]["base_value"] == 1.40
    assert sov["elements"]["SSp1"]["base_value"] == 1.60
    assert sov["elements"]["CSp1"]["base_value"] == 1.70
    assert sov["elements"]["LSp1"]["base_value"] == 1.80
    assert sov["elements"]["FUSp1"]["base_value"] == 2.00
    assert sov["elements"]["CCoSp4"]["base_value"] == 4.20


def test_quints_present(sov):
    """Communication 2786 gives every clean quint the same base value."""
    for code in ("5T", "5S", "5Lo", "5F", "5Lz"):
        assert sov["elements"][code]["base_value"] == 14.00, code


def test_downgraded_quints_are_not_the_quad_value(sov):
    """The reason << must be a lookup and not a rotation-1 derivation."""
    assert sov["elements"]["5S<<"]["base_value"] == 9.50
    assert sov["elements"]["4S"]["base_value"] == 9.70
    assert sov["elements"]["5Lz<<"]["base_value"] == 9.50
    assert sov["elements"]["4Lz"]["base_value"] == 11.50


def test_triple_axel_recovered_from_column_artefact(sov):
    """3A loses its label in the PDF text layer; the generator must recover it."""
    assert sov["elements"]["3A"]["base_value"] == 8.00


def test_pair_elements_revalued(sov):
    assert sov["elements"]["3ATh"]["base_value"] == 6.00
    assert sov["elements"]["4Tw1"]["base_value"] == 6.80
    assert sov["elements"]["BoDs1"]["base_value"] == 3.60
    assert sov["elements"]["FiDs1"]["base_value"] == 2.90


def test_twist_under_rotation_uses_double_chevron(sov):
    """The legend now reads "<< - downgraded jump / downgraded twist lift"."""
    assert "1Tw1<<" in sov["elements"]
    assert "1Tw1<" not in sov["elements"]


def test_bodsn_codes_are_gone(sov):
    assert not [c for c in sov["elements"] if c.startswith("BoDsN")]


def test_no_bonus_suffixed_rows(sov):
    """b-rows are value-neutral duplicates and are dropped."""
    assert not [c for c in sov["elements"] if c.endswith("b")]


def test_every_element_has_ten_goe_values(sov):
    for code, el in sov["elements"].items():
        assert len(el["goe"]) == 10, code
        assert el["category"] in ("single", "pair"), code


def test_goe_array_ordering_is_pinned_for_a_nonzero_element(sov):
    """The goe array is [-5..-1, +1..+5]; the BASE column is not in it.

    Communication 2786 lists 3T as:
        3T  -2,10  -1,68  -1,26  -0,84  -0,42  | 4,20 |  0,42  0,84  1,26  1,68  2,10

    Pinned value-by-value because the slice that drops the BASE column is easy
    to get subtly wrong: ``values[0:5] + values[5:10]`` would splice the base
    value in at index 5 and silently lose the +5 step. 3T is a safe witness --
    its array is not equal to its own reverse, so a flipped slice cannot pass.
    """
    el = sov["elements"]["3T"]
    assert el["base_value"] == 4.20
    assert el["goe"] == [-2.10, -1.68, -1.26, -0.84, -0.42,
                         0.42, 0.84, 1.26, 1.68, 2.10]


def test_goe_arrays_are_signed_ascending_and_never_contain_the_base_value(sov):
    """Structural form of the same ordering, over every element."""
    for code, el in sov["elements"].items():
        base, goe = el["base_value"], el["goe"]
        if base == 0.0:
            assert goe == [0.0] * 10, code
            continue
        reductions, bonuses = goe[:5], goe[5:]
        assert all(v < 0 for v in reductions), code
        assert all(v > 0 for v in bonuses), code
        assert all(a < b for a, b in zip(reductions, reductions[1:])), code
        assert all(a < b for a, b in zip(bonuses, bonuses[1:])), code
        assert base not in goe, code


@pytest.fixture(scope="module")
def rules() -> dict:
    with open(DATA_DIR / "program_rules_2026_2027.json") as f:
        return json.load(f)


def test_rules_season(rules):
    assert rules["season"] == "2026-2027"


def test_all_2025_categories_still_present(rules):
    """The 2026-27 Book did not remove any category the app supports."""
    expected = {
        "ISU Senior", "ISU Junior", "ISU Advanced Novice",
        "ISU Intermediate Novice", "ISU Basic Novice",
        "Regional 3 - Niveau C", "Regional 3 - Niveau B", "Regional 3 - Niveau A",
        "Adulte Master Elite", "Adulte Or", "Adulte Argent", "Adulte Bronze",
        "Occitanie Exhibition", "Occitanie Duo",
    }
    assert set(rules["categories"]) == expected


# Hardcoded on purpose. Every other rules test iterates ``c["segments"].items()``
# and quietly does nothing when a segment is absent, so a dropped segment would
# pass the whole suite unnoticed. The map is spelled out here rather than read
# from program_rules_2025_2026.json because Task 3 deletes that file, and rather
# than derived from the file under test because an expectation computed from its
# own subject asserts nothing.
EXPECTED_SEGMENTS = {
    "ISU Senior": {"PC", "PL"},
    "ISU Junior": {"PC", "PL"},
    "ISU Advanced Novice": {"PC", "PL"},
    "ISU Intermediate Novice": {"PL"},
    "ISU Basic Novice": {"PL"},
    "Regional 3 - Niveau C": {"PL"},
    "Regional 3 - Niveau B": {"PL"},
    "Regional 3 - Niveau A": {"PL"},
    "Adulte Master Elite": {"PL"},
    "Adulte Or": {"PL"},
    "Adulte Argent": {"PL"},
    "Adulte Bronze": {"PL"},
    "Occitanie Exhibition": {"PL"},
    "Occitanie Duo": {"PL"},
}


def test_every_category_keeps_its_segments(rules):
    """Only Senior, Junior and Advanced Novice are skated over two segments.

    Catches a segment silently disappearing, which the category-name check above
    cannot see.
    """
    actual = {cat: set(c["segments"]) for cat, c in rules["categories"].items()}
    assert actual == EXPECTED_SEGMENTS


def test_isu_senior_free_skating(rules):
    """Six jump elements (was seven), three spins including the choreo spin."""
    seg = rules["categories"]["ISU Senior"]["segments"]["PL"]
    assert seg["max_jump_elements"] == 6
    assert seg["max_spins"] == 3
    assert seg["requires_choreo_spin"] is True
    assert seg["max_steps"] == 1
    assert seg["max_choreo"] == 1
    assert seg["total_elements"] == 11


def test_isu_junior_free_skating_has_no_step_sequence(rules):
    """Encoded as written: the Book's Junior FS list omits the step sequence."""
    seg = rules["categories"]["ISU Junior"]["segments"]["PL"]
    assert seg["max_jump_elements"] == 6
    assert seg["max_steps"] == 0
    assert seg["total_elements"] == 10


def test_advanced_novice_free_skating(rules):
    """Five jump elements, two spins, one choreo sequence, no step sequence."""
    seg = rules["categories"]["ISU Advanced Novice"]["segments"]["PL"]
    assert seg["max_jump_elements"] == 5
    assert seg["max_spins"] == 2
    assert seg["max_steps"] == 0
    assert seg["max_choreo"] == 1
    assert seg["total_elements"] == 8


def test_quints_allowed_only_in_isu_free_skating(rules):
    """Règle ISU 612 grants "n'importe quel nombre de tours" to the free program
    of both ISU Senior and ISU Junior, and to no other category. Short programs
    are excluded by Communication 2786 remark 6 ("quint jumps are not permit").

    Compared as a set so the assertion does not depend on dict iteration order.
    """
    allowed = {
        (cat, seg_key)
        for cat, c in rules["categories"].items()
        for seg_key, seg in c["segments"].items()
        if seg.get("quints_allowed")
    }
    assert allowed == {("ISU Senior", "PL"), ("ISU Junior", "PL")}


def test_quints_never_allowed_where_quads_are_not(rules):
    """Guard against the two flags drifting apart in a future update."""
    for cat, c in rules["categories"].items():
        for seg_key, seg in c["segments"].items():
            if seg.get("quints_allowed"):
                assert seg.get("quads_allowed") is True, f"{cat}/{seg_key}"


def test_choreo_spin_required_only_in_isu_senior_and_junior_free_skating(rules):
    """Pins the negative case: only two segments may carry the flag as True.

    The Book lists "une pirouette chorégraphique" among the three spins of the
    Senior PL (p. 30) and Junior PL (p. 31) only. Advanced Novice PL asks for a
    combination spin and a flying spin instead, and no short program has a third
    spin box at all -- a stray True on a PC segment would be caught here.
    """
    required = {
        (cat, seg_key)
        for cat, c in rules["categories"].items()
        for seg_key, seg in c["segments"].items()
        if seg.get("requires_choreo_spin")
    }
    assert required == {("ISU Senior", "PL"), ("ISU Junior", "PL")}

    # Every segment must state the flag explicitly, so that a key deleted by
    # accident cannot pass itself off as a deliberate False.
    for cat, c in rules["categories"].items():
        for seg_key, seg in c["segments"].items():
            assert isinstance(seg.get("requires_choreo_spin"), bool), f"{cat}/{seg_key}"


def test_euler_forbidden_in_short_programs(rules):
    for cat, c in rules["categories"].items():
        for seg_key, seg in c["segments"].items():
            if seg_key == "PC":
                assert seg.get("euler_allowed") is False, f"{cat}/{seg_key}"


def test_element_maxima_sum_to_total(rules):
    """Catches a miscounted total_elements when a maximum is edited."""
    for cat, c in rules["categories"].items():
        for seg_key, seg in c["segments"].items():
            if "total_elements" not in seg:
                continue
            # has_duo_element is deliberately NOT added here: it flags that one of
            # the elements IS a duo element, it does not add an extra one.
            # (Occitanie Duo: 2+2+1+1 = 6 = total_elements, with the flag set.)
            parts = sum(
                seg.get(k, 0)
                for k in ("max_jump_elements", "max_spins", "max_steps", "max_choreo")
            )
            assert parts == seg["total_elements"], f"{cat}/{seg_key}: {parts} != {seg['total_elements']}"


def test_novice_free_skating_carries_variety_bonus(rules):
    for cat in ("ISU Advanced Novice", "ISU Intermediate Novice", "ISU Basic Novice"):
        seg = rules["categories"][cat]["segments"]["PL"]
        assert seg["bonus"]["jump_variety"] == 2


def test_advanced_novice_jump_bonuses(rules):
    pc = rules["categories"]["ISU Advanced Novice"]["segments"]["PC"]["bonus"]
    assert pc["double_axel"] == 1
    assert pc["triple"] == 1
    assert "second_different_triple" not in pc

    pl = rules["categories"]["ISU Advanced Novice"]["segments"]["PL"]["bonus"]
    assert pl["double_axel"] == 1
    assert pl["triple"] == 1
    assert pl["second_different_triple"] == 1


def test_every_segment_states_euler_allowed_explicitly(rules):
    """An omitted euler_allowed would silently license an Euler -- the opposite
    of the safe default every sibling flag (quads_allowed, quints_allowed, ...)
    uses. Next season's author must set the key explicitly on every segment."""
    n = 0
    for cat, c in rules["categories"].items():
        for seg_key, seg in c["segments"].items():
            n += 1
            assert "euler_allowed" in seg, f"{cat}/{seg_key}"
    assert n == 17


def test_allowed_spins_key_mismatch_is_known_and_deliberate(rules):
    """The data writes ``allowed_spins``; the TypeScript validator
    (program-validator.ts, ``rules.allowed_spin_types``) and client.ts read
    ``allowed_spin_types``, so Régional 3 spin validation has never executed.

    This is a known, deliberate mismatch -- NOT renamed in the Book/SOV
    2026-2027 branch, because renaming the JSON key would silently switch a
    dormant rule on for real users, which is a behaviour change nobody asked
    for. This test pins the current (mismatched) state so the next person to
    touch this file discovers the mismatch instead of re-deriving it, rather
    than "fixing" it by accident.
    """
    regional_3_segments_with_spins = []
    for cat, c in rules["categories"].items():
        for seg_key, seg in c["segments"].items():
            if "allowed_spins" in seg:
                regional_3_segments_with_spins.append((cat, seg_key))
            assert "allowed_spin_types" not in seg, f"{cat}/{seg_key}"
    assert len(regional_3_segments_with_spins) == 3


def test_allowed_jumps_exist_in_sov(rules, sov):
    """A typo in an allowed_jumps entry would silently forbid everything.

    Deliberately not extended to ``allowed_spins``: those entries are base
    abbreviations (USp, CoSp, CUSp) that are never SOV keys on their own -- the
    SOV only carries leveled variants (USp1, USpB, CoSp4V), so the same lookup
    would fail on every Régional 3 row.
    """
    for cat, c in rules["categories"].items():
        for seg_key, seg in c["segments"].items():
            for code in seg.get("allowed_jumps", []):
                assert code in sov["elements"], f"{cat}/{seg_key}: {code}"
