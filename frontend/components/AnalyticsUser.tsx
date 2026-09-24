"use client";

// Ties PostHog page views to the signed-in manager's user id, and nothing else
// about them (no email, no name). The backend sends prep_sheet_saved under the
// same id (backend/analytics.py), so one person's page views and saved sheets
// line up. Same shape as <SentryUser />: getSession() reads the local cookie
// and makes no network call.

import { useEffect } from "react";
import { createClient } from "@/lib/supabase";
import { analyticsEnabled, setAnalyticsUser } from "@/lib/analytics";

export default function AnalyticsUser() {
  useEffect(() => {
    if (!analyticsEnabled) return;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setAnalyticsUser(data.session?.user.id ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAnalyticsUser(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return null;
}
