import {
  CPT_UNI_RE, BODY_SHOP_RE, COMMENT_INTENT_RE, FINANCIAL_CLOCK_RE,
  RESUME_REVIEW_RE, LINKEDIN_PREMIUM_RE, PRODUCT_COMPANY_RE,
  LOW_FIELDS, isEliteUni, categorizeUniversity,
} from './patterns';
import { getGradDateEstimate, isH1BSeasonNow, isH1BResultsWindow } from './timing';
import { detectRegionalTag } from './regional';
import { checkIndianOrigin } from './origin';

// ── SignalSet — single extraction pass per profile ────────────────────────────
export interface SignalSet {
  // Origin
  indianOriginConfirmed: boolean;
  // Degree
  mastersStudent: boolean;
  // Job intent signals (computed once, shared across scoring + outreach)
  visaStruggle: boolean;
  h1bPanic: boolean;
  h1bResultsPanic: boolean;
  cptSchool: boolean;
  bodyShopExit: boolean;
  bodyShopCompany: string | null;
  commentIntent: boolean;
  financialClock: boolean;
  resumeReview: boolean;
  premiumBadge: boolean;
  frustration: boolean;
  skillGap: boolean;
  timePressure: boolean;
  jobSearchIntent: boolean;
  stillSearching: boolean;    // "seeking/looking/open to work" in headline
  hasInternSignal: boolean;   // internship/co-op in headline or experience
  // Composite
  networkTrap: boolean;       // body shop + low networking score
  networkingScore: number;    // 0-10 product company exposure
  // Regional
  regionalTag: string | undefined;
  undergradSchool: string | null;
  // OPT countdown
  daysAgo: number;            // days since estimated graduation (-1 if unknown)
  optDaysRemaining: number | undefined;
  // Profile meta
  relevantField: boolean;
  profileComplete: boolean;
  uniTier: 2 | 3 | 4;       // 1=elite → already rejected by caller
}

