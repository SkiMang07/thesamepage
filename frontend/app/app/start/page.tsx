"use client";

// First run — docs/ONBOARDING_SCOPING.md, design in
// docs/design-proposals/2026-09-29-first-run/prototype.html.
//
// A manager with no direct reports lands here instead of on an empty Mission
// Control (the auth routes and the dashboard both send them). Two questions,
// no nav, no Scribe: who the next 1:1 is with, then everyone else. Each answer
// shows up in a Team panel beside the question as it is typed, so the team
// comes together on screen. Then straight to that person's prep, with the
// date already set.
//
// Nothing is created until a button is pressed. Names only: roles, teams and
// expectations stay where they are, for later.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { createDirectReport, getDirectReports, getEntitlement, reportFirstRunRoster, type Entitlement } from "@/lib/api";
import PersonAvatar from "@/components/team/PersonAvatar";
import { BTN_PRIMARY, EYEBROW, INPUT, TEXTAREA } from "@/lib/tokens";

// Andrew's welcome, shown beside the first question. Left empty until he
// writes it; the panel doesn't render without it.
const WELCOME: { paragraphs: string[]; signature: string; email: string } | null = null;

const ROSTER_CAP = 25;

function localDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextWeekdays(count: number): Date[] {
  const out: Date[] = [];
  const d = new Date();
  while (out.length < count) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(new Date(d));
  }
  return out;
}

const shortDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fromDateStr = (s: string) => new Date(`${s}T12:00:00`);
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? "";
const countWord = (n: number) =>
  ["No one", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][n] ?? String(n);

// One name per line (commas too). List markers are stripped, blanks and
// repeats dropped, and the step-1 name left out, case-insensitively.
function parseRoster(text: string, exclude: string): string[] {
  const seen = new Set([exclude.trim().toLowerCase()]);
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const name = raw.replace(/^\s*([-•*]|\d+[.)])\s*/, "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === ROSTER_CAP) break;
  }
  return out;
}

