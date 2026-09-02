#!/usr/bin/env python3

import unittest

from voice_lint import lint_html


class VoiceLintTests(unittest.TestCase):
    def test_flags_short_declarative_cluster(self) -> None:
        warnings = lint_html("<p>The deadline is gone. Other work took its place.</p>")
        self.assertTrue(any("short-declarative cluster" in item for item in warnings))

    def test_flags_formulaic_transition(self) -> None:
        warnings = lint_html("<p>The useful boundary is straightforward. I decide.</p>")
        self.assertTrue(any("formulaic transition" in item for item in warnings))

    def test_does_not_flag_one_varied_source_driven_paragraph(self) -> None:
        warnings = lint_html(
            "<p>More often than not, I export the report to Excel because an account "
            "changed hands halfway through the period, and I need to work out what the "
            "numbers are actually saying against the expectation.</p>"
        )
        self.assertEqual([], warnings)


if __name__ == "__main__":
    unittest.main()
