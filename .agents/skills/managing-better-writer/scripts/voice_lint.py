#!/usr/bin/env python3
"""Flag sentence patterns that deserve a Managing Better voice review."""

from __future__ import annotations

import argparse
import re
from html.parser import HTMLParser
from pathlib import Path


SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[\"'A-Z0-9])")
WORD = re.compile(r"[A-Za-z0-9]+(?:['’][A-Za-z]+)?")
CORRECTIVE_PATTERNS = (
    re.compile(r"\bnot just\b", re.IGNORECASE),
    re.compile(r"\bI (?:do not|don't) think (?:that|so) anymore\b", re.IGNORECASE),
    re.compile(r"\bIt (?:does not|doesn't|cannot|can't)\b"),
    re.compile(r"\bI am not\b"),
)
FORMULAIC_STARTS = (
    "By this point",
    "In practice",
    "Only then",
    "The remaining",
    "The useful boundary",
    "This is also where",
    "This is the part",
    "This part matters because",
)


class ParagraphParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.paragraphs: list[tuple[int, str]] = []
        self._depth = 0
        self._parts: list[str] = []
        self._start_line = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "p":
            if self._depth == 0:
                self._parts = []
                self._start_line = self.getpos()[0]
            self._depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "p" and self._depth:
            self._depth -= 1
            if self._depth == 0:
                text = " ".join("".join(self._parts).split())
                if text:
                    self.paragraphs.append((self._start_line, text))

    def handle_data(self, data: str) -> None:
        if self._depth:
            self._parts.append(data)


def word_count(sentence: str) -> int:
    return len(WORD.findall(sentence))


def lint_html(source: str) -> list[str]:
    parser = ParagraphParser()
    parser.feed(source)
    warnings: list[str] = []

    for line, paragraph in parser.paragraphs:
        sentences = [part.strip() for part in SENTENCE_BREAK.split(paragraph) if part.strip()]
        for first, second in zip(sentences, sentences[1:]):
            if word_count(first) <= 8 and word_count(second) <= 8:
                warnings.append(
                    f"line {line}: short-declarative cluster: {first!r} / {second!r}"
                )

        for pattern in CORRECTIVE_PATTERNS:
            if pattern.search(paragraph):
                warnings.append(
                    f"line {line}: polished corrective cadence ({pattern.pattern!r}): "
                    f"{paragraph!r}"
                )
                break

        if paragraph.startswith(FORMULAIC_STARTS):
            warnings.append(f"line {line}: formulaic transition: {paragraph!r}")

    return warnings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Flag cadence patterns for human voice review; this is not an AI detector."
    )
    parser.add_argument("post_html", type=Path)
    args = parser.parse_args()

    warnings = lint_html(args.post_html.read_text(encoding="utf-8"))
    if not warnings:
        print("No configured voice-pattern warnings.")
        return 0

    print(f"{len(warnings)} voice-pattern warning(s); review against Andrew's source:")
    for warning in warnings:
        print(f"- {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
