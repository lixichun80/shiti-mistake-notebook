export const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** NULL means the account has ongoing access (including existing accounts). */
export function trialEndFrom(startMs: number): string {
  return new Date(startMs + TRIAL_DAYS * DAY_MS).toISOString();
}

export function isTrialExpired(trialEndsAt: string | null, nowMs = Date.now()): boolean {
  if (trialEndsAt === null) return false;
  const endMs = Date.parse(trialEndsAt);
  return !Number.isFinite(endMs) || nowMs >= endMs;
}

/** Extend from the later of the current expiry and now, preserving unused time. */
export function extendTrialByWeek(trialEndsAt: string, nowMs = Date.now()): string {
  const endMs = Date.parse(trialEndsAt);
  return trialEndFrom(Math.max(nowMs, Number.isFinite(endMs) ? endMs : nowMs));
}
