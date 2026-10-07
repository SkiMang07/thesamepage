"""Placement default when the model proposes a new level that is already
occupied by a different role (live finding, 2026-10-06: a QA role the model
said "needs its own level" defaulted to Mobile Engineer, Level 1)."""

from routes.roles_import import _validate_match

FAMILIES = [{"id": "fam-mobile", "name": "Mobile Engineering"}]
LEVELS = [{"id": "lvl-mobile-1", "job_role": "Mobile Engineer", "job_level": 1, "role_family_id": "fam-mobile"}]


def test_attach_onto_a_level_held_by_another_role_defaults_to_a_new_ladder():
    m = _validate_match(
        {"suggested_action": "attach", "role_family_id": "fam-mobile", "rationale": "This role needs its own level."},
        FAMILIES, LEVELS, 1, "QA Engineer",
    )
    assert m.suggested_action == "create_new"
    assert m.role_family_id is None
    assert m.existing_role_level_id is None
    assert "Mobile Engineering already has a Level 1 (Mobile Engineer)" in m.rationale


def test_attach_onto_the_same_role_still_opens_it():
    m = _validate_match(
        {"suggested_action": "attach", "role_family_id": "fam-mobile"},
        FAMILIES, LEVELS, 1, "mobile-engineer",
    )
    assert m.suggested_action == "exists"
    assert m.existing_role_level_id == "lvl-mobile-1"


def test_exists_is_kept_when_the_model_says_so():
    m = _validate_match(
        {"suggested_action": "exists", "role_family_id": "fam-mobile", "existing_role_level_id": "lvl-mobile-1"},
        FAMILIES, LEVELS, 1, "Mobile Dev",
    )
    assert m.suggested_action == "exists"
    assert m.existing_role_level_id == "lvl-mobile-1"


def test_attach_onto_a_free_level_stays_on_the_ladder():
    m = _validate_match(
        {"suggested_action": "attach", "role_family_id": "fam-mobile", "rationale": "Next level up."},
        FAMILIES, LEVELS, 2, "Senior Mobile Engineer",
    )
    assert m.suggested_action == "attach"
    assert m.role_family_id == "fam-mobile"
    assert m.rationale == "Next level up."
