// Product analytics (PRELAUNCH_BACKLOG §7 D). PostHog Cloud, free plan, with
// the billing limit set to $0: past 1M events a month PostHog drops events
// instead of charging.
//
// What this collects, and nothing more: a $pageview on every route change,
// tied to the Supabase user id once the manager is signed in
// (<AnalyticsUser /> in app/app/layout.tsx). The backend sends the one custom
// event, prep_sheet_saved (backend/analytics.py), under the same id, so a
// funnel can run from page views to a first saved sheet.
//
// Same privacy rules as Sentry (lib/sentryOptions.ts):
//   - No autocapture, so no click text, and nothing typed into a note field
//     can reach PostHog. No session replay, heatmaps, surveys or exception
//     capture. advanced_disable_flags skips PostHog's remote config, so a
//     toggle flipped in the PostHog UI can't switch any of those back on.
//   - disable_external_dependency_loading: PostHog never loads more script.
//   - Query strings and fragments are cut from every URL before sending
//     (/auth/callback carries its code there), and the invite token in
//     /invite/<token> is replaced with a placeholder, in URLs and pathnames.
//   - No email or name. IPs are dropped by the project's "Discard client IP
//     data" setting (PostHog's SDK has no client-side switch for it).
//
// Events go to /ingest on this domain and next.config.js forwards them to
// PostHog, so the CSP needs no PostHog host and ad blockers drop fewer of them.
//
// Off until NEXT_PUBLIC_POSTHOG_KEY is set on Vercel. The project key is
// public by design (it ships in the bundle); a leak only lets someone send us
// events, and the $0 limit caps what that can cost.
import posthog from "posthog-js";
import type { CaptureResult } from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

export const analyticsEnabled = Boolean(key);

function scrubValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let out = value.replace(/\/invite\/[^/?#]+/g, "/invite/[token]");
  if (/^https?:\/\//.test(out)) {
    const cut = out.search(/[?#]/);
    if (cut !== -1) out = out.slice(0, cut);
  }
  return out;
}

function scrubUrls(props: Record<string, unknown> | undefined) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) props[k] = scrubValue(v);
}

function scrub(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  scrubUrls(event.properties);
  scrubUrls(event.$set as Record<string, unknown> | undefined);
  scrubUrls(event.$set_once as Record<string, unknown> | undefined);
  return event;
}

export function initAnalytics() {
  if (!key || typeof window === "undefined") return;
  posthog.init(key, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    capture_pageview: "history_change",
    capture_pageleave: false,
    autocapture: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    mask_personal_data_properties: true,
    person_profiles: "identified_only",
    before_send: scrub,
  });
}

// Called with the Supabase user id on sign-in, null on sign-out.
export function setAnalyticsUser(userId: string | null) {
  if (!key) return;
  if (userId) {
    if (posthog.get_distinct_id() !== userId) posthog.identify(userId);
  } else if (posthog.get_property("$user_state") === "identified") {
    posthog.reset();
  }
}
