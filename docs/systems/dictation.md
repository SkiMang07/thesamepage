# Dictation — talk-to-text

A microphone in the fields where managers write prose, and a keyboard shortcut
that works in every text field in the app. The point is not the microphone. The
point is that the gap between a 1:1 ending and the note existing is the loop
this product lives or dies on, and talking is faster than typing.

## The boundary that makes this safe

Dictation sits **outside** draft-then-review, deliberately, and that is a claim
worth being precise about.

Every other AI write in the app is reviewed because a model produced text the
manager did not say — extracted commitments, a drafted rating, a prep guide.
Dictation is the inverse: the words are already the manager's. So the transcript
is inserted **verbatim** into the field they were already typing in, no model
tidies it, and their existing Save button remains the only thing that writes to
the database.

Three consequences that must not drift:

- **Never auto-save on transcript arrival.** The field's own save path is
  untouched by this feature. If dictation ever writes directly, it stops being
  typing-by-voice and becomes an AI write, and it needs a review step.
- **Never post-process with an LLM.** "Tidy this into bullets" is a rewrite of
  the manager's words. It would be a *draft*, and drafts get reviewed. If that
  feature is ever wanted it is a separate, explicit, second action with its own
  review — not something dictation does quietly on the way in.
- **The confirm/discard step is a human checkpoint, not an AI review step.** A
  stopped recording lands in an editable `DictationReview` card — the manager
  can fix a misheard word or bail entirely — before `insertAtCaret`/`insert()`
  ever runs (`frontend/components/DictationReview.tsx`). This does not move
  dictation onto the draft-then-review boundary: no model reads or changes
  `pendingText`, only the manager can, and the field's Save button is still the
  only writer to the database. It only changes *when* the verbatim insert
  happens, from "the instant transcription finishes" to "once the manager says
  so."

Cosmetic handling (caret placement, whitespace joining) is deterministic and
lives in `NoteField.insert()` / `insertAtCaret()`, where it can be read.

## Retention: none

Audio is recorded in the browser, POSTed once, transcribed, and dropped. It is
never written to Supabase Storage, to disk, or to a log line. The bytes exist in
memory for the length of one request.

