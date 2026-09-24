// Browser-side Sentry. Next.js loads this file before the app hydrates.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentryOptions";

Sentry.init(sentryOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
