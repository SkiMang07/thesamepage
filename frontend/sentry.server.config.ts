// Node-runtime Sentry (server components, route handlers). Loaded by instrumentation.ts.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentryOptions";

Sentry.init(sentryOptions);
