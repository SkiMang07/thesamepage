"""A9 — a Knowledge document goes from upload to a prep sheet's "Drew on".

The live failure: "Customer Success Principles" (~21KB of markdown) failed on
upload because the Librarian was asked to copy the whole document back inside
its JSON reply. A reply that long ran past max_tokens (and the HTTP timeout),
the JSON came back cut off, and the row went to status='failed'. Nothing was
ever confirmed, so every prep sheet ran with no company documents.

The stand-in model below behaves like the real one where it matters: it
answers the prompt it is given, and its reply is cut off at max_tokens (about
4 characters a token). A prompt that asks for the full text of a long document
therefore gets broken JSON back, which is exactly what production saw.

Fixtures are fictional (Harbor Lane, an invented support team).
"""
import io
import json
import shutil
import subprocess
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import UploadFile

from routes import documents  # noqa: E402
from routes.one_on_ones import assemble_prep_inputs, prep_drew_on  # noqa: E402
from tests.test_nightly_prep import _Client, _world  # noqa: E402

TITLE = "Harbor Lane Support Principles"
MARKER = "Answer the second question first"
CHARS_PER_TOKEN = 4


def _principles_text() -> str:
    """~21KB of plain prose, the size of the doc that failed live (21,290 chars)."""
    parts = [f"# {TITLE}\n"]
    for i in range(1, 56):
        parts.append(
            f"## Principle {i}\n"
            f"When a customer writes in about issue {i}, read the whole thread before replying. "
            f"{MARKER}: the one they did not ask but will ask next. Name the owner, the date, and "
            "what happens if the date slips. Close the loop in writing even when the answer is no, "
            "and leave the next person a note they could act on without asking you anything.\n"
        )
    return "\n".join(parts)


SOURCE = _principles_text()


class _Storage:
    def __init__(self):
        self.uploaded = []

    def from_(self, bucket):
        return SimpleNamespace(upload=lambda path, data, opts: self.uploaded.append(path),
                               remove=lambda paths: None)


class _KnowledgeClient(_Client):
    def __init__(self, rows):
        super().__init__(rows)
        self.storage = _Storage()


def _world_with_units():
    rows = _world()
    rows.update({
        "org_units": [
            {"id": "u-dept", "org_id": "org1", "name": "Support", "unit_type": "department", "parent_unit_id": None},
            {"id": "u-team", "org_id": "org1", "name": "Tier 2", "unit_type": "team", "parent_unit_id": "u-dept"},
        ],
        "documents": [],
        "document_series": [],
        "document_scopes": [],
        "document_citations": [],
    })
    rows["direct_reports"][0]["org_unit_id"] = "u-team"
    return rows


class _Model:
    """Answers like the Librarian and truncates at max_tokens like the API."""

    def __init__(self):
        self.calls = []
        self.source = SOURCE

    def _reply(self, prompt: str, max_tokens: int) -> str:
        payload = {}
        if '"extracted_text"' in prompt:
            payload["extracted_text"] = self.source  # asked to transcribe, it tries to
        payload.update({
            "category": "who_we_are_and_how_we_operate",
            "freshness_class": "evergreen",
            "effective_date": None,
            "summary_card": "I read this as the team's working principles for customer replies.",
            "novelty_score": 72,
            "series_name": None,
            "series_cadence": None,
        })
        return json.dumps(payload)[: max_tokens * CHARS_PER_TOKEN]

    def text(self, prompt, model=None, max_tokens=1500, timeout=60.0, **_):
        self.calls.append({"kind": "text", "max_tokens": max_tokens, "timeout": timeout, "prompt": prompt})
        return self._reply(prompt, max_tokens)

    def document(self, prompt, document_b64, media_type="application/pdf", model=None, max_tokens=4000):
        self.calls.append({"kind": "document", "max_tokens": max_tokens, "prompt": prompt})
        return self._reply(prompt, max_tokens)


@pytest.fixture
def env(monkeypatch):
    rows = _world_with_units()
    client = _KnowledgeClient(rows)
    model = _Model()
    monkeypatch.setattr(documents, "generate_text", model.text)
    monkeypatch.setattr(documents, "generate_text_from_document", model.document)
    monkeypatch.setattr(documents, "ensure_org", lambda *a, **k: "org1")
    monkeypatch.setattr(documents, "get_email_from_token", lambda *_a: None)
    return SimpleNamespace(rows=rows, client=client, model=model)


def _upload(env, filename: str, data: bytes, content_type: str):
    file = UploadFile(file=io.BytesIO(data), filename=filename, headers={"content-type": content_type})
    return documents.upload_document.__wrapped__(
        request=None, file=file, title=TITLE, auth=("m1", env.client), authorization="Bearer x",
    )


