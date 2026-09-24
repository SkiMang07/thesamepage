"use client";

// Tags Sentry events with the signed-in manager's user id, and nothing else
// about them (no email, no name). Mirrors the backend, which attaches the same
// id, so one person's frontend and backend errors line up in Sentry.
// getSession() reads the local session cookie; it makes no network call.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase";

export default function SentryUser() {
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      Sentry.setUser(data.session ? { id: data.session.user.id } : null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      Sentry.setUser(session ? { id: session.user.id } : null);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return null;
}
