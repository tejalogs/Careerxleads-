import { SENIOR_TITLES, LOW_FIELDS, isEliteUni } from './patterns';
import { checkIndianOrigin } from './origin';

export interface RejectionAnalysis {
  breakdown: Record<string, number>;
  topUniversities: [string, number][];
  topFields: [string, number][];
  dominantReason: string;
  adaptationHint: string;
}

export function analyzeRejections(rawProfiles: any[], qualifiedLeads: any[]): RejectionAnalysis {
  const qualifiedIds = new Set(qualifiedLeads.map((l: any) => l.id));
  const breakdown: Record<string, number> = {
    seniorTitle: 0, irrelevantField: 0, missingProfile: 0,
    missingEducation: 0, notMasters: 0, eliteUniversity: 0,
    wrongOrigin: 0, tooLowScore: 0,
  };
  const uniCounts: Record<string, number>   = {};
  const fieldCounts: Record<string, number> = {};

  for (const p of rawProfiles) {
    const edu      = p.education?.[0] || {};
    const uni      = edu.schoolName || p.university || '';
    const field    = edu.fieldOfStudy || p.fieldOfStudy || '';
    const degree   = edu.degreeName || edu.degree || p.degree || '';
    const headline = (p.headline || p.summary || '').toLowerCase();
    const name     = p.fullName || p.name || '';

    if (qualifiedIds.has(p.id)) {
      if (uni)   uniCounts[uni]     = (uniCounts[uni]     || 0) + 1;
      if (field) fieldCounts[field] = (fieldCounts[field] || 0) + 1;
      continue;
    }

    if (SENIOR_TITLES.some(t => headline.includes(t)))                           { breakdown.seniorTitle++;     continue; }
    if (LOW_FIELDS.some(f => field.toLowerCase().includes(f)))                   { breakdown.irrelevantField++; continue; }
    if (!name || name === 'Unknown' || !p.linkedinUrl)                           { breakdown.missingProfile++;  continue; }
    const hasEnoughEdu = !!(edu.schoolName || edu.degree || edu.fieldOfStudy || p.university);
    if (!hasEnoughEdu)                                                           { breakdown.missingEducation++; continue; }
    const isMasters = /master|ms\b|m\.s\.|mba|meng|m\.sc/i.test(degree)
                   || /\bms\b|m\.s\.|master|mba|meng/i.test(headline);
    if (!isMasters)                                                              { breakdown.notMasters++;      continue; }
    if (isEliteUni(uni))                                                         { breakdown.eliteUniversity++; continue; }
    // Origin check — uses same 5-signal function as qualification
    if (!checkIndianOrigin(p))                                                   { breakdown.wrongOrigin++;     continue; }
    breakdown.tooLowScore++;
  }

  const topUniversities = Object.entries(uniCounts).sort(([, a], [, b]) => b - a).slice(0, 5) as [string, number][];
  const topFields       = Object.entries(fieldCounts).sort(([, a], [, b]) => b - a).slice(0, 4) as [string, number][];

  const dominantEntry  = Object.entries(breakdown).sort(([, a], [, b]) => b - a)[0];
  const dominantReason = dominantEntry?.[0] ?? 'tooLowScore';

  const HINTS: Record<string, string> = {
    wrongOrigin:      'Add origin country explicitly — e.g. "India" "Indian" or common Indian surnames to queries',
    notMasters:       'Tighten degree filter — add "MS" "Master of Science" "graduate student" to queries',
    missingEducation: 'Profiles lack education data — try more specific university name queries or use google dork with "university" keyword',
    eliteUniversity:  'Too many elite university profiles — drop prestige keywords; target regional state schools, mid-tier private universities, polytechnics',
    missingProfile:   'Profiles lack URL or name — try longer takePages or a different searchQuery',
    seniorTitle:      'Too many senior professionals — add "student" "2025" "recent grad" to exclude experienced hires',
    irrelevantField:  'Wrong field of study — narrow queries to specific relevant fields like "Computer Science" "Data Science" "Engineering"',
    tooLowScore:      'Profiles match demographics but lack intent signals — add "seeking" "internship" "open to work" "actively looking"',
  };
  const adaptationHint = HINTS[dominantReason] ?? 'Rewrite queries with more specific intent and degree signals';

  return { breakdown, topUniversities, topFields, dominantReason, adaptationHint };
}

export function formatRejectionFeedback(raw: any[], qualified: any[], scraped: number): string {
  const analysis = analyzeRejections(raw, qualified);
  const rejected = scraped - qualified.length;
  if (rejected === 0) return '';
  const parts = Object.entries(analysis.breakdown)
    .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 4)
    .map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(' | ');
  const unis   = analysis.topUniversities.map(([u, n]) => `${u.length > 30 ? u.slice(0, 28) + '…' : u} (${n})`).join(', ');
  const fields = analysis.topFields.map(([f, n]) => `${f} (${n})`).join(', ');
  return [
    `REJECTED ${rejected}: ${parts || 'various reasons'}`,
    unis   ? `QUALIFIED universities: ${unis}` : '',
    fields ? `QUALIFIED fields: ${fields}` : '',
    `→ ADAPT: ${analysis.adaptationHint}`,
  ].filter(Boolean).join('\n');
}
