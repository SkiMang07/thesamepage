// Career conversations — pure helpers shared by the person page card and
// Mission Control. No imports, so Node's test runner can load it.
// Rules live in backend/career_rhythm.py; this only formats and picks.

type PersonLike = {
  direct_report_id: string;
  name: string;
  state: "off" | "not_due" | "proposed" | "planned" | "missed";
  planned: { planned_for: string | null; heads_up_sent_at: string | null } | null;
  suggested: string | null;
  choices: string[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parts(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Thu, Oct 22" */
export function shortDay(iso: string): string {
  const d = parts(iso);
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Thursday, October 22" */
export function longDay(iso: string): string {
  const d = parts(iso);
  return `${DAYS_LONG[d.getUTCDay()]}, ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function firstOf(name: string): string {
  return (name || "").trim().split(/\s+/)[0] || name;
}

/** True when the 1:1 dated `meetingDate` is this person's planned career conversation. */
export function isCareerDay(person: PersonLike | null | undefined, meetingDate: string | null | undefined): boolean {
  const planned = person?.planned?.planned_for;
  return Boolean(planned && meetingDate && meetingDate.slice(0, 10) === planned && person?.state === "planned");
}

export type CareerAsk = { personId: string; first: string; text: string };

/**
 * What Mission Control asks for, one line per person, in the order a manager
 * should act: a past conversation to confirm, a 1:1 to pick, then a heads-up
 * not yet sent. Planned conversations with the heads-up sent need nothing.
 */
export function careerAsks(people: PersonLike[]): CareerAsk[] {
  const missed: CareerAsk[] = [];
  const pick: CareerAsk[] = [];
  const send: CareerAsk[] = [];
  for (const p of people) {
    const first = firstOf(p.name);
    if (p.state === "missed") {
      missed.push({ personId: p.direct_report_id, first, text: `${first}: did the career conversation happen?` });
    } else if (p.state === "proposed") {
      pick.push({
        personId: p.direct_report_id,
        first,
        text: p.suggested ? `${first}: pick the 1:1 (suggested ${shortDay(p.suggested)})` : `${first}: pick a 1:1`,
      });
    } else if (p.state === "planned" && p.planned?.planned_for && !p.planned.heads_up_sent_at) {
      send.push({ personId: p.direct_report_id, first, text: `${first}, ${shortDay(p.planned.planned_for)}: send the heads-up` });
    }
  }
  return [...missed, ...pick, ...send];
}
