# Voice fidelity

Use this review for every Managing Better draft. It is a source-fidelity check, not
an AI detector. The question is whether the reasoning and sentence movement could
plausibly have come from Andrew's supplied material.

## Preserve the thinking, not the verbal filler

Andrew's spoken briefs use longer clause chains, qualifications, examples and
self-corrections. Remove repeated filler such as "you know" when it adds nothing, but
do not remove the qualification or change the order in which he reaches the point.
The blog should sound edited, not converted into a different writer's essay voice.

Keep these traits when the source contains them:

- a concrete case before the general conclusion;
- scope qualifiers such as "more often than not," "not every employee" and "to be
  fair" when they change the claim;
- uncertainty stated at its real strength, such as "I don't know, maybe 70 percent";
- self-implication, including the thing Andrew has not prioritized or systematized;
- sentences that hold the exception and the conclusion together instead of breaking
  each thought into a sequence of pronouncements.

Do not imitate transcription artifacts or add conversational tics Andrew did not use.

## Generated scaffolding to challenge

These patterns are warnings, especially when the phrasing is not traceable to the
spoken brief:

- two or more short declarative sentences in a row, used as synthetic emphasis;
- a claim followed by a polished correction: "It is X. It is not Y," "not just X,"
  or "I used to think X. I don't anymore";
- paragraph endings written as aphorisms or quote-card lines;
- repeated abstract labels such as *the record*, *the story*, *the system* or *the
  boundary* where Andrew named a CRM report, 1:1 document, account transition or
  review form;
- tidy frameworks, named packets or exact enumerations that Andrew did not supply;
- transitions such as "Only then," "By this point," "This part matters because" and
  "The useful boundary is straightforward" when the underlying source simply moves
  to the next example;
- paragraphs with matching lengths and the same setup, elaboration and concluding
  insight;
- an invented insight that sounds polished enough to distract from the fact that it
  is not in the source.

None of these is banned in isolation. A real sentence may need one. Clusters are the
problem, and source support is the deciding test.

## Required review

1. Keep enough verbatim source texture in `brief.md` to recover Andrew's reasoning,
   not just the facts. If the brief contains only summarized bullets, return to the
   original note before drafting.
2. Compare the draft and source side by side. For each paragraph, identify the
   concrete source material and any connective claim added by the writer.
3. Remove or rewrite connective claims that manufacture a lesson, framework,
   contrast or flourish Andrew did not provide.
4. Review cadence separately. Treat consecutive sentences of eight words or fewer as
   a warning. Keep a short sentence only when it is natural to Andrew's source and
   earns its emphasis from the surrounding paragraph.
5. Read the piece aloud. Body paragraphs should breathe and vary. If several passages
   sound like homepage headlines or social captions, return them to the source's
   longer reasoning.
6. Run `python3 scripts/voice_lint.py <path-to-post.html>`. Review every warning; do
   not rewrite mechanically or claim that a clean result proves human authorship.

Before approval, summarize the voice review in the publishing card. State which
source anchors survived and whether any generated-scaffolding warnings remain.
