---
name: managing-better-publisher
description: Validate an approved Managing Better package, create or update its HubSpot draft, verify remote structure and rendering, and publish or schedule it after explicit authorization. Use for HubSpot blog delivery; do not draft posts or upload theme templates.
---

# Managing Better Publisher

Move an approved local package into HubSpot without clipboard sanitization, duplicate
posts or silent remote overwrite.

## Required context

Read `gtm/managing-better/editorial-system.md`, `website/docs/security.md` and
[references/hubspot-workflow.md](references/hubspot-workflow.md) before any remote
operation. Read [references/remote-verification.md](references/remote-verification.md)
before declaring a draft verified.

Use `scripts/hubspot_blog.py` for validation, API operations and deterministic image
upload. Do not reconstruct its requests by hand. The script reuses the configured
HubSpot CLI account and never handles the personal access key directly. If the portal
is on Content Hub Starter and the blog API rejects the required `content` scope, use
the authenticated editor fallback in `references/hubspot-workflow.md`; do not retry
the unavailable API path.

Every pushed post must use HubSpot's native featured-image field. Attach the uploaded
featured file, copy its approved alt text exactly and keep it out of the rich-text
body. A remote draft is not verified until that image has been checked below the
byline, on the main listing card and, when the surface is populated, on a related-post
card.

## Final human-authorship gate

Treat a source-fidelity review as part of publishing, even when Andrew does not ask
for it separately. Before the first HubSpot draft push, and again immediately before
publishing or scheduling, confirm that `publishing-card.md` records a completed
`Final human-authorship pass` performed after the latest post or summary edit. If the
timing is unclear, the check is missing or copy changed after it, use
`$managing-better-writer` and read its
[editorial review](../managing-better-writer/references/editorial-review.md) and
[voice-fidelity review](../managing-better-writer/references/voice-fidelity.md).

The pass must compare the final prose with Andrew's original material and challenge
polished binaries, repeated claim-and-correction cadence, synthetic emphasis, tidy
recap endings, aphorisms, symmetrical sections and generic connective prose. A clean
voice-lint result is not enough, and an AI-detector score is not evidence. Make any
source-supported revisions through the writer workflow, update every affected
package file, rerun voice lint and local validation, then sync the same HubSpot draft
and repeat semantic and visual verification. Any copy change invalidates the prior
remote verification. Do not publish or schedule a stale version.

This automatic review does not authorize a draft write, publication or scheduling;
the authorization gates below still apply.

## Authorization gates

Read-only discovery, local validation and remote GET verification are allowed when
relevant. Creating or updating a HubSpot draft and uploading its images requires the
user to explicitly authorize pushing that named approved package.

Publishing or scheduling requires an explicit instruction naming the action and, for
scheduling, an absolute date and time. Copy approval does not authorize either gate.
If the user clearly authorizes draft push and subsequent publish or scheduling in one
request, proceed only after verification passes exactly; otherwise stop after the
verified draft.

## Boundaries

- Work only with packages under `gtm/managing-better/posts/`.
- Treat the local approved package as source of truth, but never overwrite detected
  remote drift. Reconcile it first.
- Create unpublished drafts by default. Update a published post through its draft
  endpoint, never by patching live content directly.
- On an ambiguous create failure, search by slug before considering another create.
- Never delete, unpublish, archive, restore a revision, change blog settings, create
  an author or create tags without a separate explicit request.
- Never print, copy or store the HubSpot credential.
- Stop after one failed retry of a read-only verification. Do not loop external writes.

## Finish the handoff

After a remote operation, ensure `publish.json` and `publishing-card.md` record the
post ID, URL, current state, verification result and schedule. Report what changed in
HubSpot and what remains awaiting approval. A successful API response is not a visual
verification.
