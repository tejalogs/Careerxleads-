/**
 * Estimate graduation date from year + month hint in headline.
 * Checks for explicit month names, then "Spring" → May, "Fall/Winter" → December.
 * Defaults to May 15 (spring commencement — most common US grad date).
 */
export function getGradDateEstimate(gradYr: number, headline: string): Date {
  const h = headline.toLowerCase();
  if (/\b(january|jan)\b/.test(h))   return new Date(gradYr, 0,  15);
  if (/\b(february|feb)\b/.test(h))  return new Date(gradYr, 1,  15);
  if (/\b(march|mar)\b/.test(h))     return new Date(gradYr, 2,  15);
  if (/\b(april|apr)\b/.test(h))     return new Date(gradYr, 3,  15);
  if (/\b(may)\b/.test(h))           return new Date(gradYr, 4,  15);
  if (/\b(june|jun)\b/.test(h))      return new Date(gradYr, 5,  15);
  if (/\b(july|jul)\b/.test(h))      return new Date(gradYr, 6,  15);
  if (/\b(august|aug)\b/.test(h))    return new Date(gradYr, 7,  15);
  if (/\b(september|sep)\b/.test(h)) return new Date(gradYr, 8,  15);
  if (/\b(october|oct)\b/.test(h))   return new Date(gradYr, 9,  15);
  if (/\b(november|nov)\b/.test(h))  return new Date(gradYr, 10, 15);
  if (/\b(december|dec)\b/.test(h))  return new Date(gradYr, 11, 15);
  if (/\bfall\b|\bwinter\b/.test(h)) return new Date(gradYr, 11, 15);
  if (/\bspring\b/.test(h))          return new Date(gradYr, 4,  15);
  return new Date(gradYr, 4, 15); // default: May 15
}

// H1B dates are configurable via env vars — USCIS dates vary by year.
// Defaults: season March–May, results window March 15 – May 15.
const H1B_SEASON_START = parseInt(process.env.H1B_SEASON_START_MONTH || '3', 10); // 1-indexed month
const H1B_SEASON_END   = parseInt(process.env.H1B_SEASON_END_MONTH   || '5', 10);
const H1B_RESULTS_START_MONTH = parseInt(process.env.H1B_RESULTS_START_MONTH || '3', 10);
const H1B_RESULTS_START_DAY   = parseInt(process.env.H1B_RESULTS_START_DAY   || '15', 10);
const H1B_RESULTS_END_MONTH   = parseInt(process.env.H1B_RESULTS_END_MONTH   || '5', 10);
const H1B_RESULTS_END_DAY     = parseInt(process.env.H1B_RESULTS_END_DAY     || '15', 10);

/** H1B lottery season (default: March–May, configurable via H1B_SEASON_* env vars) */
export function isH1BSeasonNow(): boolean {
  const m = new Date().getMonth() + 1; // 1=Jan
  return m >= H1B_SEASON_START && m <= H1B_SEASON_END;
}

/** H1B Results Window (default: March 15 – May 15, configurable via H1B_RESULTS_* env vars) */
export function isH1BResultsWindow(): boolean {
  const now = new Date();
  const m = now.getMonth() + 1; // 1=Jan
  const d = now.getDate();
  const afterStart = m > H1B_RESULTS_START_MONTH || (m === H1B_RESULTS_START_MONTH && d >= H1B_RESULTS_START_DAY);
  const beforeEnd  = m < H1B_RESULTS_END_MONTH   || (m === H1B_RESULTS_END_MONTH   && d <= H1B_RESULTS_END_DAY);
  return afterStart && beforeEnd;
}
