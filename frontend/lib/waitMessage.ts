// What to say while an AI call is in flight. The calls are single requests
// with no stages, so there is no honest "step 2 of 3" to show. What we do
// know is how long they usually take, so say that, and say something
// different once it is taking longer than that. (Dana waited 30 to 40 seconds
// on "Building agenda…" and "Reading…" with nothing else on screen.)

export function waitMessage(elapsedSeconds: number, typical: string): string {
  if (elapsedSeconds < 20) return `This usually takes ${typical}. You can leave this open.`;
  if (elapsedSeconds < 60) return "Still working. Longer notes take longer.";
  return "This is taking longer than usual. If nothing shows up soon, try again.";
}
