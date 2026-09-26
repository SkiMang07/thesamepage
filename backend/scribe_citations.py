"""
Scribe citations (C2) — record chips in Scribe's answers.

Scribe writes `[[type:id|Name]]` where it names a record. Before the reply
leaves the engine, every marker is checked against the ids Scribe's own read
tools returned in this turn (or that an earlier, already-validated turn in the
thread cited). A known id keeps its marker, with the label replaced by the
record's stored name. An unknown id, or an unsupported type, is reduced to
plain text — so a chip can never point at a record the tools did not supply.

The frontend (ScribeDrawer.tsx) turns a surviving marker into a chip and builds
the route from the type and id. No schema change: the validated markers live
in assistant_messages.content, which also lets later turns keep citing them.
"""
import re
from typing import Any

CITABLE_TYPES = ("person", "goal", "project", "org_unit", "document")

# search_workspace source_type / brief entity_type → citable type
_SOURCE_TYPE_MAP = {
    "person": "person",
    "direct_report": "person",
    "goal": "goal",
    "project": "project",
    "org_unit": "org_unit",
    "company_document": "document",
}

_MARKER = re.compile(r"\[\[([a-z_]+):([A-Za-z0-9-]{1,64})(?:\|([^\]\n]{0,160}))?\]\]")
_LABEL_MAX = 80

Registry = dict[tuple[str, str], str | None]


def _clean_label(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    label = re.sub(r"[\[\]|\n\r]+", " ", value).strip()
    if not label:
        return None
    return label if len(label) <= _LABEL_MAX else label[: _LABEL_MAX - 1].rstrip() + "…"


def _add(registry: Registry, kind: str | None, record_id: Any, label: Any = None) -> None:
    if kind not in CITABLE_TYPES or not record_id:
        return
    key = (kind, str(record_id))
    clean = _clean_label(label)
    if clean or key not in registry:
        registry[key] = clean or registry.get(key)


def _rows(result: Any) -> list[dict]:
    return [row for row in result if isinstance(row, dict)] if isinstance(result, list) else []


def collect(tool_name: str, result: Any, registry: Registry) -> None:
    """Register every record a read tool returned that Scribe may cite."""
    if tool_name == "list_goals":
        for row in _rows(result):
            _add(registry, "goal", row.get("id"), row.get("title"))
    elif tool_name == "list_projects":
        for row in _rows(result):
            _add(registry, "project", row.get("id"), row.get("title"))
    elif tool_name == "list_direct_reports":
        for row in _rows(result):
            _add(registry, "person", row.get("id"), row.get("name"))
    elif tool_name == "list_org_units":
        for row in _rows(result):
            _add(registry, "org_unit", row.get("id"), row.get("name"))
    elif tool_name == "search_workspace" and isinstance(result, dict):
        for item in _rows(result.get("results")):
            _add(
                registry,
                _SOURCE_TYPE_MAP.get(str(item.get("source_type"))),
                item.get("source_id"),
                item.get("label"),
            )
            subject = item.get("subject") or {}
            if isinstance(subject, dict):
                _add(registry, "person", subject.get("direct_report_id"), subject.get("person_name"))
                _add(registry, "org_unit", subject.get("org_unit_id"), subject.get("org_unit_name"))
    elif tool_name == "get_people_context" and isinstance(result, dict):
        for context in _rows(result.get("people")):
            person = context.get("person") or {}
            if isinstance(person, dict):
                _add(registry, "person", person.get("id"), person.get("name"))
            unit = context.get("org_unit") or {}
            if isinstance(unit, dict):
                _add(registry, "org_unit", unit.get("id"), unit.get("name"))
            for row in _rows(context.get("goals")):
                _add(registry, "goal", row.get("id"), row.get("title"))
            for row in _rows(context.get("projects")):
                _add(registry, "project", row.get("id"), row.get("title"))
    elif tool_name == "get_manager_brief":
        _collect_brief(result, registry)


def _collect_brief(node: Any, registry: Registry) -> None:
    # Brief titles are sentences ("Prep Beth's 1:1"), not record names, so the
    # id is registered without a trusted label; Scribe's own label is used.
    if isinstance(node, dict):
        kind = _SOURCE_TYPE_MAP.get(str(node.get("entity_type")))
        if kind and node.get("entity_id"):
            _add(registry, kind, node.get("entity_id"))
        for value in node.values():
            _collect_brief(value, registry)
    elif isinstance(node, list):
        for value in node:
            _collect_brief(value, registry)


def seed_from_thread(thread: list[dict]) -> Registry:
    """Markers already stored on assistant turns were validated when saved."""
    registry: Registry = {}
    for message in thread:
        if message.get("role") != "assistant" or not isinstance(message.get("content"), str):
            continue
        for match in _MARKER.finditer(message["content"]):
            _add(registry, match.group(1), match.group(2), match.group(3))
    return registry


def resolve(text: str, registry: Registry) -> str:
    """Keep markers for known records (with trusted labels); flatten the rest."""
    def replace(match: re.Match) -> str:
        kind, record_id, model_label = match.group(1), match.group(2), match.group(3)
        fallback = _clean_label(model_label)
        key = (kind, record_id)
        if kind not in CITABLE_TYPES or key not in registry:
            return fallback or ""
        label = registry[key] or fallback or kind.replace("_", " ")
        return f"[[{kind}:{record_id}|{label}]]"

    return _MARKER.sub(replace, text)


def strip(text: str) -> str:
    """Plain-text form (labels only) for places that cannot render chips."""
    return _MARKER.sub(lambda m: _clean_label(m.group(3)) or "", text)
