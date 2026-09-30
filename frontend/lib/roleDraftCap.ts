// The line above the role rows in the notes box. Only some roles get a first
// draft per pass (a heavy AI call each). Saying "up to 5" before she has
// counted her own six left Dana finding out who was left out on another page.
// Name them, and say the next pass is one click after saving.

export function roleDraftCapLine(maxRoles: number, chosen: number, waitingFirstNames: string[]): string {
  const head = `Up to ${maxRoles} roles get a first draft now, soonest 1:1 first (${chosen} of ${maxRoles} chosen).`;
  const tail = "Every draft is unapproved until you review it. Roles you keep without a draft are saved and assigned now; you can draft them next.";
  if (waitingFirstNames.length === 0) return `${head} ${tail}`;
  const names =
    waitingFirstNames.length === 1
      ? waitingFirstNames[0]
      : `${waitingFirstNames.slice(0, -1).join(", ")} and ${waitingFirstNames[waitingFirstNames.length - 1]}`;
  const verb = waitingFirstNames.length === 1 ? "is" : "are";
  return `${head} ${names} ${verb} not in this pass; the next one is a single button after you save. ${tail}`;
}
