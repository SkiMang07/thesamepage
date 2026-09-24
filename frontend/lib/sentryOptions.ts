// Shared Sentry settings for the browser, Node and edge runtimes
// (PRELAUNCH_BACKLOG §7 D). Same rules as backend/observability.py:
// errors only, no PII, the user id attached and nothing else about the person.
//
// Off until NEXT_PUBLIC_SENTRY_DSN is set on Vercel, so it is safe to deploy
// before the variable exists. The DSN is public by design (it ships in the
// browser bundle); a leak only lets someone send us errors.
import type { BrowserOptions } from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export const sentryOptions: BrowserOptions = {
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  // Errors only. Tracing and session replay are separate decisions (and bills).
  tracesSampleRate: 0,
  // No IP address, cookies or request bodies. The user id is set by
  // <SentryUser /> in app/app/layout.tsx.
  sendDefaultPii: false,
  // Console breadcrumbs can carry whatever a component logged, and in a notes
  // app that could be note text. Drop them; clicks, navigation and fetch
  // breadcrumbs (URLs and status codes) stay.
  beforeBreadcrumb(breadcrumb) {
    return breadcrumb.category === "console" ? null : breadcrumb;
  },
};
