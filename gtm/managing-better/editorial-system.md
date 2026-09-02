# Managing Better — editorial system

The operating system for The Same Page's blog. **Managing Better** is the
publication name. The existing Playbook, Teardown, Script and Note system remains
the way a reader knows what shape a piece will take.

This folder owns the editorial record. HubSpot is the delivery system. The approved
local package is the source of truth for a post, and a later HubSpot edit must be
reconciled rather than silently overwritten.

## The launch inventory

The working interpretation is **ten posts live at launch and five more queued at a
weekly cadence**. Until the launch date is fixed, scheduled pieces use relative slots
(`L+7`, `L+14`, and so on) rather than invented calendar dates. If the intended
cadence is five posts every week, revise the plan before production begins.

Late September points the opening catalogue toward review season. Acquisition leads
with the work a manager has to do on a date, then connects that pain to the record
they needed earlier in the year. The initial mix lives in `launch-plan.md`; candidate
ideas and their evidence state live in `backlog.md`.

## Sources that bind every post

Read only the sources needed for the current stage, but never replace them with a
copied summary inside a skill:

- `gtm/personas/new-manager.md` — who the reader is and the words they use.
- `gtm/brand/point-of-view.md` — the public argument and its concessions.
- `gtm/brand/messaging.md` — the three pillars and what is actually shipped.
- `gtm/brand/voice-rules.md` — Andrew's prose rules and the blog register.
- `gtm/business-model.md` → Content & SEO strategy — the acquisition role.
- `gtm/site/blog.md` — the four kinds and the structural authoring contract.
- `website/docs/build-process.md` → The blog — what HubSpot preserves.
- `docs/systems/brand.md` and `image-direction.md` — image palette and hand.

Andrew's spoken brief is a source too. Preserve its concrete examples, reasoning and
distinctive phrases. Never invent a first-person experience, customer result, number,
quotation, or belief to make a draft feel finished. Put unresolved claims in the
publishing card instead of smoothing over them in the post.

## From idea to approved package

### Brief

Andrew can begin with an unstructured idea dump. Extract the reader's situation, the
question they arrived with, Andrew's answer, the evidence or experience underneath
it, and what the reader should leave able to do. Ask only for a missing fact that
would materially change the argument. Do not force an outline before the substance
is understood.

Research current search intent before drafting. Record the primary query, nearby
questions, competing coverage, and any opportunity for a more specific or original
answer. Prefer primary sources for factual claims. Separate sourced fact, Andrew's
experience, and The Same Page's point of view.

### Draft

Every piece is exactly one kind:

| Kind | Use it for | Shape |
|---|---|---|
| **Playbook** | A sequence run start to finish | Substantial, practical, usually numbered H3 steps |
| **Teardown** | A real artefact, conversation or decision taken apart | Show the object, then explain what each part does |
| **Script** | Words a manager can adapt while keeping the order | Script blocks do most of the work |
| **Note** | One useful rule or observation | Under 400 words, no padded sections |

The title and opening earn the search intent without reading like an SEO template.
Answer the central question early enough that a reader can tell the piece will help.
Use specific examples, decisions and language that could be quoted without the rest
of the post. Lists, tables and question headings appear only when they improve the
reader's understanding.

The HubSpot body is semantic HTML, not Markdown and not a standalone page. The theme
adds the title, lede, byline and closing bands. The body contract is:

- `<blockquote><ul>...</ul></blockquote>` becomes **What you leave with**.
- `<pre>` becomes **Say it like this**.
- `<h3>` becomes an automatically numbered step. Never type the numeral.
- A blockquote without a list is a pull quote.
- No classes, inline styles, scripts, embedded schema, H1 or layout divs.

### Review

Review the argument before polishing sentences. Then run separate passes for:

- voice and prohibited language;
- factual support and source quality;
- search intent, title, slug, summary, meta description and internal links;
- passage-level clarity for both human readers and AI answer systems;
- structural HTML and accessibility;
- image relevance, crop safety and alt text;
- claims about product behavior against current shipped truth.

Do not optimize for an AI-detector score. Source fidelity is the test: the experiences
came from Andrew, the argument matches his reasoning, and the prose follows the voice
system without generic generated-writing patterns.

### Approval

An approved package contains:

```text
posts/<slug>/
  brief.md             intent, source map, raw Andrew material, open questions
  post.html            body-only semantic HTML for HubSpot
  publishing-card.md   human-readable fields, links, sources, checks and status
  publish.json         machine-readable HubSpot manifest; never credentials
  images/              final featured image and any justified inline image
```

Copy approval does not authorize a HubSpot write. The user must explicitly authorize
pushing the approved package as a remote draft. Publishing or scheduling requires a
separate explicit instruction after the remote draft has been verified, unless the
user clearly authorizes both stages and supplies the final date in the same request.

## HubSpot boundary

`gtm/managing-better/hubspot.json` holds non-secret account and object identifiers.
Credentials stay only in `~/.hscli/config.yml`. The publisher uses the installed
HubSpot CLI with `--account tsp-hubspot`; it never asks for, reads aloud or stores the
personal access key.

The remote workflow is draft first. On Professional or Enterprise, the authenticated
API path can perform the whole sequence. Content Hub Starter does not expose the
`content` scope required by the blog-post API, so Starter uses the HubSpot editor's
source-code view plus deterministic image upload through the CLI:

1. Validate the local package.
2. Confirm the configured blog, author, format tag and slug do not conflict.
3. Upload images to the Managing Better file folder.
4. Create a new draft or update only the draft version of the recorded post, through
   the API when the account tier allows it or through the HubSpot editor on Starter;
   attach the uploaded featured image and approved alt text through HubSpot's native
   featured-image fields, never by adding it to the body.
5. Fetch the draft and compare fields plus a semantic HTML fingerprint.
6. Preview the real HubSpot rendering on desktop and phone, including the full post,
   its main listing card and a related-post card when one is present.
7. With explicit authorization, publish now or schedule an absolute ISO timestamp.
8. Record the HubSpot ID, URL, state, verification fingerprint and schedule locally.

Never delete, unpublish, restore a revision, overwrite detected remote drift, or
create missing account-level objects as an implied part of publishing. Stop and ask.

## Current setup state

The blog templates already exist. The Managing Better blog, Andrew author and four
format tags have been confirmed in the live editor. Their API IDs remain unset in
`hubspot.json` because Content Hub Starter does not expose the discovery endpoints.
That does not block the editor fallback or image upload. If the account moves to a
tier with the `content` scope, run one discovery pass and save the IDs before using
API draft delivery.

On Starter, the editor owns the summary split: `post_summary` is the first paragraph,
followed by HubSpot's Read more separator, followed by `post.html`. The post template
suppresses its standalone lede when `post_body` already contains the saved summary,
so the summary appears once on the full post while remaining available to the listing
card.
