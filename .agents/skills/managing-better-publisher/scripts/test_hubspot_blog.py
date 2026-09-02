#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("hubspot_blog.py")
SPEC = importlib.util.spec_from_file_location("hubspot_blog", MODULE_PATH)
assert SPEC and SPEC.loader
hubspot_blog = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = hubspot_blog
SPEC.loader.exec_module(hubspot_blog)


def valid_manifest() -> dict:
    return {
        "schema_version": 1,
        "title": "The note I needed in November",
        "html_title": "Performance review notes that still help in November",
        "slug": "review-notes-for-november",
        "post_summary": "A small record that survives the distance between the work and the review.",
        "meta_description": "What useful performance review notes contain, and how to keep enough context to write a review without reconstructing the year from memory.",
        "format": "note",
        "language": "en",
        "additional_tag_ids": [],
        "featured_image": {
            "file": "images/featured.png",
            "alt": "Two dated records coming into alignment",
            "hubspot_url": None,
        },
        "inline_images": [],
        "hubspot": {
            "post_id": None,
            "url": None,
            "last_state": None,
            "last_remote_fingerprint": None,
            "last_verified_at": None,
            "scheduled_for": None,
        },
    }


class PackageTests(unittest.TestCase):
    def make_package(self, body: str, manifest: dict | None = None) -> Path:
        root = Path(tempfile.mkdtemp())
        (root / "images").mkdir()
        (root / "images" / "featured.png").write_bytes(b"not-a-real-png")
        (root / "post.html").write_text(body, encoding="utf-8")
        (root / "publish.json").write_text(
            json.dumps(manifest or valid_manifest()), encoding="utf-8"
        )
        return root

    def test_valid_package(self) -> None:
        package = hubspot_blog.load_package(
            self.make_package("<p>I wrote it down on Tuesday because November was too late.</p>")
        )
        self.assertEqual(package.manifest["format"], "note")
        self.assertEqual(len(package.audit.words), 11)

    def test_rejects_editor_classes(self) -> None:
        with self.assertRaisesRegex(hubspot_blog.PackageError, "Forbidden 'class'"):
            hubspot_blog.load_package(self.make_package('<p class="callout">Text</p>'))

    def test_requires_inline_manifest_entry(self) -> None:
        body = '<p>Before.</p><img src="hubspot-image://sequence" alt="Sequence"><p>After.</p>'
        with self.assertRaisesRegex(hubspot_blog.PackageError, "missing from publish.json"):
            hubspot_blog.load_package(self.make_package(body))

    def test_rejects_unmanaged_remote_image(self) -> None:
        body = '<p>Before.</p><img src="https://example.com/image.png" alt="Sequence">'
        with self.assertRaisesRegex(hubspot_blog.PackageError, "hubspot-image placeholder"):
            hubspot_blog.load_package(self.make_package(body))

    def test_inline_alt_must_match_manifest(self) -> None:
        manifest = valid_manifest()
        manifest["inline_images"] = [
            {
                "key": "sequence",
                "file": "images/sequence.png",
                "alt": "A sequence of three records",
                "hubspot_url": None,
            }
        ]
        root = self.make_package(
            '<img src="hubspot-image://sequence" alt="Different alt text">', manifest
        )
        (root / "images" / "sequence.png").write_bytes(b"not-a-real-png")
        with self.assertRaisesRegex(hubspot_blog.PackageError, "alt text differs"):
            hubspot_blog.load_package(root)

    def test_payload_uses_native_featured_image_fields(self) -> None:
        manifest = valid_manifest()
        manifest["featured_image"]["hubspot_url"] = "https://example.com/featured.png"
        package = hubspot_blog.load_package(
            self.make_package("<p>The body does not duplicate the featured image.</p>", manifest)
        )
        payload = hubspot_blog.expected_payload(
            package,
            {
                "content_group_id": "123",
                "blog_author_id": "456",
                "format_tag_ids": {
                    "playbook": "1",
                    "teardown": "2",
                    "script": "3",
                    "note": "4",
                },
            },
            package.body,
        )
        self.assertTrue(payload["useFeaturedImage"])
        self.assertEqual(payload["featuredImage"], "https://example.com/featured.png")
        self.assertEqual(payload["featuredImageAltText"], "Two dated records coming into alignment")
        self.assertNotIn("featured.png", payload["postBody"])

    def test_fingerprint_ignores_harmless_whitespace_and_remote_attributes(self) -> None:
        local = '<p>A useful sentence.</p><img src="https://example.com/a.png" alt="A record">'
        remote = '<p class="hs-clean"> A useful   sentence. </p><img loading="lazy" alt="A record" src="https://example.com/a.png">'
        self.assertEqual(
            hubspot_blog.body_fingerprint(local),
            hubspot_blog.body_fingerprint(remote),
        )

    def test_note_word_limit(self) -> None:
        body = "<p>" + " ".join(["word"] * 401) + "</p>"
        with self.assertRaisesRegex(hubspot_blog.PackageError, "under 400 words"):
            hubspot_blog.load_package(self.make_package(body))

    def test_schedule_requires_offset(self) -> None:
        with self.assertRaisesRegex(hubspot_blog.PackageError, "explicit UTC offset"):
            hubspot_blog.parse_schedule("2099-01-01T09:00:00")

    def test_upload_images_command_requires_slug_confirmation(self) -> None:
        args = hubspot_blog.parser().parse_args(
            ["upload-images", "posts/example", "--confirm-slug", "example"]
        )
        self.assertEqual(args.command, "upload-images")
        self.assertEqual(args.confirm_slug, "example")


if __name__ == "__main__":
    unittest.main()
