/**
 * A bridge so shared components can ask for press feedback without knowing how the app
 * produces it. The app registers its handler once at start-up (apps/mobile/lib/feedback.ts);
 * until then the calls do nothing.
 */
export type UiFeedbackEvent = "tap";

let handler: ((event: UiFeedbackEvent) => void) | null = null;

export function setUiFeedback(next: ((event: UiFeedbackEvent) => void) | null) {
  handler = next;
}

export function uiFeedback(event: UiFeedbackEvent) {
  handler?.(event);
}
