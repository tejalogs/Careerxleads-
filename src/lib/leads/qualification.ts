import Anthropic from '@anthropic-ai/sdk';
import { extractSignals } from './signals';
import { calcStruggleScore, assignTier } from './scoring';
import { buildOutreachMessage } from './outreach';
import type { OutreachContext } from './outreach';
import { buildRegionalSuffix } from './regional';
import { isEliteUni, SENIOR_TITLES, LOW_FIELDS } from './patterns';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
const CLAUDE_MODEL = process.env.QUALIFY_MODEL || 'claude-haiku-4-5-20251001';

export function mockScore(p: any): any {
  const signals = extractSignals(p);
  const edu = p.education?.[0] || {};
  const university    = edu.schoolName   || p.university    || '';
  const degree        = edu.degreeName   || p.degree        || '';
  const fieldOfStudy  = edu.fieldOfStudy || p.fieldOfStudy  || '';
  const rawEndDate    = edu.endDate;
  const graduationYear = (typeof rawEndDate === 'object' ? rawEndDate?.text : rawEndDate) || p.graduationYear || '2025';
  const fullName      = p.fullName || p.name || '';
  const headline      = p.headline || '';
  const headlineLower = headline.toLowerCase();

  const {
    indianOriginConfirmed, mastersStudent, jobSearchIntent, relevantField, profileComplete,
    visaStruggle, h1bPanic, h1bResultsPanic, cptSchool, bodyShopExit,
    commentIntent, financialClock, resumeReview, premiumBadge, frustration, skillGap,
    timePressure, networkTrap, networkingScore, regionalTag, uniTier, optDaysRemaining,
  } = signals;

  // Hard reject: elite current university
  if (isEliteUni(university)) {
    return {
      id: p.id || Math.random().toString(36).slice(2, 11),
      qualityScore: 0, tier: 3 as const,
      name: fullName || 'Unknown', linkedinUrl: p.linkedinUrl || '',
      university, degree, fieldOfStudy, graduationYear,
      location: p.location || '', headline, email: p.email || null, phone: p.phone || null,
      socialMediaUrl: null, seekingInternship: false, seekingFullTime: false,
      intentScore: 1 as const, outreachMessage: '', status: 'new',
      reviewFlag: 'review_needed' as const,
      qualityBreakdown: {
        indianOriginConfirmed: false, mastersStudent: false, jobSearchIntent: false,
        relevantField: false, profileComplete: false, nonTier1University: false,
      },
      metadata: p.metadata || undefined,
    };
  }

  const qualityScore = (indianOriginConfirmed ? 3 : 0) + (mastersStudent ? 2 : 0)
    + (jobSearchIntent ? 2 : 0) + (relevantField ? 1 : 0) + (profileComplete ? 1 : 0) + 1;

  const intentScore: 1 | 2 | 3 =
    (cptSchool || h1bPanic || h1bResultsPanic || visaStruggle || commentIntent || (timePressure && jobSearchIntent)) ? 3
    : (frustration || skillGap || bodyShopExit || financialClock || resumeReview || premiumBadge || networkTrap || jobSearchIntent) ? 2
    : 1;

  const struggleScore = calcStruggleScore(signals);
  const tier = assignTier(qualityScore, intentScore, struggleScore);

  const ctx: OutreachContext = {
    firstName: fullName.split(' ')[0] || 'there',
    university, degree, fieldOfStudy, graduationYear,
  };
  const outreachMessage = buildOutreachMessage(ctx, signals);

  return {
    id: p.id || Math.random().toString(36).slice(2, 11),
    name: fullName || 'Unknown',
    linkedinUrl: p.linkedinUrl || '',
    university, degree, fieldOfStudy, graduationYear,
    location: p.location || '',
    headline,
    email: p.email || null,
    phone: p.phone || null,
    socialMediaUrl: p.metadata?.platform === 'GitHub' ? (p.url || null) : null,
    seekingInternship: /intern|cpt\b/i.test(headlineLower),
    seekingFullTime: /full.?time|new grad|recent grad|open to work|actively looking|\bopt\b|ead\b|job hunt/i.test(headlineLower)
      || (headlineLower.includes('seeking') && !/intern|cpt\b/i.test(headlineLower)),
    tier, intentScore, qualityScore, struggleScore,
    universityTier: uniTier,
    networkingScore,
    optDaysRemaining,
    detectedLanguage: regionalTag || undefined,
    regionalTag: regionalTag || undefined,
    outreachMessage,
    status: 'new',
    reviewFlag: qualityScore >= 8 ? 'approved' : 'review_needed',
    qualityBreakdown: { indianOriginConfirmed, mastersStudent, jobSearchIntent, relevantField, profileComplete, nonTier1University: true },
    metadata: p.metadata || undefined,
  };
}

// Hard cap to prevent unbounded API token burn
const MAX_PROFILES = 500;

