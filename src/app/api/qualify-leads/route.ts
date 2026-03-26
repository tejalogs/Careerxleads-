import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Lead } from '@/types';
import { requireAuth } from '@/lib/auth';

export const maxDuration = 120; // 2 min — Claude batch qualification

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const CHUNK_SIZE = 15;

// ── Guardrail constants ──────────────────────────────────────────────────────
const SENIOR_TITLES = [
  'director', 'vp', 'vice president', 'head of', 'chief',
  'cto', 'ceo', 'cfo', 'coo', 'principal', 'senior manager'
];
const LOW_RELEVANCE_FIELDS = [
  'history', 'philosophy', 'literature', 'fine arts',
  'art history', 'music', 'theater'
];
const TIER1_UNIVERSITIES = [
  'mit', 'massachusetts institute of technology', 'stanford', 'harvard',
  'carnegie mellon', 'uc berkeley', 'berkeley', 'caltech',
  'california institute of technology', 'princeton', 'yale', 'columbia',
  'cornell', 'university of michigan', 'ucla', 'uiuc',
  'university of illinois', 'duke', 'johns hopkins', 'northwestern',
  'georgia tech', 'georgia institute of technology', 'purdue',
  'university of washington', 'university of southern california', 'penn state'
];

// ── Guardrail helpers ────────────────────────────────────────────────────────
function isExperiencedProfessional(headline: string): boolean {
  const lc = (headline || '').toLowerCase();
  return (
    SENIOR_TITLES.some(t => lc.includes(t)) ||
    /(\d+)\+?\s*years?\s*(of)?\s*(experience|exp)/i.test(headline)
  );
}

function isLowRelevanceField(field: string): boolean {
  const lc = (field || '').toLowerCase();
  return LOW_RELEVANCE_FIELDS.some(f => lc.includes(f));
}

// "Complete" for scoring purposes (all 5 fields present → +1 pt)
function isProfileComplete(lead: any): boolean {
  return !!(
    lead.name && lead.university && lead.fieldOfStudy &&
    lead.graduationYear && lead.linkedinUrl
  );
}

// Minimum viability for NOT being hard-rejected — only name + a profile URL required.
// Education fields are missing on Google/GitHub profiles by design; let the score handle it.
function isMinimallyViable(lead: any): boolean {
  return !!(lead.name && lead.name !== 'Unknown' && (lead.linkedinUrl || lead.url));
}

function isNonTier1University(university: string): boolean {
  const lc = (university || '').toLowerCase();
  return !TIER1_UNIVERSITIES.some(t => lc.includes(t));
}

// ── Mock scorer (used when Anthropic key is absent or chunk fails) ────────────
function computeMockScore(p: any): Lead {
  const education = p.education?.[0] || {};
  const university    = education.schoolName  || p.university    || '';
  const degree        = education.degreeName  || p.degree        || '';
  const fieldOfStudy  = education.fieldOfStudy || p.fieldOfStudy || 'Computer Science';
  const graduationYear = education.endDate    || p.graduationYear || '2025';
  const headline      = (p.headline || '').toLowerCase();
  const fullName      = p.fullName || p.name || '';

  const indianOriginConfirmed = /sharma|patel|desai|gupta|singh|kumar|mehta|joshi|kapoor|verma|reddy|rao|iyer|nair|pillai|chandra|krishna|agarwal|malhotra|bose|chatterjee|mukherjee|banerjee|das|ghosh|sen|saha|basu|dey|roy|mishra|tiwari|pandey|dubey|yadav|shukla|srivastava|tripathi|chauhan|jain|mahajan/i.test(fullName);
  // Check both degree field AND headline/snippet — Google/GitHub profiles carry degree in headline
  const mastersStudent        = /master|ms\b|m\.s\.|mba|m\.b\.a\.|meng|m\.eng|m\.sc/i.test(degree) ||
                                /\bms\b|m\.s\.|master|mba|meng|m\.eng|m\.sc/i.test(headline);
  const jobSearchIntent       = /seeking|looking for|open to|internship|full.?time|job hunt|actively/i.test(headline);
  const relevantField         = !isLowRelevanceField(fieldOfStudy);
  const profileComplete       = isProfileComplete({
    name: fullName, university, fieldOfStudy, graduationYear,
    linkedinUrl: p.url || p.linkedinUrl
  });
  const eliteUniversity       = !isNonTier1University(university); // true = MIT/Stanford/etc.

  const qualityScore =
    (indianOriginConfirmed ? 3 : 0) +
    (mastersStudent        ? 2 : 0) +
    (jobSearchIntent       ? 2 : 0) +
    (relevantField         ? 1 : 0) +
    (profileComplete       ? 1 : 0) +
    (eliteUniversity       ? -2 : 1); // penalty for elite schools (strong pipelines already)

  const intentScore: 1 | 2 | 3 = jobSearchIntent ? 3 : mastersStudent ? 2 : 1;

  return {
    id: p.id || Math.random().toString(36).slice(2, 11),
    name: fullName || 'Unknown',
    linkedinUrl: p.url || p.linkedinUrl || '',
    university,
    degree,
    fieldOfStudy,
    graduationYear,
    location: p.location || '',
    headline: p.headline || '',
    email: p.email || null,
    phone: p.phone || null,
    socialMediaUrl: p.metadata?.platform === 'GitHub' ? (p.url || null) : null,
    seekingInternship: headline.includes('intern'),
    seekingFullTime: (headline.includes('full-time') || headline.includes('full time') ||
                     (headline.includes('seeking') && !headline.includes('intern'))),
    tier: (qualityScore >= 8 && intentScore === 3 ? 1 : qualityScore >= 6 || intentScore >= 2 ? 2 : 3) as 1 | 2 | 3,
    intentScore,
    qualityScore,
    outreachMessage: `Hi ${fullName.split(' ')[0] || 'there'},\n\nI noticed you're pursuing your ${degree || 'MS'} in ${fieldOfStudy} at ${university || 'your university'}. Many international students struggle converting applications to interviews. CareerXcelerator helps students move from role clarity to real job offers.\n\nHappy to share a few insights if helpful!`,
    status: 'new',
    reviewFlag: qualityScore >= 8 ? 'approved' : 'review_needed',
    qualityBreakdown: {
      indianOriginConfirmed,
      mastersStudent,
      jobSearchIntent,
      relevantField,
      profileComplete,
      nonTier1University: !eliteUniversity,
    },
    metadata: p.metadata || undefined,
  };
}

// ── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(chunk: any[], params: any): string {
  return `You are a Lead Qualifier for CareerXcelerator, a platform helping international students land jobs in the US.

TARGET CRITERIA:
- Origin Country: ${params.originCountry}
- Stage: ${params.stage}
- Fields: ${params.fields}
- Opportunity Types: ${params.opportunityTypes}

SCORING SYSTEM (max 10 points):
- +3 if origin matches ${params.originCountry} (name patterns, prior education in that country, or explicit mention)
- +2 if currently a Masters student or recent Masters/MBA graduate
- +2 if headline shows job/internship intent ("seeking", "open to work", "looking for", "actively searching")
- +1 if field is relevant to: ${params.fields}
- +1 if profile is complete (has name, university, field, graduation year, and a profile URL)
- +1 if university is NOT a tier-1 school (MIT, Stanford, Harvard, Carnegie Mellon, Berkeley, Caltech, Princeton, Yale, Columbia, Cornell, Michigan, UCLA, UIUC, Duke, Johns Hopkins, Northwestern, Georgia Tech)

INTENT SCORE (1–3):
- 3: Actively seeking ("seeking internship", "open to work", "looking for opportunities", "job hunting")
- 2: Student with unclear or no job signals
- 1: Early stage student or clearly does not fit ICP

EDUCATION EXTRACTION:
Profiles from LinkedIn have an "education" array — use education[0] (most recent):
- university → education[0].schoolName
- degree → education[0].degreeName (e.g. "Master of Science")
- fieldOfStudy → education[0].fieldOfStudy
- graduationYear → education[0].endDate

Profiles from Google/GitHub often have NO education array. For these, infer from the headline/snippet:
- "MS Data Science @ NYU" → degree="MS", fieldOfStudy="Data Science", university="NYU"
- "MBA Candidate at Boston University" → degree="MBA", university="Boston University"
- "Software Engineer | MS CS @ Georgia Tech" → degree="MS", fieldOfStudy="Computer Science", university="Georgia Tech"
- If education cannot be inferred, leave university/degree/fieldOfStudy as empty strings — do NOT reject the profile for this reason.

REJECT (do not include in output) any profile where:
- qualityScore < 6
- headline contains senior titles (director, VP, head of, chief, CTO, CEO, principal, senior manager, or X+ years experience)
- fieldOfStudy is clearly irrelevant (history, philosophy, literature, fine arts, music, theater)
- name is missing or clearly a username (e.g. "u/username", "Unknown")

RAW PROFILES:
${JSON.stringify(chunk)}

RESPOND ONLY WITH THIS EXACT JSON (no markdown, no explanation):
{
  "leads": [
    {
      "id": "original-id-from-profile",
      "name": "Full Name",
      "linkedinUrl": "LinkedIn or profile URL",
      "university": "University Name",
      "degree": "MS / MBA / BS / etc",
      "fieldOfStudy": "Computer Science",
      "graduationYear": "2025",
      "location": "City, State",
      "headline": "Original headline text",
      "email": "email@example.com or null",
      "socialMediaUrl": "GitHub/Twitter/Instagram URL or null",
      "seekingInternship": true,
      "seekingFullTime": false,
      "intentScore": 3,
      "qualityScore": 8,
      "outreachMessage": "Hi [First Name], I noticed you're pursuing your [Degree] in [Field] at [University]. Many international students struggle converting applications to interviews. CareerXcelerator helps students move from role clarity to real job offers. Happy to share a few insights if helpful!",
      "status": "new",
      "reviewFlag": "approved",
      "qualityBreakdown": {
        "indianOriginConfirmed": true,
        "mastersStudent": true,
        "jobSearchIntent": true,
        "relevantField": true,
        "profileComplete": true,
        "nonTier1University": true
      }
    }
  ]
}`;
}

