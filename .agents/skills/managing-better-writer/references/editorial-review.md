# Editorial review

Run these as separate passes. Fixing everything sentence by sentence at once tends to
preserve a weak argument with cleaner grammar.

## Argument

- The post makes one defensible assertion and acknowledges any meaningful concession.
- The opening situation is concrete enough that the intended manager recognizes it.
- Every section advances the answer. Remove throat-clearing, recap and padded endings.
- Advice is operational: the reader can make a decision, change words or run a sequence.
- Product references follow from the argument and never turn the post into a disguised
  landing page.

## Andrew and brand voice

Apply `gtm/brand/voice-rules.md` literally, including the long-form prose rules. Then
read `references/voice-fidelity.md`, compare the post with Andrew's original material
and run `scripts/voice_lint.py`. Look for:

- a generic scene-setting introduction;
- fake empathy or claims about what every manager feels;
- two or more short declarative sentences used as a manufactured emphasis beat;
- a repeated claim/correction cadence such as "It is X. It is not Y";
- polished aphorisms and paragraph-ending lessons that Andrew did not supply;
- summarized facts that survive while Andrew's qualifications, uncertainty and
  self-correction disappear;
- named frameworks or abstract labels invented to make the material feel complete;
- identical section lengths and overly symmetrical logic;
- a repeated setup/correction cadence;
- rule-of-three lists used for rhythm rather than meaning;
- canned transitions, recap conclusions and inspirational last lines;
- abstract nouns replacing the real object or behavior;
- polished personal stories whose details Andrew never supplied.

Do not make the prose choppy merely to avoid those patterns. The blog register is
warmer, longer and looser than the homepage. A clean lint result is not evidence of
authorship; traceable reasoning and a convincing read-aloud comparison are.

## Evidence and product truth

- Trace every quotation and quantitative claim to a source.
- Prefer the current primary source over an article quoting it.
- Verify current product behavior against canonical docs or code before claiming it.
- Distinguish shipped proof from principle and roadmap.
- Move an unresolved claim to the publishing card or remove it.

## Structure and accessibility

- One H1 exists in the template, so the body begins below H1.
- H2 and H3 form a real hierarchy; H3 is used only for numbered steps.
- A bulleted blockquote is intentionally the contract box. Plain blockquotes are
  genuine pull quotes, not ordinary paragraphs with decoration.
- Script blocks contain words worth copying and preserve line breaks.
- Link text says what the destination is.
- The final image and alt text agree. Decorative images use empty alt text.
- The body remains understandable without images.

## Approval readiness

The package is ready to ask for approval only when `brief.md`, `post.html`,
`publishing-card.md`, `publish.json` and the final featured image agree with one
another and no material open claim remains.
