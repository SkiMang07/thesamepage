---
name: managing-better-writer
description: Turn Andrew's ideas into researched, on-brand Managing Better blog posts, complete with HubSpot-safe HTML, SEO and AI-answer metadata, source checks, and editorial images. Use for planning, drafting, revising, packaging, or reviewing a Managing Better post; do not publish to HubSpot.
---

# Managing Better Writer

Create a post that retains Andrew's substance and voice while arriving as a complete,
reviewable publishing package.

## Start with current truth

Read `gtm/managing-better/editorial-system.md` in full. Then read the canonical
sources it routes to for the current stage. At minimum, read
`gtm/brand/voice-rules.md` before drafting. Do not copy those sources into the skill
or substitute prior generated copy for them.

Read [references/post-package.md](references/post-package.md) when creating or
updating post files. Read [references/search-and-answer-review.md](references/search-and-answer-review.md)
before research or final SEO review. Read [references/editorial-review.md](references/editorial-review.md)
and [references/voice-fidelity.md](references/voice-fidelity.md) before drafting,
revising or presenting a draft as approved-ready.

## Work from Andrew's material

Andrew may supply an unstructured spoken idea dump. Find the real assertion, the
reader's situation, the experience or evidence underneath it, and the useful change
for the reader. Preserve concrete phrases and reasoning that sound like him. Ask only
for a missing fact that would materially change the piece.

Never invent a first-person story, customer outcome, quotation, statistic or product
capability. Mark unresolved claims outside the article. A thin source brief remains
thin; do not disguise it with generic management advice.

## Produce and revise

Research current search intent and factual claims before drafting. Use primary
sources where possible and keep a source map in `brief.md`. Choose exactly one of
Playbook, Teardown, Script or Note based on the piece's actual shape.

Draft body-only semantic HTML to the structural contract in the editorial system.
Create the human publishing card and machine manifest at the same time, so the title,
summary, description, slug, tags, links, images and body cannot drift independently.

Generate one featured image after the thesis is stable. Read
`gtm/managing-better/image-direction.md` and `docs/systems/brand.md` first. Use the
available image-generation capability when present, inspect the result, and iterate
until it follows the approved direction and survives the shared 16:9 crop. The
featured image belongs in `images/` and `publish.json`, never in `post.html`; the
shared theme renders it below the byline and on listing and related-post cards. Add
an inline image only when it explains a relationship prose handles poorly. Write alt
text from the final image, not the prompt. If image generation is unavailable,
deliver an art brief and leave the post unapproved rather than pretending an image
exists.

Run the editorial, source, search, HTML, accessibility and image reviews before
asking Andrew to approve the package. Treat Andrew's requested edits as changes to
all affected package files, not only the visible prose.

Compare the finished prose with Andrew's original material, not only the summarized
brief. Run `python3 scripts/voice_lint.py <path-to-post.html>` and review every warning
against the source. The script flags cadence patterns; it neither detects AI nor
replaces the source comparison. Record the voice-fidelity result in the publishing
card.

## Approval and handoff

Keep the post in `in review` until Andrew explicitly approves it. Approval means the
copy, metadata, links, source treatment and final images are all accepted.

This skill never calls HubSpot. If Andrew asks to push, preview, schedule or publish
an approved package, use `$managing-better-publisher`. Copy approval alone is not
authorization to create a remote draft.
