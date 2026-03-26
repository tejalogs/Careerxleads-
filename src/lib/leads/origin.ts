import { INDIAN_SURNAME_RE, INDIAN_UNI_RE, ISA_ORG_RE, DESI_LANGUAGE_RE, INDIA_PREP_RE } from './patterns';

/**
 * Unified 5-signal Indian origin check.
 * Used by both qualification (signals.ts) and rejection analysis (rejection.ts).
 */
export function checkIndianOrigin(p: any): boolean {
  const fullName = p.fullName || p.name || '';
  const headline = (p.headline || '').toLowerCase();
  const summary = (p.summary || '').toLowerCase();

  const orgs = (p.organizations || p.volunteerExperiences || [])
    .map((o: any) => (o.organizationName || o.name || '').toLowerCase()).join(' ');
  const languages = (p.languages || [])
    .map((l: any) => (l.name || l || '').toLowerCase()).join(' ');
  const combinedText = `${headline} ${summary} ${languages} ${orgs}`;

  // Find undergrad education entry (B.Tech/B.E.)
  const undergradEdu = (p.education || []).find((e: any) =>
    /b\.?tech|b\.?e\b|bachelor of (engineering|technology)|b\.?sc engg/i.test(e.degreeName || ''),
  ) || p.education?.[1] || {};
  const undergradDeg = (undergradEdu.degreeName || '').toLowerCase();
  const undergradUniStr = (undergradEdu.schoolName || '').toLowerCase();

  // Signal 1: Indian surname
  const surnameMatch = INDIAN_SURNAME_RE.test(fullName);
  // Signal 2: B.Tech from Indian university
  const btechSignal = /b\.?tech|b\.?e\b|bachelor of (engineering|technology)|b\.?sc engg/i.test(undergradDeg)
    && INDIAN_UNI_RE.test(undergradUniStr);
  // Signal 3: ISA/IGSA membership
  const isaSignal = ISA_ORG_RE.test(orgs) || ISA_ORG_RE.test(combinedText);
  // Signal 4: Desi language
  const langSignal = DESI_LANGUAGE_RE.test(languages) || DESI_LANGUAGE_RE.test(summary);
  // Signal 5: India prep services
  const prepSignal = INDIA_PREP_RE.test(combinedText);

  return surnameMatch || btechSignal || isaSignal || langSignal || prepSignal;
}
