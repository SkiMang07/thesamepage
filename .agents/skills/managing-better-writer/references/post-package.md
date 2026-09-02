# Post package

Create one directory at `gtm/managing-better/posts/<slug>/`. The slug is stable once a
remote draft exists. Renaming a local folder does not authorize changing a live URL.

## `brief.md`

Record only the material another drafting pass cannot recover cheaply:

- reader situation and primary search intent;
- Andrew's thesis in plain language;
- raw phrases, examples and personal experiences supplied by Andrew;
- primary messaging pillar and relevant trigger moment;
- source map separating fact, Andrew's experience and The Same Page's assertion;
- competing coverage and the piece's original contribution;
- open factual or product-truth questions;
- related existing or planned posts.

Do not turn the brief into a duplicate draft.

## `post.html`

Write the body only. HubSpot supplies the H1, post summary, author, date and template
CTA. Use only these elements unless the live template's contract changes:

`p`, `h2`, `h3`, `blockquote`, `ul`, `ol`, `li`, `pre`, `code`, `a`, `strong`,
`em`, `img`, `hr`, `br`.

No classes, IDs, inline styles, layout containers, H1, script, iframe or embedded
structured data. Use explicit closing tags. A generated label is never typed into
the body.

For an inline image, use a stable placeholder as its `src`:

```html
<img src="hubspot-image://decision-sequence" alt="Three records moving from open to agreed">
```

The placeholder key must match an entry in `publish.json`. The publisher replaces it
with the uploaded HubSpot URL before creating the remote draft.

## `publishing-card.md`

This is the human review surface. Include:

- status and intended launch slot or absolute publication date;
- title, HTML title, slug, post summary and meta description;
- kind and any additional tags;
- primary query, intent and nearby questions;
- proposed internal links and verified external sources;
- featured and inline image previews, roles and alt text;
- claims to confirm, if any;
- completed review checks;
- after remote work: HubSpot ID, preview/live URL, state and last verification time.

Never mark a check complete unless it was actually performed.

## `publish.json`

Use this schema. JSON contains no comments and no credentials.

```json
{
  "schema_version": 1,
  "title": "Visible post title",
  "html_title": "Search title",
  "slug": "stable-url-slug",
  "post_summary": "Listing lede.",
  "meta_description": "Accurate search description.",
  "format": "playbook",
  "language": "en",
  "additional_tag_ids": [],
  "featured_image": {
    "file": "images/featured.png",
    "alt": "Meaningful description of the final image",
    "hubspot_url": null
  },
  "inline_images": [],
  "hubspot": {
    "post_id": null,
    "url": null,
    "last_state": null,
    "last_remote_fingerprint": null,
    "last_verified_at": null,
    "scheduled_for": null
  }
}
```

An inline image entry adds a unique `key`, for example:

```json
{
  "key": "decision-sequence",
  "file": "images/decision-sequence.png",
  "alt": "Three records moving from open to agreed",
  "hubspot_url": null
}
```

The publisher owns fields inside `hubspot` and the `hubspot_url` fields after remote
work begins. The writer may update their human-readable counterparts but must not
erase remote identity or verification state.
