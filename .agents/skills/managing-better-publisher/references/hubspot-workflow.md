# HubSpot workflow

Run commands from the repository root. The script finds the pinned CLI under
`website/node_modules/.bin/hs` and passes `--account tsp-hubspot` from
`gtm/managing-better/hubspot.json`.

## Local validation

```bash
python3 .agents/skills/managing-better-publisher/scripts/hubspot_blog.py validate \
  gtm/managing-better/posts/<slug>
```

This is local and non-mutating. Fix every error before requesting approval to push.

## Account discovery

```bash
python3 .agents/skills/managing-better-publisher/scripts/hubspot_blog.py discover
```

Discovery performs authenticated GET requests for blogs, authors and tags and prints
only non-secret IDs and labels. It does not change `hubspot.json`. Populate that file
only after confirming the intended objects. Missing tags, authors or blog settings
are bootstrap work and need separate authorization.

## Push or update a draft

After explicit authorization:

```bash
python3 .agents/skills/managing-better-publisher/scripts/hubspot_blog.py push-draft \
  gtm/managing-better/posts/<slug> --confirm-slug <slug>
```

The script validates the package, safely reuses or uploads images, checks for a slug
collision, creates a draft or updates only the recorded post's draft, fetches it back,
and records remote identity and semantic fingerprint in `publish.json`.

### Content Hub Starter fallback

HubSpot's blog-post API requires the `content` scope, which is not available on
Content Hub Starter. On this plan, use the authenticated HubSpot editor's Advanced →
source-code view for the body and the Settings panel for post fields. Upload package
images deterministically before selecting them in the editor:

```bash
python3 .agents/skills/managing-better-publisher/scripts/hubspot_blog.py upload-images \
  gtm/managing-better/posts/<slug> --confirm-slug <slug>
```

This command needs only the account and image-folder values in `hubspot.json`; blog,
author and tag IDs may remain unset. It records the uploaded image URL, path and
checksum in `publish.json`. The editor draft remains the review surface and must be
visually verified there. Browser automation does not change the authorization gates:
creating or changing a draft still requires explicit approval, and publish or schedule
remain separate actions.

In the editor, enable the native featured image, select the file recorded at
`featured_image.hubspot_url` and copy `featured_image.alt` into its alt-text field
exactly. Do not insert the featured image into the rich-text body. The shared theme
owns its placement below the byline and on listing and related-post cards. Confirm
the saved draft still has the native featured image enabled before visual review.

In the editor, put `post_summary` in the first paragraph, insert HubSpot's native
**Read more separator** immediately after it, and then append `post.html`. The Starter
post template checks whether `post_body` already contains the saved summary text and,
if so, does not render `content.post_summary` a second time. Posts whose body does not
contain its saved summary keep the standalone lede.

If a create request fails ambiguously, the script checks the slug once. It never sends
a second create automatically. If a local package has a post ID but no recorded
remote fingerprint, stop and inspect before adopting it.

## Verify

```bash
python3 .agents/skills/managing-better-publisher/scripts/hubspot_blog.py verify \
  gtm/managing-better/posts/<slug>
```

This compares the remote draft's important fields and semantic body fingerprint to
the resolved local package. Then follow `remote-verification.md` for visual preview,
including Full Post View on desktop and phone and Main List View. When related posts
are present, check one of those cards too.

## Publish now

After the remote draft is semantically and visually verified and the user explicitly
authorizes publication:

```bash
python3 .agents/skills/managing-better-publisher/scripts/hubspot_blog.py publish \
  gtm/managing-better/posts/<slug> --confirm-slug <slug>
```

For a new draft, the script publishes it. For an already-live post, it pushes the
verified draft version live.

## Schedule

Use an ISO 8601 timestamp with an explicit UTC offset:

```bash
python3 .agents/skills/managing-better-publisher/scripts/hubspot_blog.py schedule \
  gtm/managing-better/posts/<slug> \
  --at 2026-10-06T09:00:00-04:00 \
  --confirm-slug <slug>
```

Never translate an `L+` slot into a date without Andrew's confirmed launch date.

## API surface

The deterministic script is intentionally limited to:

- blog settings, authors and tags GET discovery;
- file search and upload through the authenticated CLI;
- blog-post search, create, draft update, draft GET and live-state GET;
- publish draft, push draft live and schedule.

There is no delete, unpublish, archive, revision restore, settings update, author
creation or tag creation command.
