# The model may draft a rating. It may never save one.

**Status:** Accepted — records and corrects the boundary governing behavior that
already shipped (`POST /api/assessments/{direct_report_id}/draft`). No code changed.

## Context

The AI rule in `gtm/brand/voice-rules.md` and `gtm/personas/new-manager.md` permitted
"a draft the manager rewrites" and forbade "producing or shading a rating." A drafted
rating is both, so the rule settled nothing.

The assessment draft endpoint sits exactly in that gap. It is a pure AI call that
drafts the overall `level_ordinal` plus skill and value scores against the manager's
own configured scales, and nothing persists until the manager sets it. Its prompt
already refuses to invent performance it has no evidence for and leaves items out
rather than filling them.

Layer 4 of the brand foundation then shipped a proof row reading "AI that stops before
the rating," marked shipped and structural. That claim is false whichever way the
ambiguity is settled. The rule was written after the endpoint was built, and three
documents restated it without anyone checking the code.

## Decision

**The boundary is saving, not drafting.**

> The model can draft against the manager's own scale, using evidence the manager can
> see. It never saves a value, never scores from activity, and never fills a gap the
> evidence doesn't support. Every value that enters the record is set by the manager.
> Undisclosed is worse than not doing it at all.

The draft endpoint is not an exception to the point of view. It is the clearest
instance of it: the manager's own standard applied to the manager's own notes, handed
back instead of a blank scorecard.

## Rejected alternatives

- **Remove the draft endpoint.** Hands the manager a blank scorecard carrying every
  configured expectation, which is the annual one-to-two-hours-per-person scramble the
  product exists to end. It would also make assessments inconsistent with wrap-up
  extraction and `/prep`, which are the same draft-then-review pattern.
- **Keep the ban and stop claiming it in copy.** Leaves a written rule the product
  violates. A rule nobody can hold is worse than no rule.
- **Ban only the overall level ordinal, permit skill and value drafts.** An arbitrary
  line. The anchoring risk is identical at every level.

## Consequences

- **Marketing may never claim the product won't draft a rating.** The claim is that
  nothing saves until the manager sets it, and that it leaves the box empty where the
  evidence is thin. Restraint is the differentiator; abstinence would be a lie.
- **Anchoring is an accepted live risk.** A drafted 3 pulls a manager who would have
  said 2, and "the manager reviews it" is thinner protection than it sounds. The
  mitigation is auditability rather than removal: show the evidence beside each drafted
  score, and surface what the model deliberately left blank instead of omitting it
  silently. Not yet built.
- **The draft endpoint has no eval.** Third AI call site to cover, behind wrap-up
  extraction and `/prep`, both of which were flagged first.
- **A disclosure obligation attaches** once a report-facing view of their own record
  exists. `frontend/app/app/ic/page.tsx` is still a stub.

## What should reopen this

An employment-law question about AI-assisted ratings. Evidence that managers accept
drafts substantially unedited, which would mean the review step is not real review.
Or the auditability mitigation proving insufficient once it can be measured.

See `docs/systems/assessments.md` for the mechanism and `gtm/brand/voice-rules.md` for
the rule as it now binds every surface.