export async function qualifyProfiles(
  profiles: any[],
  params: any,
  onTokens?: (input: number, output: number) => void,
): Promise<any[]> {
  const capped = profiles.slice(0, MAX_PROFILES);
  if (capped.length < profiles.length) {
    console.warn(`[qualify] Capped from ${profiles.length} to ${MAX_PROFILES} profiles`);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return capped.map(mockScore).filter(l => l.qualityScore >= 6);
  }

  const CHUNK = 100;
  const CONCURRENCY = 3; // Process up to 3 chunks in parallel
  const allLeads: any[] = [];

  const chunks: any[][] = [];
  for (let i = 0; i < capped.length; i += CHUNK) {
    chunks.push(capped.slice(i, i + CHUNK));
  }

  // Process chunks in parallel batches
  for (let b = 0; b < chunks.length; b += CONCURRENCY) {
    const batch = chunks.slice(b, b + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async (chunk) => {
      const phoneMap = new Map(chunk.map((p: any) => [String(p.id), p.phone || null]));

      const prompt = `You are a Lead Qualifier for CareerXcelerator, a platform helping international students land jobs in the US.

TARGET: Origin=${params.originCountry}, Stage=${params.stage}, Fields=${params.fields}, Opportunity=${params.opportunityTypes}

SCORING (max 10):
+3 Indian origin (see 5-signal check below) | +2 Masters student/grad | +2 job/intern intent | +1 relevant field | +1 complete profile | +1 non-elite current university

INDIAN ORIGIN — 5-SIGNAL CHECK (set indianOriginConfirmed=true if ANY fires):
1. SURNAME: Sharma, Patel, Desai, Gupta, Singh, Kumar, Mehta, Joshi, Kapoor, Verma, Reddy, Rao, Iyer, Iyengar, Nair, Pillai, Chandra, Krishna, Agarwal, Malhotra, Bose, Chatterjee, Mukherjee, Banerjee, Das, Ghosh, Sen, Saha, Mishra, Tiwari, Pandey, Yadav, Shukla, Jain, Kulkarni, Deshpande, Patil, Deshmukh, Naidu, Goud, Subramaniam, Venkat, Hegde, Shetty, Menon, Varma, Murthy, Gill, Sidhu, Dhillon, Sandhu, Shah, Modi, Parikh, Bhatt, Trivedi, Mahapatra, Panda, Mohanty (or any clearly Indian surname)
2. B.TECH UNDERGRAD: Education array has a 2nd entry (undergrad) with degree "B.Tech" or "B.E." from any Indian university (Anna University, VTU, JNTU, NIT, VIT, SRM, Manipal, Amity, LPU, Mumbai University, Pune University, etc.)
3. INDIAN LANGUAGE: Languages section lists Hindi, Telugu, Tamil, Marathi, Gujarati, Punjabi, Bengali, Kannada, Malayalam, or Odia
4. ISA/IGSA MEMBERSHIP: Organizations section mentions Indian Student Association, IGSA, ISA, Telugu Association, Tamil Sangam, Gujarati Samaj, Desi club, or similar
5. INDIA PREP SERVICES: Mentions Yocket, LeapScholar, IDP Education, Manya, Jamboree, Gradvine in recommendations or interests

INTENT BOOSTERS (apply within the +2 job/intern intent slot — max still 2):
intentScore=3 if headline/bio/snippet contains ANY of:
  • OPT · F1 · CPT · EAD · "visa sponsorship" · "no sponsorship needed" + actively seeking/internship/full-time
  • OPT/F1/CPT/EAD/STEM Extension/H1B sponsorship explicitly stated
  • Graduating THIS year + actively seeking
  • COMMENT INTENT: "Interested" · "please refer me" · "can anyone refer" · "DM me" · "looking for referral" · "would love to be referred" (person raised hand on a job post — warmest signal)
intentScore=2 if: job-hunt signals — "seeking" · "internship" · "job hunt" · "entry-level" · "new grad" · "struggling" · "no offers" · "please help" — OR skill-gap signals — "upskilling" · "self-taught" · "bootcamp" · "looking for mentorship" · "career switch" · "pivoting" — OR time-pressure — "Graduating May/Dec [year]" · "Incoming Summer/Fall [year]" · "Class of [year]" — OR financial pressure — "immediate joining" · "available immediately" · "financial assistance" · "zero notice period" — OR resume help — "resume review" · "resume feedback" · "not getting interviews" · "ATS" · "roast my resume" — OR LinkedIn Premium badge (paid for career visibility, still seeking)
intentScore=1 otherwise (enrolled student, no active job-hunt or financial-pressure signal)

ICP: International students (especially Indian origin) doing a Masters ABROAD at a non-elite/Tier 2-4 university who struggle to find jobs. We do NOT care where they did their undergrad or which home-country university they attended — only their CURRENT abroad Masters institution matters for the elite check.

University name IS required (for the current Masters). If missing → profileComplete = false (-1 point). Non-elite universities (regional state schools, mid-tier private universities, polytechnics, community colleges with grad programs, etc.) are welcomed — only brand-name elite schools are rejected.

HARD REJECT (omit entirely from the leads array) if ANY of:
- Current university is elite/brand-name: MIT, Stanford, Harvard, CMU, Berkeley, Caltech, Princeton, Yale, Columbia, Cornell, UMich, UCLA, UIUC, Duke, JHU, Northwestern, Georgia Tech, Purdue, UWashington, Dartmouth, Brown, UPenn, Wharton — OR any IIT (IIT Bombay/Delhi/Madras/Kanpur/Kharagpur/Roorkee etc.), IIM, IISc, BITS Pilani — OR Oxford, Cambridge, Imperial, LSE, UCL — OR NUS, NTU, UofT, UBC, Waterloo, McGill, ETH Zurich, EPFL, TU Munich, Peking, Tsinghua
- qualityScore < 6
- Senior title (director, VP, head of, chief, principal, senior manager)
- Irrelevant field
- Missing name or profile URL

For profiles with no education array (Google/GitHub): infer from headline. If can't infer, leave blank — do NOT reject for missing education.

OUTREACH MESSAGE RULES (write a unique message per lead):
- Address by first name only
- Reference ONE specific detail from their headline (e.g. a tech stack, graduation year, internship mention, OPT/CPT, specific role they're targeting, or "open to work" signal)
- Mention their field and university by name
- Keep it 3 sentences max, conversational, not salesy
- End with a soft open question or offer
- Example of BAD (generic): "Hi Priya, I noticed you're pursuing your MS in Data Science at XYZ University. Many international students struggle..."
- Example of GOOD (specific): "Hi Priya, saw you're finishing your MS in Data Science at XYZ this May and actively looking for roles — that final semester job hunt is intense. CareerXcelerator helps students like you go from applications to real offers. Worth a quick chat?"

RAW PROFILES:
${JSON.stringify(chunk)}

RESPOND ONLY WITH VALID JSON:
{"leads":[{"id":"","name":"","linkedinUrl":"","university":"","degree":"","fieldOfStudy":"","graduationYear":"","location":"","headline":"","email":null,"socialMediaUrl":null,"seekingInternship":false,"seekingFullTime":false,"intentScore":2,"qualityScore":8,"outreachMessage":"Hi [First], [specific detail from headline]. CareerXcelerator helps international students go from applications to real offers. [Soft question]?","status":"new","reviewFlag":"approved","qualityBreakdown":{"indianOriginConfirmed":true,"mastersStudent":true,"jobSearchIntent":true,"relevantField":true,"profileComplete":true,"nonTier1University":true}}]}`;

      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        system: 'You are a lead qualification expert. Respond only in valid JSON.',
        messages: [{ role: 'user', content: prompt }],
      });

      if (msg.usage) onTokens?.(msg.usage.input_tokens, msg.usage.output_tokens);
      if (msg.content[0].type !== 'text') throw new Error('Unexpected response shape');
      const raw = msg.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(raw);
      const leads: any[] = Array.isArray(parsed?.leads) ? parsed.leads
        : Array.isArray(parsed) ? parsed
        : (() => { throw new Error(`Claude returned JSON without a leads array: ${raw.slice(0, 120)}`); })();

      const filtered = (leads || []).filter((l: any) => {
        if ((l.qualityScore ?? 0) < 6) return false;
        if (isEliteUni(l.university || '')) return false;
        if (SENIOR_TITLES.some(t => (l.headline || '').toLowerCase().includes(t))) return false;
        if (LOW_FIELDS.some(f => (l.fieldOfStudy || '').toLowerCase().includes(f))) return false;
        if (!l.name || l.name === 'Unknown' || !(l.linkedinUrl || l.url)) return false;
        return true;
      }).map((l: any) => {
        const signals = extractSignals(l);
        const struggleScore = calcStruggleScore(signals);
        const tier = assignTier(l.qualityScore ?? 0, l.intentScore ?? 1, struggleScore);

        // ── Regional suffix injection — fix Claude path bypass ───────────────
        // Claude writes generic outreach; we inject the region-specific personalisation
        // suffix post-hoc if Claude didn't already reference the regional community.
        let outreachMessage = l.outreachMessage || '';
        const regionalSuffix = buildRegionalSuffix(signals.regionalTag, signals.undergradSchool);
        const alreadyPersonalized = signals.regionalTag
          ? outreachMessage.toLowerCase().includes(signals.regionalTag.toLowerCase())
          : true;
        if (!alreadyPersonalized && regionalSuffix) {
          outreachMessage = outreachMessage.trimEnd() + regionalSuffix;
        }

        return {
          ...l,
          phone: l.phone || phoneMap.get(String(l.id)) || null,
          struggleScore,
          universityTier: signals.uniTier,
          networkingScore: signals.networkingScore,
          optDaysRemaining: signals.optDaysRemaining,
          detectedLanguage: signals.regionalTag || undefined,
          regionalTag: signals.regionalTag || undefined,
          outreachMessage,
          tier,
        };
      });

      return filtered;
    }));

    for (let r = 0; r < results.length; r++) {
      const result = results[r];
      if (result.status === 'fulfilled') {
        allLeads.push(...result.value);
      } else {
        // Fallback to local scoring on API failure
        allLeads.push(...batch[r].map(mockScore).filter(l => l.qualityScore >= 6));
      }
    }
  }
  return allLeads;
}
