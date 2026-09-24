// Browser-side Sentry and PostHog. Next.js loads this file before the app
// hydrates. Both are off until their NEXT_PUBLIC_ keys are set on Vercel.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentryOptions";
import { initAnalytics } from "@/lib/analytics";

Sentry.init(sentryOptions);
initAnalytics();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
