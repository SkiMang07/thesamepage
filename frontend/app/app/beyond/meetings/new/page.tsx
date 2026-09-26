"use client";

// Log a meeting beyond the team. ?person=<id> preselects who it was with
// (the "Log a meeting" action on a person's page); &plan=1 plans a future
// 1:1 instead ("Plan the next 1:1"), which opens straight into its prep;
// ?kind=group starts a group meeting.

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MeetingEditor from "../../MeetingEditor";

function NewMeeting() {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <MeetingEditor
      initialPersonId={params.get("person")}
      initialKind={params.get("kind") === "group" ? "group" : null}
      plan={params.get("plan") === "1"}
      onLogged={(meeting) => router.push(`/app/beyond/meetings/${meeting.id}`)}
    />
  );
}

export default function NewOutsideMeetingPage() {
  return (
    <Suspense>
      <NewMeeting />
    </Suspense>
  );
}
