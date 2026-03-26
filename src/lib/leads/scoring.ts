import type { SignalSet } from './signals';

/**
 * Struggle score 0–10.
 *
 * Calibration changes vs prior version:
 * - Fixed OPT double-count bug (critical window now uses else-if, not additive)
 * - Critical 70–85d window: +4 (was broken +5 due to double counting)
 * - Resume review: +1 (was +2 — overlaps with frustration)
 * - No internship: +1 (was +2 — structural gap, not acute pain)
 * - Uni tier 3: removed (not distinctive enough)
 * - Thin profile: removed (too noisy, unrelated to genuine struggle)
 * - CPT school: +5 base (was auto-10 — now considers other signals for nuance)
 * - Comment intent: +2 (was +3 — single comment shouldn't auto-Tier-1)
 *
 * New max path: CPT (5) + OPT critical (4) + visa (2) = 11 → cap 10
 * To hit 6: OPT window (3) + frustration (2) + no internship (1) is sufficient.
 */
export function calcStruggleScore(s: SignalSet): number {
  // CPT school is high-urgency but should still consider other context
  let score = s.cptSchool ? 5 : 0; // strong base, not auto-max

  // OPT urgency — else-if prevents double-counting the critical window
  if (s.daysAgo >= 70 && s.daysAgo <= 85 && s.stillSearching) score += 4; // CRITICAL: ~2 wks left
  else if (s.daysAgo >= 60 && s.daysAgo < 90 && s.stillSearching) score += 3; // window burning
  else if (s.daysAgo >= 90 && s.daysAgo <= 180 && s.stillSearching) score += 3; // past limit
  else if (s.daysAgo > 180 && s.daysAgo <= 900 && s.stillSearching) score += 2; // chronic
  else if (s.daysAgo > 180 && s.daysAgo <= 730) score += 1; // silent

  // High-priority signals
  if (s.commentIntent) score += 2; // publicly raised hand — warm but not +3 alone
  if (s.visaStruggle) score += 2;
  if (s.h1bPanic || s.h1bResultsPanic) score += 2;
  if (s.bodyShopExit && s.stillSearching) score += 2;
  if (s.financialClock) score += 2; // EMI clock = cannot wait
  if (s.frustration) score += 2;

  // Lower-priority signals
  if (s.resumeReview) score += 1; // reduced: overlaps frustration
  if (!s.hasInternSignal && s.relevantField) score += 1; // no internship on relevant-field profile
  if (s.uniTier === 4) score += 1; // obscure school = less pipeline support
  if (s.premiumBadge) score += 1; // proven willingness to pay
  if (s.skillGap) score += 1;
  if (s.timePressure) score += 1;

  return Math.min(score, 10);
}

export function assignTier(qualityScore: number, intentScore: number, struggleScore?: number): 1 | 2 | 3 {
  if (qualityScore >= 8 && intentScore === 3) return 1;
  if (qualityScore >= 6 || intentScore >= 2 || (struggleScore !== undefined && struggleScore >= 6)) return 2;
  return 3;
}