export async function POST(req: Request) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const { profiles, params } = await req.json();
    const scrapedCount = (profiles || []).length;

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ leads: [], scrapedCount: 0, qualifiedCount: 0, rejectedCount: 0 });
    }

    // Build metadata map so we can restore platform/actor info after Claude strips it
    const profileMetaMap: Record<string, unknown> = {};
    profiles.forEach((p: any) => { if (p.id) profileMetaMap[p.id] = p.metadata; });

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === '') {
      const mockResult = profiles.map(computeMockScore).filter((l: Lead) => l.qualityScore >= 6);
      return NextResponse.json({
        leads: mockResult,
        isMock: true,
        mockReason: 'ANTHROPIC_API_KEY is not set — scored locally',
        scrapedCount,
        qualifiedCount: mockResult.length,
        rejectedCount: scrapedCount - mockResult.length,
      });
    }

    const allLeads: Lead[] = [];
    let mockedChunks = 0;

    for (let i = 0; i < profiles.length; i += CHUNK_SIZE) {
      const chunk = profiles.slice(i, i + CHUNK_SIZE);

      try {
        const msg = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 8192,
          system: 'You are a lead qualification expert. Respond only in valid JSON.',
          messages: [{ role: 'user', content: buildPrompt(chunk, params) }],
        });

        if (!msg.content?.length || msg.content[0].type !== 'text') {
          console.error(`Chunk ${i / CHUNK_SIZE + 1}: unexpected response shape`);
          mockedChunks++;
          allLeads.push(...chunk.map(computeMockScore).filter((l: Lead) => l.qualityScore >= 6));
          continue;
        }

        const raw = msg.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();

        let data: any;
        try {
          data = JSON.parse(raw);
        } catch {
          console.error(`Chunk ${i / CHUNK_SIZE + 1}: Claude returned malformed JSON`);
          mockedChunks++;
          allLeads.push(...chunk.map(computeMockScore).filter((l: Lead) => l.qualityScore >= 6));
          continue;
        }

        const preFilterCount = (data.leads || []).length;
        const filtered = (data.leads || []).filter((l: any) => {
          if ((l.qualityScore ?? 0) < 6) { console.log(`[qualify] Rejected "${l.name}" — qualityScore ${l.qualityScore} < 6`); return false; }
          if (isExperiencedProfessional(l.headline)) { console.log(`[qualify] Rejected "${l.name}" — senior professional`); return false; }
          if (isLowRelevanceField(l.fieldOfStudy))   { console.log(`[qualify] Rejected "${l.name}" — low-relevance field: ${l.fieldOfStudy}`); return false; }
          if (!isMinimallyViable(l))                 { console.log(`[qualify] Rejected "${l.name}" — no name or profile URL`); return false; }
          return true;
        });

        // Restore metadata from original profiles — Claude strips unknown fields
        const leadsWithMeta = filtered.map((l: any) => ({
          ...l,
          metadata: profileMetaMap[l.id] || undefined,
        }));

        console.log(`[qualify] Chunk ${i / CHUNK_SIZE + 1}: ${preFilterCount} from Claude → ${leadsWithMeta.length} after guardrails`);
        allLeads.push(...leadsWithMeta);

      } catch (chunkError: any) {
        console.error(`Chunk ${i / CHUNK_SIZE + 1} failed:`, chunkError.message);
        mockedChunks++;
        allLeads.push(...chunk.map(computeMockScore).filter((l: Lead) => l.qualityScore >= 6));
      }
    }

    return NextResponse.json({
      leads: allLeads,
      scrapedCount,
      qualifiedCount: allLeads.length,
      rejectedCount: scrapedCount - allLeads.length,
      ...(mockedChunks > 0 && { partialMock: true, mockReason: `${mockedChunks} chunk(s) fell back to local scoring` }),
    });

  } catch (error: any) {
    console.error('Critical qualify error:', error);
    return NextResponse.json({ error: 'Failed to qualify leads', details: error.message }, { status: 500 });
  }
}
