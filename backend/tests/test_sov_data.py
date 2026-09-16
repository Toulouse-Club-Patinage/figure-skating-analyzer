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


def test_quints_only_in_isu_senior_free_skating(rules):
    allowed = [
        (cat, seg_key)
        for cat, c in rules["categories"].items()
        for seg_key, seg in c["segments"].items()
        if seg.get("quints_allowed")
    ]
    assert allowed == [("ISU Senior", "PL")]


def test_quints_never_allowed_where_quads_are_not(rules):
    """Guard against the two flags drifting apart in a future update."""
    for cat, c in rules["categories"].items():
        for seg_key, seg in c["segments"].items():
            if seg.get("quints_allowed"):
                assert seg.get("quads_allowed") is True, f"{cat}/{seg_key}"


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


def test_allowed_jumps_and_spins_exist_in_sov(rules, sov):
    """A typo in an allowed_jumps entry would silently forbid everything."""
    for cat, c in rules["categories"].items():
        for seg_key, seg in c["segments"].items():
            for code in seg.get("allowed_jumps", []):
                assert code in sov["elements"], f"{cat}/{seg_key}: {code}"