def _convert(tmp_path, src_name: str, content: bytes, target: str) -> bytes:
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    if not binary:
        pytest.skip("LibreOffice not installed")
    src = tmp_path / src_name
    src.write_bytes(content)
    subprocess.run([binary, "--headless", "--convert-to", target, "--outdir", str(tmp_path), str(src)],
                   check=True, capture_output=True, timeout=120)
    return (tmp_path / (src.stem + "." + target.split(":")[0])).read_bytes()


def _pdf_fixture(tmp_path) -> bytes:
    return _convert(tmp_path, "principles.txt", SOURCE.encode(), "pdf")


def _pptx_fixture(tmp_path) -> bytes:
    pptx = pytest.importorskip("pptx")
    deck = pptx.Presentation()
    for chunk in SOURCE.split("## ")[1:]:
        heading, _, body = chunk.partition("\n")
        slide = deck.slides.add_slide(deck.slide_layouts[1])
        slide.shapes.title.text = heading
        slide.placeholders[1].text = body.strip()
    out = io.BytesIO()
    deck.save(out)
    return out.getvalue()


# --- upload ---------------------------------------------------------------

def test_long_markdown_upload_reaches_review_with_its_own_text(env):
    doc = _upload(env, "principles.md", SOURCE.encode(), "text/markdown")
    assert doc["status"] == "pending_review"
    assert doc["extracted_text"] == SOURCE              # stored from the file, not re-typed by the model
    call = env.model.calls[-1]
    assert '"extracted_text"' not in call["prompt"]     # the model is not asked to echo it back
    assert call["timeout"] >= 120


def test_long_pdf_upload_reaches_review(env, tmp_path):
    doc = _upload(env, "principles.pdf", _pdf_fixture(tmp_path), "application/pdf")
    assert doc["status"] == "pending_review"
    assert MARKER in doc["extracted_text"]
    assert "Principle 55" in doc["extracted_text"]      # the end of the document survived
    assert '"extracted_text"' not in env.model.calls[-1]["prompt"]


def test_long_pptx_upload_reaches_review(env, tmp_path):
    doc = _upload(env, "principles.pptx", _pptx_fixture(tmp_path),
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    assert doc["status"] == "pending_review"
    assert "Principle 55" in doc["extracted_text"]


def test_scanned_pdf_still_goes_to_the_model_to_read(env, monkeypatch, tmp_path):
    """No text layer (a scan): the only way in is the model reading the PDF."""
    monkeypatch.setattr(documents, "_pdf_text_layer", lambda _b: "")
    env.model.source = "A one-page scanned checklist."
    doc = _upload(env, "scan.pdf", b"%PDF-1.4 fictional scan", "application/pdf")
    call = env.model.calls[-1]
    assert call["kind"] == "document" and '"extracted_text"' in call["prompt"]
    assert doc["status"] == "pending_review"
    assert doc["extracted_text"] == "A one-page scanned checklist."


# --- upload -> confirm -> prep ------------------------------------------------

def test_confirmed_document_reaches_the_prep_sheet(env):
    doc = _upload(env, "principles.md", SOURCE.encode(), "text/markdown")

    # Before confirmation it is invisible to prep (draft-then-review holds).
    before = assemble_prep_inputs(env.client, "m1", "r1", "org1", raw_notes="",
                                  carry_forward_items=[], suggested_topics=[])
    assert before["document_titles"] == []

    documents.confirm_document(
        doc["id"],
        documents.DocumentConfirmIn(category="who_we_are_and_how_we_operate",
                                    freshness_class="evergreen", org_unit_ids=["u-dept"]),
        auth=("m1", env.client),
    )

    inputs = assemble_prep_inputs(env.client, "m1", "r1", "org1", raw_notes="",
                                  carry_forward_items=[], suggested_topics=[])
    assert inputs["document_titles"] == [TITLE]
    assert MARKER in inputs["prompt"]
    assert f"{TITLE} (Knowledge)" in prep_drew_on(inputs)


def test_a_very_long_document_is_trimmed_in_the_prep_prompt():
    from context_engine import _MAX_CONTEXT_CHARS_PER_DOC, format_context_block
    block = format_context_block([{"title": "Handbook", "category": "who_we_serve",
                                   "extracted_text": "x" * (_MAX_CONTEXT_CHARS_PER_DOC * 5)}])
    assert len(block) < _MAX_CONTEXT_CHARS_PER_DOC + 2000
    assert "not included" in block
    whole = format_context_block([{"title": TITLE, "category": "who_we_serve", "extracted_text": SOURCE}])
    assert SOURCE in whole                               # a principles-sized doc goes in whole