export default function StartPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [otherDate, setOtherDate] = useState(false);
  const [firstId, setFirstId] = useState<string | null>(null);
  const [rosterText, setRosterText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const rosterRef = useRef<HTMLTextAreaElement>(null);

  const days = useMemo(() => nextWeekdays(4), []);
  const roster = useMemo(() => parseRoster(rosterText, name), [rosterText, name]);

  // Someone who already has people doesn't belong here.
  useEffect(() => {
    let cancelled = false;
    getDirectReports()
      .then((reports) => {
        if (cancelled) return;
        if (reports.length > 0) router.replace("/app/dashboard");
        else setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    getEntitlement()
      .then((e) => {
        if (!cancelled) setEntitlement(e);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    if (step === 1) nameRef.current?.focus();
    else rosterRef.current?.focus();
  }, [ready, step]);

  async function submitFirst(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createDirectReport({ name: trimmed });
      setFirstId(created.id);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add them. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function submitRoster(skip = false) {
    if (!firstId || saving) return;
    const names = skip ? [] : roster;
    setSaving(true);
    setError(null);
    const results = await Promise.allSettled(names.map((n) => createDirectReport({ name: n })));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (names.length - failed > 0) void reportFirstRunRoster(names.length - failed);
    const target = `/app/reports/${firstId}/prep${date ? `?date=${date}` : ""}`;
    if (failed > 0) {
      setError(`${failed} couldn't be added. Add them from Team later.`);
      window.setTimeout(() => router.push(target), 2400);
      return;
    }
    router.push(target);
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/app/login");
  }

  const foundingLine = (() => {
    if (!entitlement?.trial_ends_at || entitlement.status !== "trialing") return null;
    const until = new Date(entitlement.trial_ends_at).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    return entitlement.founding_number
      ? `Founding manager ${entitlement.founding_number} of 20 · Free until ${until}`
      : `Free until ${until}`;
  })();

  const first = firstName(name);
  const dateLabel = date ? shortDay(fromDateStr(date)) : null;
  const teamCount = (name.trim() ? 1 : 0) + (step === 2 ? roster.length : 0);

  if (!ready) return <div className="min-h-screen" aria-busy="true" />;

  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-hairline px-5 sm:px-10">
        <span className="font-serif text-xl text-ink">The Same Page</span>
        <span className="text-xs text-ink-muted">Step {step} of 3</span>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-5 pb-16 pt-8 sm:px-10 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
        <section className="min-w-0 lg:sticky lg:top-12 lg:self-start lg:max-w-[470px]">
          {step === 1 ? (
            <form onSubmit={submitFirst} key="step1" className="motion-safe:animate-rise-in">
              {foundingLine && (
                <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.14em] text-brand">{foundingLine}</p>
              )}
              <h1 className="font-serif text-[2.25rem] font-normal leading-[1.1] tracking-[-0.02em] text-ink sm:text-[2.85rem]">
                Who&apos;s your next 1:1 with?
              </h1>

              <label htmlFor="first-name" className="mb-2 mt-6 block text-sm text-ink-body">
                Name
              </label>
              <input
                id="first-name"
                ref={nameRef}
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Priya Patel"
                className={`${INPUT} !py-3 font-serif !text-2xl`}
              />

              <p className="mb-2 mt-6 text-sm text-ink-body">
                When <span className="text-ink-muted">· optional</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {days.map((d) => {
                  const value = localDateStr(d);
                  const on = date === value && !otherDate;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setOtherDate(false);
                        setDate(on ? "" : value);
                      }}
                      className={`rounded-full border px-3.5 py-1.5 text-sm ${
                        on ? "border-brand bg-brand-tint text-brand" : "border-transparent bg-sunken text-ink-body hover:text-ink"
                      }`}
                    >
                      {shortDay(d)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  aria-pressed={otherDate}
                  onClick={() => {
                    setOtherDate(!otherDate);
                    if (otherDate) setDate("");
                  }}
                  className={`rounded-full border px-3.5 py-1.5 text-sm ${
                    otherDate ? "border-brand bg-brand-tint text-brand" : "border-transparent bg-sunken text-ink-body hover:text-ink"
                  }`}
                >
                  Other date
                </button>
              </div>
              {otherDate && (
                <input
                  type="date"
                  aria-label="Meeting date"
                  value={date}
                  min={localDateStr(new Date())}
                  onChange={(e) => setDate(e.target.value)}
                  className={`${INPUT} mt-3 max-w-[220px]`}
                />
              )}

              {error && (
                <p className="mt-4 text-sm text-red-700" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-7">
                <button type="submit" disabled={!name.trim() || saving} className={`${BTN_PRIMARY} !px-5 !py-3 !text-base`}>
                  {saving ? "Adding…" : "Continue"}
                </button>
              </div>
            </form>
          ) : (
            <div key="step2" className="motion-safe:animate-rise-in">
              <h1 className="font-serif text-[2.25rem] font-normal leading-[1.1] tracking-[-0.02em] text-ink sm:text-[2.85rem]">
                Who else do you have 1:1s with?
              </h1>
              <p className="mt-3 text-[15px] text-ink-body">One name per line. Roles and teams can come later.</p>
              <textarea
                ref={rosterRef}
                aria-label="Names, one per line"
                value={rosterText}
                onChange={(e) => setRosterText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submitRoster();
                  }
                }}
                placeholder={"Sam Okafor\nLena Ruiz\nTheo Marsh"}
                rows={6}
                className={`${TEXTAREA} mt-5 font-serif text-lg leading-relaxed`}
              />
              {error && (
                <p className="mt-4 text-sm text-red-700" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => void submitRoster()}
                  disabled={saving}
                  className={`${BTN_PRIMARY} !px-5 !py-3 !text-base`}
                >
                  {saving ? "Adding…" : roster.length ? `Add ${roster.length} and continue` : "Continue"}
                </button>
                <button
                  type="button"
                  onClick={() => void submitRoster(true)}
                  disabled={saving}
                  className="px-1 py-2 text-sm text-brand hover:text-brand-hover disabled:opacity-50"
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          <div className="mt-9 flex justify-between gap-4 border-t border-hairline pt-4 text-xs text-ink-muted">
            <span>Only you can see what you write here. Nothing is shared with the people you add.</span>
            <button type="button" onClick={() => void signOut()} className="shrink-0 underline hover:text-ink-secondary">
              Sign out
            </button>
          </div>
        </section>

        <aside className="min-w-0 space-y-4" aria-label="Your team so far">
          {step === 1 && WELCOME && (
            <section className="rounded-xl border-l-2 border-brand bg-surface px-6 py-5">
              <p className={EYEBROW}>From Andrew</p>
              {WELCOME.paragraphs.map((p) => (
                <p key={p} className="mt-3 font-serif text-base leading-relaxed text-ink-body">
                  {p}
                </p>
              ))}
              <p className="mt-4 font-serif text-lg italic text-ink">{WELCOME.signature}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{WELCOME.email}</p>
            </section>
          )}

          {(name.trim() || step === 2) && (
            <section className="rounded-xl bg-surface px-6 py-5">
              <p className={EYEBROW}>Team</p>
              <h2 className="mt-1 font-serif text-2xl text-ink">
                {countWord(teamCount)} {teamCount === 1 ? "person" : "people"}
              </h2>
              <ul className="mt-3">
                <li className="-mx-6 flex items-center gap-3 border-b border-l-2 border-hairline border-l-brand bg-brand-tint px-6 py-3">
                  <PersonAvatar id={firstId ?? name.trim()} name={name} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{name.trim()}</span>
                  <span className={`shrink-0 text-xs ${dateLabel ? "text-brand" : "text-ink-muted"}`}>
                    {dateLabel ? `1:1 · ${dateLabel}` : "No date yet"}
                  </span>
                </li>
                {step === 2 &&
                  roster.map((n) => (
                    <li key={n} className="flex items-center gap-3 border-b border-hairline py-3 last:border-b-0 motion-safe:animate-rise-in">
                      <PersonAvatar id={n} name={n} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{n}</span>
                      <span className="shrink-0 text-xs text-ink-muted">No 1:1 set</span>
                    </li>
                  ))}
                {step === 2 && roster.length === 0 && (
                  <li className="flex items-center gap-3 py-3 text-[15px] text-ink-faint">
                    <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-sunken">·</span>
                    Everyone else
                  </li>
                )}
              </ul>
              {step === 1 && first && (
                <p className="mt-3 text-xs text-ink-muted">
                  Next: the rest of your team, then a first agenda for {first}.
                </p>
              )}
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
