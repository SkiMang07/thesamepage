"use client";

// The meeting screen. Everything lives in components/meet/MeetingRoom.tsx;
// see its header for the layout, the local draft and the wrap-up hand-off.

import { useParams } from "next/navigation";
import MeetingRoom from "@/components/meet/MeetingRoom";

export default function MeetPage() {
  const { id } = useParams<{ id: string }>();
  return <MeetingRoom key={id} personId={id} />;
}