export function extractSignals(p: any): SignalSet {
  const edu = p.education?.[0] || {};
  const university = edu.schoolName || p.university || '';
  const degree = edu.degreeName || p.degree || '';
  const fieldOfStudy = edu.fieldOfStudy || p.fieldOfStudy || '';
  const rawEndDate = edu.endDate;
  const graduationYear = (typeof rawEndDate === 'object' ? rawEndDate?.text : rawEndDate) || p.graduationYear || '';
  const headline = (p.headline || '').toLowerCase();
  const fullName = p.fullName || p.name || '';
  const summary = (p.summary || '').toLowerCase();
  const snippet = (p.metadata?.snippet || '').toLowerCase();

  // Find undergrad education — use find() not [1] to handle profiles with 1 entry
  const undergradEdu = (p.education || []).find((e: any) =>
    /b\.?tech|b\.?e\b|bachelor of (engineering|technology)|b\.?sc engg/i.test(e.degreeName || ''),
  ) || p.education?.[1] || {};
  const undergradDeg = (undergradEdu.degreeName || '').toLowerCase();
  const undergradUniStr = (undergradEdu.schoolName || '').toLowerCase();

  // ── Origin signals (unified 5-signal check) ──────────────────────────────
  const indianOriginConfirmed = checkIndianOrigin(p);

  // ── Degree ─────────────────────────────────────────────────────────────────
  const mastersStudent = /master|ms\b|m\.s\.|mba|m\.b\.a\.|meng|m\.eng|m\.sc/i.test(degree)
    || /\bms\b|m\.s\.|master|mba|meng|m\.eng|m\.sc/i.test(headline);

  // ── Intent signals ─────────────────────────────────────────────────────────
  const visaStruggle = /\bopt\b|f1\b|cpt\b|ead\b|visa sponsorship|stem opt|stem extension|h1b sponsorship|h1b not selected|work authorization/i.test(headline)
    && !/no sponsorship needed|does not require sponsorship|authorized to work/i.test(headline);
  const h1bPanic = isH1BSeasonNow() && /h1b|lottery|not selected|day 1 cpt|day1 cpt|opt extension/i.test(headline);
  const h1bResultsPanic = isH1BResultsWindow() && /h1b|lottery|not selected|opt extension|day 1 cpt|day1 cpt/i.test(headline);
  const cptSchool = CPT_UNI_RE.test(university);
  const bodyShopExit = (p.experience || []).some((e: any) =>
    BODY_SHOP_RE.test(e.companyName || e.company || ''),
  );
  const bodyShopCompany = (p.experience || []).find((e: any) =>
    BODY_SHOP_RE.test(e.companyName || e.company || ''),
  )?.companyName || null;
  const commentIntent = COMMENT_INTENT_RE.test(headline) || COMMENT_INTENT_RE.test(snippet);
  const financialClock = FINANCIAL_CLOCK_RE.test(headline) || FINANCIAL_CLOCK_RE.test(summary);
  const resumeReview = RESUME_REVIEW_RE.test(headline) || RESUME_REVIEW_RE.test(snippet);
  const premiumBadge = LINKEDIN_PREMIUM_RE.test(headline) || p.isPremium === true;
  const frustration = /no offers|no interviews|struggling|ghosted|no callbacks|rejected|please help|job hunt|resume review/i.test(headline);
  const skillGap = /upskilling|self.taught|bootcamp|looking for mentor|career switch|career change|pivoting|reskill|udemy|coursera|project.based learning/i.test(headline);

  const gradYrNum = parseInt(graduationYear || '0', 10);
  const thisYrNum = new Date().getFullYear();
  const timePressure = gradYrNum > 0 && (gradYrNum === thisYrNum || gradYrNum === thisYrNum + 1) &&
    /graduating|incoming|class of|starting (summer|fall|spring|winter)/i.test(headline);

  const stillSearching = /student|looking for|seeking|job hunt|open to work|actively/i.test(headline);
  const hasInternSignal = /intern|co.?op/i.test(headline)
    || (p.experience || []).some((e: any) => /intern|co.?op/i.test((e.title || e.positionTitle || '').toLowerCase()));

  const jobSearchIntent = visaStruggle || h1bPanic || h1bResultsPanic || cptSchool || bodyShopExit ||
    commentIntent || financialClock || resumeReview || frustration || skillGap || timePressure ||
    /seeking|looking for|open to|internship|full.?time|actively looking/i.test(headline);

  // ── Networking score ───────────────────────────────────────────────────────
  const expText = (p.experience || []).map((e: any) => e.companyName || e.company || '').join(' ');
  const hasProductExp = PRODUCT_COMPANY_RE.test(expText);
  const hasServiceExp = BODY_SHOP_RE.test(expText);
  const hasProductMention = PRODUCT_COMPANY_RE.test(`${headline} ${summary}`);
  const hasEcosystemEng = /open source|github\.com|hackathon|google developer|aws certified|microsoft certified|meta.*developer|leetcode|competitive programming|open.*contribut/i.test(`${headline} ${summary}`);
  let networkingScore = 5;
  if (hasProductExp) networkingScore += 4;
  if (hasProductMention) networkingScore += 2;
  if (hasEcosystemEng) networkingScore += 1;
  if (hasServiceExp) networkingScore -= 3;
  if (!hasProductExp && !hasProductMention && !hasEcosystemEng) networkingScore -= 2;
  networkingScore = Math.max(0, Math.min(10, networkingScore));

  const networkTrap = bodyShopExit && networkingScore <= 4;

  // ── Regional tag ───────────────────────────────────────────────────────────
  const regionalTag = detectRegionalTag(p);
  const undergradSchoolFull = undergradEdu?.schoolName || null;
  const undergradSchool = undergradSchoolFull
    ? (undergradSchoolFull.length > 40 ? undergradSchoolFull.slice(0, 38) + '…' : undergradSchoolFull)
    : null;

  // ── OPT countdown ──────────────────────────────────────────────────────────
  // OPT unemployment clock: F1 students can be unemployed for max 90 consecutive days.
  // OPT validity: 12 months (365d) standard, 36 months (1095d) with STEM extension.
  // We approximate by tracking days since estimated graduation.
  const OPT_UNEMPLOYMENT_LIMIT = 90;
  const OPT_STANDARD_VALIDITY = 365;
  const gradDateEst = gradYrNum > 0 ? getGradDateEstimate(gradYrNum, p.headline || '') : null;
  const daysAgo = gradDateEst ? Math.floor((Date.now() - gradDateEst.getTime()) / 86_400_000) : -1;
  const optDaysRemaining = (daysAgo >= 0 && daysAgo <= OPT_STANDARD_VALIDITY && jobSearchIntent)
    ? Math.max(0, OPT_UNEMPLOYMENT_LIMIT - daysAgo) : undefined;

  // ── Profile meta ───────────────────────────────────────────────────────────
  const relevantField = !LOW_FIELDS.some(f => fieldOfStudy.toLowerCase().includes(f));
  const profileComplete = !!(fullName && university && fieldOfStudy && p.linkedinUrl);
  const uniTierRaw = categorizeUniversity(university);
  const uniTier: 2 | 3 | 4 = uniTierRaw === 1 ? 2 : uniTierRaw;

  return {
    indianOriginConfirmed, mastersStudent,
    visaStruggle, h1bPanic, h1bResultsPanic,
    cptSchool, bodyShopExit, bodyShopCompany,
    commentIntent, financialClock, resumeReview, premiumBadge,
    frustration, skillGap, timePressure,
    jobSearchIntent, stillSearching, hasInternSignal,
    networkTrap, networkingScore,
    regionalTag, undergradSchool,
    daysAgo, optDaysRemaining,
    relevantField, profileComplete, uniTier,
  };
}