`NoteField` says this to the manager in plain words the first time they use the
mic ("Your audio is transcribed and discarded. Nothing is recorded or stored,
and nothing saves until you save it."). That copy is a promise. Adding caching,
retry-from-stored-blob, or an audio archive is a change to a promise, not an
implementation detail.

## Shape

```
browser                                backend
───────                                ───────
MediaRecorder (32kbps mono)
  ↓ one blob on stop
POST /api/transcribe (multipart)  →   routes/transcribe.py
                                        auth, format allowlist, size cap
                                        ↓
                                      ai_core.transcribe_audio()
                                        ↓  OpenAI /v1/audio/transcriptions
                                      { text }
  ↓
review card (editable) · manager confirms or discards
  ↓ confirm
insert at caret · field state · manager edits · manager saves
```

A client-side Web Audio level meter (`useDictation`'s `level`, rendered by
`DictationLevelMeter`) runs alongside the recording. It never leaves the
browser and touches no part of this diagram — it's an AnalyserNode reading the
live MediaStream, not a second transcription path.

**Files**

| File | Owns |
|---|---|
| `frontend/lib/useDictation.ts` | MediaRecorder lifecycle, mime negotiation, timer, level meter, the review state (`pendingText`/`confirmReview`/`discardReview`), cancel, the caret-insert helper |
| `frontend/components/NoteField.tsx` | The app's textarea. Mic built in. **Reach for this instead of a raw `<textarea>`.** |
| `frontend/components/DictationReview.tsx` | The editable confirm/discard card, shared by NoteField (anchored at the field) and DictationHotkey (anchored in its pill) |
| `frontend/components/DictationLevelMeter.tsx` | The small live-input meter, shared the same way |
| `frontend/components/DictationHotkey.tsx` | ⌘⇧Space, global. Mounted once in `app/app/layout.tsx`. Its floating pill becomes the review card while reviewing, since it types into fields it doesn't own |
| `backend/routes/transcribe.py` | The one endpoint. Auth, caps, format allowlist |
| `backend/ai_core.py` → `transcribe_audio()` | The provider call. Every AI call still routes through ai_core |

## Vendor

OpenAI `gpt-transcribe`, configurable via `AI_TRANSCRIBE_MODEL`.

Chosen for a boring reason that is the right reason: `OPENAI_API_KEY` was
already in `config.py` and `ai_core.py` already called OpenAI, so this added no
new vendor relationship, no new secret, and no new place for data to sit. Claude
has no audio input modality at all, so some second provider was unavoidable.

Alternatives if accuracy on manager-speak disappoints, in order of how much
change they cost: `gpt-4o-transcribe` (same vendor, 4.0% WER), Gemini 3.5
Transcribe (cheaper at $0.18/hr and more accurate at 2.6% WER, but a new
dependency), ElevenLabs Scribe v2 (2.2% WER, best measured). **AssemblyAI is
disqualified unless someone flips a toggle first** — it uses customer audio for
model improvement by default.

**Cost is not a constraint here.** Batch transcription runs ~$0.27/hour of
audio. A manager dictating twenty minutes every working day costs about $2 a
year. This is deliberately the batch endpoint and not the realtime one, which
costs 3.8× for a latency win nobody asked for in a text box.

## Configuration, and the failure it caused

`OPENAI_API_KEY` must be set on the backend host. It is the *only* OpenAI
dependency in an otherwise Anthropic-only stack, which is precisely why it is
easy to miss: the service deploys green and every other AI feature works
without it. Dictation shipped to production without that key and failed on
every attempt, and the client rendered the resulting 503 as the same
"Couldn't transcribe that. Try again?" it showed for everything else — which
invited a retry that could never succeed.

Two things changed as a result, and both are load-bearing:

- **`/health` reports `"dictation": true|false`.** A boolean, never the key.
  "Is the key set on this deploy?" is now one unauthenticated GET rather than a
  signed-in browser and devtools. Add a flag here for any future capability that
  hides behind a secret this repo does not otherwise use.
- **The client maps status to message.** See below.

`AI_TRANSCRIBE_MODEL` defaults to `gpt-transcribe` and does not need setting.

One consequence worth knowing before that key is added anywhere new:
`generate_text()`'s Anthropic→OpenAI 5xx fallback is gated on the same
variable. Without the key the fallback silently never fires and an Anthropic
5xx is a hard 502. With it, `_call_openai()` — a path that has never executed
in production — becomes live during the next Anthropic outage.

## When it fails

`dictationErrorMessage()` in `useDictation.ts` owns the mapping, because these
statuses mean opposite things and a single catch-all string hides that:

| Status | Cause | Worth retrying? |
|---|---|---|
| 503 | `OPENAI_API_KEY` unset on the server | Never — it is configuration, not luck |
| 502 | OpenAI rejected the call or was unreachable. `transcribe_audio()` logs the vendor's own status and body — that log line is the diagnosis | Sometimes |
| 415 | The browser produced a format outside `_ALLOWED_PREFIXES` | No |
| 413 | Past the 8MB ceiling | No |
| 429 | Past the 30/minute limit | Shortly |
| no status | `fetch` itself rejected — offline, CORS, backend down | Yes |

`ApiError` in `lib/api.ts` is what carries the status that far; it is thrown by
both `authedFetch` and `authedFormFetch`, so any other surface that needs to
tell a configuration failure from a vendor failure can now do it too.

A recording under ~1.2KB never reaches the network at all — `useDictation`
discards it client-side (a mis-tap, not speech) and shows the same "Didn't
catch anything." message directly, rather than doing nothing. Before this it
failed silently: no error, no text, state just returned to idle, which looked
identical to the feature being broken.

## Vocabulary hints

`transcribe_audio()` takes an optional comma-separated `vocabulary` string,
passed to the model's `prompt` parameter to bias spelling. This is what stops
"Priya" coming back as "Prea". Pass `vocabulary` to `NoteField` on any surface
that knows the relevant names — the direct report on a 1:1 page, the roster on a
team page. It is a hint, not an instruction; the model still transcribes what it
hears. Capped at 400 characters server-side so it stays a vocabulary nudge and
not a channel for shipping record content to the transcription vendor.

## Browser reality

These are not hypotheticals; each one is a bug that would otherwise ship.

- **Safari below 18.4 cannot record webm.** It produces `audio/mp4` (AAC). The
  mime type is negotiated from a candidate list, and both formats are accepted
  server-side.
- **iOS has shipped builds where `isTypeSupported()` returns true and `start()`
  then throws.** So the `MediaRecorder` constructor sits in a try/catch with a
  bare-constructor fallback. Feature-detect, never UA-sniff, and be ready for
  the detection to lie.
- **The default bitrate is ~128kbps** (~57MB/hour). We request 32kbps mono, the
  Xiph recommendation for speech, ~14MB/hour. Safari ignores the hint, which is
  why the server ceiling is a generous 8MB rather than a tight one.
- **`getUserMedia` needs HTTPS and a user gesture**, so it is called on click,
  never on mount. Tracks are stopped on every exit path including unmount —
  a live track leaves the browser's recording indicator lit, which in a product
  about private notes is the wrong thing to leave on.
- **iOS suspends audio capture when Safari backgrounds or the screen locks.**
  Tolerable for dictation (seconds, screen on, thumb on the button) in a way it
  would not be for call recording.
- **Firefox has the Web Speech API disabled**, and the browser-native speech API
  ships audio to Google's or Apple's servers by default with no DPA. It is not
  used here and should not be — for this product that would be an uncontrolled
  third-party disclosure of the most sensitive content we hold.

## Keyboard

`⌘⇧Space` (Ctrl+Shift+Space) dictates into whatever text field has focus, on any
page, including fields that are not `NoteField`s. `Esc` while recording discards
without transcribing.

⌘⇧D and ⌘⇧M were the obvious picks and are both taken at the **browser** level
on at least one major platform (bookmark-all-tabs, switch-profile), where
`preventDefault` cannot reach them. ⌘⇧Space is unbound in Chrome, Firefox and
Safari on every platform, and unbound in stock macOS.

The global path writes through `insertAtCaret()`, which drives the field's
native value setter and dispatches a bubbling `input` event, so a
React-controlled field updates its own state exactly as if the manager had
typed. That is why one implementation covers both `NoteField`s and plain
textareas.

## Where the mic appears

Capture surfaces and description fields — 31 of them. Not the job-description
paste box (nobody dictates a JD), not the inline commitment-row editor in the
wrap-up review (a one-line edit inside a review row), and not name/title inputs.
The keyboard shortcut reaches all of those anyway, which is the point of having
both.

## NoteField and the duplication it fixes

Before this, there were 33 raw `<textarea>` elements across 15 files, each with
its own copy-pasted class string — the same disease `lib/tokens.ts` was created
to cure for buttons and inputs (see that file's header: `inputCls` had been
pasted verbatim into 8 files). Adding a mic to "many boxes" meant there was
nothing to add it to, so the feature and the missing component shipped together.

`NoteField` defaults its base look to the `TEXTAREA` token. Fields that are
deliberately not the standard field — the Scribe composer sits flush on the
drawer's own surface, and the older pages carry a local `inputCls` — pass their
own `baseClassName` and are visually unchanged.

`baseClassName` exists because **Tailwind resolves conflicts by stylesheet
order, not by the order classes appear in a string**. A caller passing `px-3` in
`className` would still lose to the token's `px-4`. Overriding the base has to
replace it, not append to it.

## Open

- **Mobile is untested.** The case for dictation is strongest on a phone between
  meetings, and we do not currently know whether anyone uses the app that way.
  That assumption is load-bearing and unverified.
- No `vocabulary` is wired into any call site yet. The plumbing is there; the
  first place to use it is the 1:1 prep/log pages, where the direct report's
  name is already in scope.
- **The confirm/discard review card and the level meter haven't been used
  live yet.** They were built 2026-08-31 in response to Andrew's first live
  use of dictation (which had shipped 2026-08-28 and gone unused until then).
  ⌘⇧Space's discoverability was raised in that same pass and deliberately
  parked — nothing in the app currently teaches a new user the shortcut
  exists.
