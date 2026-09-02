#!/usr/bin/env python3
"""Validate and deliver approved Managing Better packages through HubSpot CLI auth.

The script deliberately exposes no delete, unpublish, archive, settings-update,
author-create, tag-create, or revision-restore operation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlencode


FORMATS = {"playbook", "teardown", "script", "note"}
ALLOWED_TAGS = {
    "p", "h2", "h3", "blockquote", "ul", "ol", "li", "pre", "code",
    "a", "strong", "em", "img", "hr", "br",
}
VOID_TAGS = {"img", "hr", "br"}
SELECTED_ATTRS = {"a": {"href"}, "img": {"src", "alt"}}
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
IMAGE_KEY_RE = SLUG_RE
WORD_RE = re.compile(r"[A-Za-z0-9]+(?:[’'][A-Za-z0-9]+)*")
GENERATED_LABELS = {"What you leave with", "Say it like this"}


class PackageError(RuntimeError):
    pass


class RemoteError(RuntimeError):
    pass


def find_repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "CLAUDE.md").is_file() and (parent / "website" / "package.json").is_file():
            return parent
    raise PackageError("Could not locate The Same Page repository root")


REPO_ROOT = find_repo_root()
CONFIG_PATH = REPO_ROOT / "gtm" / "managing-better" / "hubspot.json"
POSTS_ROOT = REPO_ROOT / "gtm" / "managing-better" / "posts"


def normalized_text(value: str) -> str:
    return " ".join(value.split())


class BodyAudit(HTMLParser):
    def __init__(self, *, strict: bool) -> None:
        super().__init__(convert_charrefs=True)
        self.strict = strict
        self.stack: list[str] = []
        self.tokens: list[list[Any]] = []
        self.errors: list[str] = []
        self.words: list[str] = []
        self.image_placeholders: list[str] = []
        self.image_placeholder_alts: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_map = {name.lower(): value or "" for name, value in attrs}
        if tag not in ALLOWED_TAGS:
            self.errors.append(f"Unsupported <{tag}> element")
        if self.strict:
            for name in attr_map:
                if name in {"class", "id", "style"} or name.startswith("on"):
                    self.errors.append(f"Forbidden {name!r} attribute on <{tag}>")
                elif name not in SELECTED_ATTRS.get(tag, set()):
                    self.errors.append(f"Unsupported {name!r} attribute on <{tag}>")
        if tag == "a" and not attr_map.get("href"):
            self.errors.append("Every <a> needs a non-empty href")
        if tag == "img":
            if "alt" not in attr_map:
                self.errors.append("Every <img> needs an alt attribute, even when empty")
            src = attr_map.get("src", "")
            if not src:
                self.errors.append("Every <img> needs a non-empty src")
            elif src.startswith("hubspot-image://"):
                key = src.removeprefix("hubspot-image://")
                if not IMAGE_KEY_RE.fullmatch(key):
                    self.errors.append(f"Invalid HubSpot image placeholder key: {key!r}")
                self.image_placeholders.append(key)
                self.image_placeholder_alts[key] = attr_map.get("alt", "")
            elif not (src.startswith("https://") or src.startswith("http://")):
                self.errors.append(f"Image src must be HTTPS or a hubspot-image placeholder: {src!r}")
            elif self.strict:
                self.errors.append("Local post images must use a hubspot-image placeholder")

        selected = [[name, attr_map[name]] for name in sorted(SELECTED_ATTRS.get(tag, set())) if name in attr_map]
        self.tokens.append(["start", tag, selected])
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in VOID_TAGS:
            self.errors.append(f"Void <{tag}> must not have a closing tag")
            return
        if not self.stack:
            self.errors.append(f"Unexpected closing </{tag}>")
        elif self.stack[-1] != tag:
            self.errors.append(f"Mismatched closing </{tag}>; expected </{self.stack[-1]}>")
            if tag in self.stack:
                while self.stack and self.stack[-1] != tag:
                    self.stack.pop()
                if self.stack:
                    self.stack.pop()
        else:
            self.stack.pop()
        self.tokens.append(["end", tag])

    def handle_data(self, data: str) -> None:
        text = normalized_text(data)
        if text:
            self.tokens.append(["text", text])
            self.words.extend(WORD_RE.findall(text))

    def handle_comment(self, data: str) -> None:
        if self.strict:
            self.errors.append("HTML comments do not belong in the HubSpot post body")

    def close(self) -> None:
        super().close()
        if self.stack:
            self.errors.append("Unclosed elements: " + ", ".join(f"<{tag}>" for tag in self.stack))


def audit_body(body: str, *, strict: bool = True) -> BodyAudit:
    audit = BodyAudit(strict=strict)
    audit.feed(body)
    audit.close()
    return audit


def body_fingerprint(body: str) -> str:
    audit = audit_body(body, strict=False)
    if audit.errors:
        raise PackageError("Cannot fingerprint malformed HTML: " + "; ".join(audit.errors))
    encoded = json.dumps(audit.tokens, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise PackageError(f"Missing required file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise PackageError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise PackageError(f"Expected a JSON object in {path}")
    return value


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def require_string(data: dict[str, Any], field: str) -> str:
    value = data.get(field)
    if not isinstance(value, str) or not value.strip():
        raise PackageError(f"publish.json field {field!r} must be a non-empty string")
    return value.strip()


def contained_file(package_dir: Path, relative: str, label: str) -> Path:
    candidate = (package_dir / relative).resolve()
    try:
        candidate.relative_to(package_dir.resolve())
    except ValueError as exc:
        raise PackageError(f"{label} escapes the post package: {relative}") from exc
    if not candidate.is_file():
        raise PackageError(f"Missing {label}: {candidate}")
    return candidate


@dataclass
class Package:
    directory: Path
    manifest_path: Path
    manifest: dict[str, Any]
    body: str
    audit: BodyAudit
    warnings: list[str]


def load_package(post_dir: str | Path, *, enforce_scope: bool = False) -> Package:
    directory = Path(post_dir).expanduser().resolve()
    if not directory.is_dir():
        raise PackageError(f"Post package directory does not exist: {directory}")
    if enforce_scope:
        try:
            directory.relative_to(POSTS_ROOT.resolve())
        except ValueError as exc:
            raise PackageError(f"Remote operations are limited to {POSTS_ROOT}") from exc

    manifest_path = directory / "publish.json"
    manifest = read_json(manifest_path)
    if manifest.get("schema_version") != 1:
        raise PackageError("publish.json schema_version must be 1")

    title = require_string(manifest, "title")
    html_title = require_string(manifest, "html_title")
    slug = require_string(manifest, "slug")
    summary = require_string(manifest, "post_summary")
    description = require_string(manifest, "meta_description")
    post_format = require_string(manifest, "format").lower()
    language = require_string(manifest, "language")
    if not SLUG_RE.fullmatch(slug):
        raise PackageError("slug must contain lowercase letters, digits and single hyphens only")
    if post_format not in FORMATS:
        raise PackageError(f"format must be one of: {', '.join(sorted(FORMATS))}")
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z0-9]+)?", language):
        raise PackageError(f"language is not a supported-looking language code: {language!r}")

    additional = manifest.get("additional_tag_ids", [])
    if not isinstance(additional, list) or any(not isinstance(value, (str, int)) for value in additional):
        raise PackageError("additional_tag_ids must be an array of HubSpot tag IDs")

    featured = manifest.get("featured_image")
    if not isinstance(featured, dict):
        raise PackageError("featured_image must be an object")
    featured_file = require_string(featured, "file")
    require_string(featured, "alt")
    featured_path = contained_file(directory, featured_file, "featured image")
    if featured_path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise PackageError("Featured image must be PNG, JPEG or WebP")

    inline = manifest.get("inline_images", [])
    if not isinstance(inline, list):
        raise PackageError("inline_images must be an array")
    inline_keys: list[str] = []
    for index, image in enumerate(inline):
        if not isinstance(image, dict):
            raise PackageError(f"inline_images[{index}] must be an object")
        key = require_string(image, "key")
        if not IMAGE_KEY_RE.fullmatch(key):
            raise PackageError(f"Invalid inline image key: {key!r}")
        inline_keys.append(key)
        inline_path = contained_file(directory, require_string(image, "file"), f"inline image {key}")
        if inline_path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            raise PackageError(f"Inline image {key!r} must be PNG, JPEG or WebP")
        if "alt" not in image or not isinstance(image["alt"], str):
            raise PackageError(f"inline image {key!r} needs an alt string, which may be empty")
    if len(set(inline_keys)) != len(inline_keys):
        raise PackageError("inline image keys must be unique")

    hubspot = manifest.get("hubspot")
    if not isinstance(hubspot, dict):
        raise PackageError("hubspot must be an object")

    body_path = directory / "post.html"
    try:
        body = body_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise PackageError(f"Missing required file: {body_path}") from exc
    audit = audit_body(body, strict=True)
    errors = list(audit.errors)
    if not normalized_text(body):
        errors.append("post.html is empty")
    for label in GENERATED_LABELS:
        if label.lower() in body.lower():
            errors.append(f"Do not type generated template label {label!r} into post.html")
    prose = "\n".join([title, html_title, summary, description, body])
    if "—" in prose or re.search(r"&mdash;|&#0*8212;|&#x0*2014;", prose, re.IGNORECASE):
        errors.append("Andrew's prose rules prohibit em dashes")
    placeholder_set = set(audit.image_placeholders)
    inline_set = set(inline_keys)
    missing_manifest = placeholder_set - inline_set
    unused_manifest = inline_set - placeholder_set
    if missing_manifest:
        errors.append("Image placeholders missing from publish.json: " + ", ".join(sorted(missing_manifest)))
    if unused_manifest:
        errors.append("Inline images not used in post.html: " + ", ".join(sorted(unused_manifest)))
    for key in inline_keys:
        if audit.image_placeholders.count(key) != 1:
            errors.append(f"Inline image placeholder {key!r} must appear exactly once")
        image = next(item for item in inline if item["key"] == key)
        if audit.image_placeholder_alts.get(key) != image["alt"]:
            errors.append(f"Inline image alt text differs between post.html and publish.json: {key!r}")
    if post_format == "note" and len(audit.words) > 400:
        errors.append(f"A Note must stay under 400 words; found {len(audit.words)}")
    if errors:
        raise PackageError("Package validation failed:\n- " + "\n- ".join(errors))

    warnings: list[str] = []
    if len(description) < 100 or len(description) > 170:
        warnings.append(f"Meta description is {len(description)} characters; review its search-result fit")
    if len(summary) > 220:
        warnings.append(f"Post summary is {len(summary)} characters; review the index-card fit")
    if len(audit.words) < 120 and post_format != "note":
        warnings.append(f"Body is only {len(audit.words)} words for a {post_format}")

    return Package(directory, manifest_path, manifest, body, audit, warnings)


def load_config(*, require_ready: bool) -> dict[str, Any]:
    config = read_json(CONFIG_PATH)
    require_string(config, "account")
    require_string(config, "api_version")
    require_string(config, "image_folder")
    tags = config.get("format_tag_ids")
    if not isinstance(tags, dict) or set(tags) != FORMATS:
        raise PackageError("hubspot.json format_tag_ids must define the four Managing Better formats")
    if require_ready:
        if not config.get("content_group_id"):
            raise PackageError("hubspot.json content_group_id is not configured; run discover first")
        if not config.get("blog_author_id"):
            raise PackageError("hubspot.json blog_author_id is not configured; run discover first")
        missing = [name for name in sorted(FORMATS) if not tags.get(name)]
        if missing:
            raise PackageError("hubspot.json is missing format tag IDs: " + ", ".join(missing))
    return config


def hs_binary() -> Path:
    pinned = REPO_ROOT / "website" / "node_modules" / ".bin" / "hs"
    if pinned.is_file() and os.access(pinned, os.X_OK):
        return pinned
    system = shutil.which("hs")
    if system:
        return Path(system)
    raise PackageError("HubSpot CLI is not installed; install website dependencies first")


def sanitize_output(value: str) -> str:
    return re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", value, flags=re.IGNORECASE).strip()


def run_hs(arguments: list[str], *, expect_json: bool) -> Any:
    command = [str(hs_binary()), *arguments]
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        detail = sanitize_output(completed.stderr or completed.stdout)
        raise RemoteError(detail or f"HubSpot CLI exited with {completed.returncode}")
    if not expect_json:
        return sanitize_output(completed.stdout)
    output = completed.stdout.strip()
    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        # The CLI can prepend a non-JSON notice. Locate the first complete-looking JSON value.
        starts = [index for index in (output.find("{"), output.find("[")) if index >= 0]
        if starts:
            try:
                return json.loads(output[min(starts):])
            except json.JSONDecodeError:
                pass
        raise RemoteError(f"HubSpot CLI returned non-JSON output: {sanitize_output(output)}") from exc


def run_api(config: dict[str, Any], endpoint: str, *, method: str = "GET", data: dict[str, Any] | None = None) -> Any:
    arguments = ["api", endpoint, "--account", str(config["account"]), "--json", "--method", method]
    if data is not None:
        arguments.extend(["--data", json.dumps(data, ensure_ascii=False, separators=(",", ":"))])
    return run_hs(arguments, expect_json=True)


def results(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict) and isinstance(value.get("results"), list):
        return [item for item in value["results"] if isinstance(item, dict)]
    return []


def discover(config: dict[str, Any]) -> dict[str, Any]:
    version = config["api_version"]
    return {
        "blogs": [
            {key: item.get(key) for key in ("id", "name", "publicTitle", "slug", "absoluteUrl", "language")}
            for item in results(run_api(config, f"/cms/blog-settings/{version}/settings?limit=100"))
        ],
        "authors": [
            {key: item.get(key) for key in ("id", "fullName", "displayName", "name", "slug", "language")}
            for item in results(run_api(config, f"/cms/blogs/{version}/authors?limit=100"))
        ],
        "tags": [
            {key: item.get(key) for key in ("id", "name", "slug", "language")}
            for item in results(run_api(config, f"/cms/blogs/{version}/tags?limit=100"))
        ],
    }


def md5_file(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def search_file(config: dict[str, Any], remote_path: str) -> dict[str, Any] | None:
    version = config["api_version"]
    query = urlencode({"path": remote_path, "limit": 100})
    matches = results(run_api(config, f"/files/{version}/files/search?{query}"))
    exact = [item for item in matches if str(item.get("path", "")).lstrip("/") == remote_path.lstrip("/")]
    if len(exact) > 1:
        raise RemoteError(f"HubSpot returned multiple files for exact path {remote_path!r}")
    return exact[0] if exact else None


def upload_one_image(package: Package, config: dict[str, Any], image: dict[str, Any]) -> None:
    local = contained_file(package.directory, require_string(image, "file"), "image")
    digest = md5_file(local)
    remote_path = "/".join(
        [str(config["image_folder"]).rstrip("/"), package.manifest["slug"], local.name]
    )
    existing = search_file(config, remote_path)
    if existing:
        remote_digest = str(existing.get("fileMd5") or "").lower()
        if remote_digest and remote_digest != digest.lower():
            raise RemoteError(
                f"Remote image {remote_path} differs from the local file. Use a new filename or reconcile it."
            )
    else:
        run_hs(
            [
                "filemanager", "upload", str(local.relative_to(REPO_ROOT)), remote_path,
                "--account", str(config["account"]),
            ],
            expect_json=False,
        )
        existing = search_file(config, remote_path)
        if not existing:
            raise RemoteError(f"Uploaded {remote_path}, but HubSpot file search could not find it")
        remote_digest = str(existing.get("fileMd5") or "").lower()
        if remote_digest and remote_digest != digest.lower():
            raise RemoteError(f"HubSpot file checksum does not match after upload: {remote_path}")

    url = existing.get("url") or existing.get("defaultHostingUrl")
    if not isinstance(url, str) or not url.startswith("http"):
        raise RemoteError(f"HubSpot file has no usable public URL: {remote_path}")
    image["hubspot_url"] = url
    image["hubspot_path"] = remote_path
    image["hubspot_file_md5"] = digest
    write_json_atomic(package.manifest_path, package.manifest)


def upload_images(package: Package, config: dict[str, Any]) -> None:
    upload_one_image(package, config, package.manifest["featured_image"])
    for image in package.manifest.get("inline_images", []):
        upload_one_image(package, config, image)


def resolved_body(package: Package) -> str:
    body = package.body
    for image in package.manifest.get("inline_images", []):
        url = image.get("hubspot_url")
        if not isinstance(url, str) or not url.startswith("http"):
            raise PackageError(f"Inline image {image.get('key')!r} has not been uploaded")
        body = body.replace(f"hubspot-image://{image['key']}", url)
    if "hubspot-image://" in body:
        raise PackageError("Unresolved HubSpot image placeholder remains in post.html")
    return body


def tag_ids(package: Package, config: dict[str, Any]) -> list[int | str]:
    values: list[int | str] = [config["format_tag_ids"][package.manifest["format"]]]
    values.extend(package.manifest.get("additional_tag_ids", []))
    return list(dict.fromkeys(values))


def expected_payload(package: Package, config: dict[str, Any], body: str) -> dict[str, Any]:
    featured = package.manifest["featured_image"]
    url = featured.get("hubspot_url")
    if not isinstance(url, str) or not url.startswith("http"):
        raise PackageError("Featured image has not been uploaded")
    return {
        "name": package.manifest["title"],
        "htmlTitle": package.manifest["html_title"],
        "slug": package.manifest["slug"],
        "contentGroupId": str(config["content_group_id"]),
        "blogAuthorId": str(config["blog_author_id"]),
        "metaDescription": package.manifest["meta_description"],
        "useFeaturedImage": True,
        "featuredImage": url,
        "featuredImageAltText": featured["alt"],
        "postBody": body,
        "postSummary": package.manifest["post_summary"],
        "tagIds": tag_ids(package, config),
        "language": package.manifest["language"],
    }


def canonical_remote(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": value.get("name"),
        "htmlTitle": value.get("htmlTitle"),
        "slug": value.get("slug"),
        "contentGroupId": str(value.get("contentGroupId") or ""),
        "blogAuthorId": str(value.get("blogAuthorId") or ""),
        "metaDescription": value.get("metaDescription"),
        "useFeaturedImage": bool(value.get("useFeaturedImage")),
        "featuredImage": value.get("featuredImage"),
        "featuredImageAltText": value.get("featuredImageAltText"),
        "postBodyFingerprint": body_fingerprint(str(value.get("postBody") or "")),
        "postSummary": value.get("postSummary"),
        "tagIds": sorted(str(item) for item in (value.get("tagIds") or [])),
        "language": value.get("language"),
    }


def canonical_expected(payload: dict[str, Any]) -> dict[str, Any]:
    value = dict(payload)
    value["postBodyFingerprint"] = body_fingerprint(str(value.pop("postBody")))
    value["contentGroupId"] = str(value["contentGroupId"])
    value["blogAuthorId"] = str(value["blogAuthorId"])
    value["tagIds"] = sorted(str(item) for item in value["tagIds"])
    return value


def record_fingerprint(canonical: dict[str, Any]) -> str:
    encoded = json.dumps(canonical, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def post_endpoint(config: dict[str, Any], suffix: str = "") -> str:
    return f"/cms/blogs/{config['api_version']}/posts{suffix}"


def search_slug(config: dict[str, Any], slug: str) -> list[dict[str, Any]]:
    query = urlencode({"slug__eq": slug, "limit": 100})
    values = results(run_api(config, post_endpoint(config, f"?{query}")))
    return [item for item in values if item.get("slug") == slug]


def get_draft(config: dict[str, Any], post_id: str) -> dict[str, Any]:
    value = run_api(config, post_endpoint(config, f"/{post_id}/draft"))
    if not isinstance(value, dict):
        raise RemoteError(f"HubSpot returned an invalid draft for post {post_id}")
    return value


def get_live_state(config: dict[str, Any], post_id: str) -> dict[str, Any]:
    value = run_api(config, post_endpoint(config, f"/{post_id}"))
    if not isinstance(value, dict):
        raise RemoteError(f"HubSpot returned an invalid post for {post_id}")
    return value


def verify_remote(package: Package, config: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    hubspot = package.manifest["hubspot"]
    post_id = hubspot.get("post_id")
    if not post_id:
        raise PackageError("publish.json has no HubSpot post ID")
    remote = get_draft(config, str(post_id))
    actual = canonical_remote(remote)
    expected = canonical_expected(payload)
    mismatches = [key for key in expected if actual.get(key) != expected.get(key)]
    if mismatches:
        raise RemoteError("Remote draft differs in: " + ", ".join(sorted(mismatches)))

    fingerprint = record_fingerprint(actual)
    hubspot["post_id"] = str(remote.get("id") or post_id)
    hubspot["url"] = remote.get("url") or hubspot.get("url")
    hubspot["last_state"] = remote.get("currentState") or remote.get("state") or "DRAFT"
    hubspot["last_remote_fingerprint"] = fingerprint
    hubspot["last_verified_at"] = datetime.now(timezone.utc).isoformat()
    write_json_atomic(package.manifest_path, package.manifest)
    return remote


def detect_remote_drift(package: Package, config: dict[str, Any]) -> None:
    hubspot = package.manifest["hubspot"]
    post_id = hubspot.get("post_id")
    if not post_id:
        return
    recorded = hubspot.get("last_remote_fingerprint")
    if not recorded:
        raise RemoteError(
            "This package has a HubSpot post ID but no recorded remote fingerprint. Inspect and adopt it manually."
        )
    current = record_fingerprint(canonical_remote(get_draft(config, str(post_id))))
    if current != recorded:
        raise RemoteError("HubSpot draft changed since the last verified push; reconcile remote drift first")


def require_confirmation(package: Package, value: str | None) -> None:
    if value != package.manifest["slug"]:
        raise PackageError(f"Confirmation must exactly match slug {package.manifest['slug']!r}")


def push_draft(package: Package, config: dict[str, Any], confirmation: str | None) -> dict[str, Any]:
    require_confirmation(package, confirmation)
    detect_remote_drift(package, config)
    upload_images(package, config)
    body = resolved_body(package)
    payload = expected_payload(package, config, body)
    hubspot = package.manifest["hubspot"]
    post_id = hubspot.get("post_id")

    if post_id:
        run_api(config, post_endpoint(config, f"/{post_id}/draft"), method="PATCH", data=payload)
    else:
        collisions = search_slug(config, package.manifest["slug"])
        if collisions:
            ids = ", ".join(str(item.get("id")) for item in collisions)
            raise RemoteError(f"Slug already exists in HubSpot on post(s): {ids}. Do not auto-adopt it.")
        try:
            created = run_api(config, post_endpoint(config), method="POST", data=payload)
        except RemoteError as exc:
            # One ambiguity check, never a second create.
            collisions = search_slug(config, package.manifest["slug"])
            if len(collisions) != 1 or not collisions[0].get("id"):
                raise RemoteError(f"Create failed and no unique matching slug was found: {exc}") from exc
            candidate = get_draft(config, str(collisions[0]["id"]))
            if canonical_remote(candidate) != canonical_expected(payload):
                raise RemoteError("Create failed ambiguously and the slug match does not equal the local package") from exc
            created = candidate
        if not isinstance(created, dict) or not created.get("id"):
            raise RemoteError("HubSpot create response did not include a post ID")
        hubspot["post_id"] = str(created["id"])
        hubspot["url"] = created.get("url")
        write_json_atomic(package.manifest_path, package.manifest)

    return verify_remote(package, config, payload)


def verify_command(package: Package, config: dict[str, Any]) -> dict[str, Any]:
    payload = expected_payload(package, config, resolved_body(package))
    return verify_remote(package, config, payload)


def publish_command(package: Package, config: dict[str, Any], confirmation: str | None) -> dict[str, Any]:
    require_confirmation(package, confirmation)
    verify_command(package, config)
    post_id = str(package.manifest["hubspot"]["post_id"])
    live = get_live_state(config, post_id)
    if live.get("currentlyPublished"):
        run_api(config, post_endpoint(config, f"/{post_id}/draft/push-live"), method="POST")
    else:
        run_api(config, post_endpoint(config, f"/{post_id}"), method="PATCH", data={"state": "PUBLISHED"})
    final = get_live_state(config, post_id)
    state = final.get("currentState") or final.get("state")
    if not final.get("currentlyPublished") and state not in {"PUBLISHED", "PUBLISHED_OR_SCHEDULED"}:
        raise RemoteError(f"HubSpot did not report the post as published; current state is {state!r}")
    hubspot = package.manifest["hubspot"]
    hubspot["url"] = final.get("url") or hubspot.get("url")
    hubspot["last_state"] = state or "PUBLISHED"
    hubspot["scheduled_for"] = None
    write_json_atomic(package.manifest_path, package.manifest)
    return final


def parse_schedule(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise PackageError("Schedule must be an ISO 8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise PackageError("Schedule timestamp must include an explicit UTC offset")
    if parsed.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise PackageError("Schedule timestamp must be in the future")
    return parsed


def schedule_command(
    package: Package,
    config: dict[str, Any],
    confirmation: str | None,
    schedule_at: str,
) -> dict[str, Any]:
    require_confirmation(package, confirmation)
    parsed = parse_schedule(schedule_at)
    verify_command(package, config)
    post_id = str(package.manifest["hubspot"]["post_id"])
    value = run_api(
        config,
        post_endpoint(config, "/schedule"),
        method="POST",
        data={"id": post_id, "publishDate": parsed.isoformat()},
    )
    final = get_live_state(config, post_id)
    state = final.get("currentState") or final.get("state") or "SCHEDULED"
    hubspot = package.manifest["hubspot"]
    hubspot["url"] = final.get("url") or hubspot.get("url")
    hubspot["last_state"] = state
    hubspot["scheduled_for"] = parsed.isoformat()
    write_json_atomic(package.manifest_path, package.manifest)
    return value if isinstance(value, dict) else final


def print_validation(package: Package) -> None:
    print(f"Valid package: {package.manifest['slug']}")
    print(f"Format: {package.manifest['format']}")
    print(f"Body words: {len(package.audit.words)}")
    print(f"Inline images: {len(package.manifest.get('inline_images', []))}")
    for warning in package.warnings:
        print(f"Warning: {warning}")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("discover", help="List non-secret HubSpot blog, author, and tag IDs")

    for name, help_text in (
        ("validate", "Validate a local post package"),
        ("verify", "Compare the recorded HubSpot draft with the local package"),
        ("status", "Show the recorded post's safe remote state"),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("post_dir")

    push = commands.add_parser("push-draft", help="Create or update a HubSpot draft")
    push.add_argument("post_dir")
    push.add_argument("--confirm-slug", required=True)

    images = commands.add_parser(
        "upload-images",
        help="Upload package images for a HubSpot editor fallback without using the blog API",
    )
    images.add_argument("post_dir")
    images.add_argument("--confirm-slug", required=True)

    publish = commands.add_parser("publish", help="Publish a verified draft")
    publish.add_argument("post_dir")
    publish.add_argument("--confirm-slug", required=True)

    schedule = commands.add_parser("schedule", help="Schedule a verified draft")
    schedule.add_argument("post_dir")
    schedule.add_argument("--at", required=True)
    schedule.add_argument("--confirm-slug", required=True)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "discover":
            print(json.dumps(discover(load_config(require_ready=False)), indent=2, ensure_ascii=False))
            return 0

        package = load_package(args.post_dir, enforce_scope=args.command != "validate")
        if args.command == "validate":
            print_validation(package)
            return 0

        config = load_config(require_ready=args.command != "upload-images")
        if args.command == "upload-images":
            require_confirmation(package, args.confirm_slug)
            upload_images(package, config)
            featured = package.manifest["featured_image"]
            print(f"HubSpot images uploaded: {featured.get('hubspot_url')}")
        elif args.command == "push-draft":
            remote = push_draft(package, config, args.confirm_slug)
            print(f"HubSpot draft verified: {remote.get('id')} {remote.get('url') or ''}".rstrip())
        elif args.command == "verify":
            remote = verify_command(package, config)
            print(f"HubSpot draft matches local package: {remote.get('id')}")
        elif args.command == "publish":
            remote = publish_command(package, config, args.confirm_slug)
            print(f"Published: {remote.get('url') or remote.get('id')}")
        elif args.command == "schedule":
            schedule_command(package, config, args.confirm_slug, args.at)
            print(f"Scheduled {package.manifest['slug']} for {package.manifest['hubspot']['scheduled_for']}")
        elif args.command == "status":
            post_id = package.manifest["hubspot"].get("post_id")
            if not post_id:
                raise PackageError("publish.json has no HubSpot post ID")
            remote = get_live_state(config, str(post_id))
            safe = {key: remote.get(key) for key in ("id", "name", "slug", "url", "currentState", "currentlyPublished", "publishDate")}
            print(json.dumps(safe, indent=2, ensure_ascii=False))
        return 0
    except (PackageError, RemoteError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
