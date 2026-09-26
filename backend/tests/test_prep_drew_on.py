"""prep_drew_on() — the "Drew on: …" line under every prep sheet, manual or
overnight. It names only what assemble_prep_inputs() actually put in the
prompt, and names Knowledge documents by title."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes.one_on_ones import build_prep_guide, prep_drew_on  # noqa: E402


def _inputs(**over):
    base = {
        "open_commitments": [],
        "document_titles": [],
        "history_count": 0,
        "has_role_expectations": False,
        "secondhand_count": 0,
    }
    return {**base, **over}


def test_manual_sheet_names_its_sources_and_knowledge_titles():
    labels = prep_drew_on(
        _inputs(
            open_commitments=[{"id": "c1"}, {"id": "c2"}],
            document_titles=["Q3 CS Principles"],
            history_count=3,
            has_role_expectations=True,
        ),
        carry_forward_items=["Hiring plan"],
        has_notes=True,
        suggested_topics=1,
    )
    assert labels == [
        "1 carried topic",
        "2 open commitments",
        "your notes",
        "1 suggested topic",
        "your last 3 1:1s",
        "role expectations",
        "Q3 CS Principles (Knowledge)",
    ]


def test_nothing_is_claimed_that_was_not_there():
    assert prep_drew_on(_inputs()) == []
    assert prep_drew_on(_inputs(history_count=1)) == ["your last 1:1"]


def test_kept_thoughts_take_the_place_of_notes_and_many_documents_are_counted():
    labels = prep_drew_on(
        _inputs(document_titles=["A", "B", "C", "D", "E"], secondhand_count=1),
        opening_line="How was the offsite?",
        has_notes=True,
        kept_thoughts=2,
    )
    assert labels[0] == "the opening line you kept at the last wrap-up"
    assert "2 kept thoughts" in labels and "your notes" not in labels
    assert "1 note from meetings beyond your team" in labels
    assert labels[-4:] == ["A (Knowledge)", "B (Knowledge)", "C (Knowledge)", "2 more Knowledge documents"]


def test_the_guide_stores_the_list():
    guide = build_prep_guide("s", [], [], source_notes="", prepared_by="manager", drew_on=["your notes"])
    assert guide["drew_on"] == ["your notes"]
