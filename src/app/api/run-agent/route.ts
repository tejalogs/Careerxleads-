import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';

export const maxDuration = 300; // 5 min — Vercel/Next.js serverless limit

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const APIFY_TOKEN  = process.env.APIFY_API_TOKEN || '';
const APIFY_BASE   = 'https://api.apify.com/v2';

// ── Types ─────────────────────────────────────────────────────────────────────
type SendEvent = (event: string, data: unknown) => void;

// ── Mock data (when APIFY_TOKEN absent) ───────────────────────────────────────
const MOCK_PROFILES = Array.from({ length: 45 }).map((_, i) => ({
  id: `mock-${i}`,
  fullName: ['Priya Sharma', 'Rahul Desai', 'Anita Patel', 'Vikram Singh', 'Neha Gupta'][i % 5],
  url: `https://linkedin.com/in/mock-profile-${i}`,
  headline: ['MS Data Science @ NYU | Seeking Summer Internship 2025', 'MBA Candidate at Boston University', 'Incoming SWE Intern @ Google | MS CS Georgia Tech', 'Data Analyst | MS Business Analytics', 'Software Engineer @ Amazon | MS CS USC'][i % 5],
  location: ['New York, NY', 'Boston, MA', 'Atlanta, GA', 'San Francisco, CA', 'Seattle, WA'][i % 5],
  education: [
    { schoolName: ['New York University', 'Boston University', 'Georgia Tech', 'UT Dallas', 'USC'][i % 5], degreeName: 'Master of Science', fieldOfStudy: ['Data Science', 'MBA', 'Computer Science', 'Business Analytics', 'Computer Science'][i % 5], endDate: '2025' },
    { schoolName: 'University of Mumbai', degreeName: 'Bachelor of Engineering', fieldOfStudy: 'Computer Engineering', endDate: '2022' },
  ],
  email: i % 3 === 0 ? `mock${i}@example.com` : null,
  metadata: { platform: 'LinkedIn', actor: 'mock' },
}));

// ── Apify helpers ─────────────────────────────────────────────────────────────
async function apifyPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${APIFY_BASE}${path}?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Apify POST ${path}: HTTP ${res.status} — ${JSON.stringify(data).replace(/token=[^&"'\s]*/gi, 'token=***').slice(0, 200)}`);
  return data;
}

async function apifyGet(path: string): Promise<any> {
  const res = await fetch(`${APIFY_BASE}${path}?token=${APIFY_TOKEN}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Apify GET ${path}: HTTP ${res.status}`);
  return data;
}

async function apifyGetItems(datasetId: string, limit: number): Promise<any[]> {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=${limit}`);
  if (!res.ok) throw new Error(`Dataset fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function startActorRun(actorId: string, input: unknown): Promise<{ runId: string; datasetId: string }> {
  const { data } = await apifyPost(`/acts/${actorId.replace('/', '~')}/runs`, input);
  return { runId: data.id, datasetId: data.defaultDatasetId };
}

async function pollRun(actorId: string, runId: string, datasetId: string, limit: number, send: SendEvent): Promise<any[]> {
  const start = Date.now();
  const TIMEOUT = 180_000;
  while (Date.now() - start < TIMEOUT) {
    await new Promise(r => setTimeout(r, 5000));
    const { data: { status } } = await apifyGet(`/actor-runs/${runId}`);
    const elapsed = Math.round((Date.now() - start) / 1000);
    send('progress', { message: `${actorId} → ${status} (${elapsed}s)` });
    if (status === 'SUCCEEDED') return apifyGetItems(datasetId, limit);
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) throw new Error(`${actorId} run ended with: ${status}`);
    const partial = await apifyGetItems(datasetId, limit);
    if (partial.length >= limit) { send('progress', { message: `${actorId} → early exit (${partial.length} items)` }); return partial; }
  }
  throw new Error(`${actorId} timed out after ${TIMEOUT / 1000}s`);
}

// ── Normalizers ───────────────────────────────────────────────────────────────
function normalizeLinkedIn(item: any, idx: number, actor: string): any {
  // Both actors return firstName + lastName separately (no fullName field)
  const fullName = item.fullName || item.name ||
    [item.firstName, item.lastName].filter(Boolean).join(' ') || 'Unknown';

  // Step 1 (search) → 'summary' field. Step 2 (scraper) → 'headline' field.
  const headline = item.headline || item.summary || '';

  // location: Step 2 returns location.linkedinText or string
  const location = typeof item.location === 'string'
    ? item.location
    : (item.location?.linkedinText || item.locationName || '');

  // education: scraper uses 'degree' not 'degreeName', endDate is {text: "YYYY"} object
  const education = Array.isArray(item.education) ? item.education.map((e: any) => ({
    schoolName: e.schoolName || e.school || '',
    degreeName: e.degreeName || e.degree || '',
    fieldOfStudy: e.fieldOfStudy || e.field || '',
    endDate: typeof e.endDate === 'object'
      ? (e.endDate?.text || e.endDate?.year?.toString() || '')
      : (e.endDate || e.timePeriod?.endDate?.year?.toString() || ''),
  })) : [];

  return {
    id: item.id || item.profileId || `li-${idx}`,
    fullName,
    linkedinUrl: item.linkedinUrl || item.profileUrl || item.url || '',
    headline,
    location,
    education,
    email: item.email || null,
    metadata: { platform: 'LinkedIn', actor },
  };
}

function extractEdu(text: string) {
  if (!text) return null;

  // Degree
  const deg = text.match(/\b(MS|M\.S\.|MBA|M\.B\.A\.|MEng|M\.Eng|MTech|M\.Tech|M\.Sc|MSc|Master(?:s)?(?:\s+of\s+\w+)?(?:\s+in)?|MCS|MSCS|MSDS|MS-CS)\b/i);

  // Field of study
  const fld = text.match(/(?:in|of)\s+([A-Za-z][a-zA-Z\s&\/]{2,35})(?:\s+[@|at]|\s*[-|·,]|\s+\d{4}|$)/i);

  // University — tried in order of specificity
  let uniMatch: string | null = null;

  // 1) "@ SomeName" — covers @ NYU, @ IIT Bombay, @ Georgia Tech, @ BITS Pilani
  const atSymbol = text.match(/@\s*([A-Z][A-Za-z.\s]{1,50})(?:\s*[|·\-,]|$)/);
  if (atSymbol) uniMatch = atSymbol[1].trim();

  // 2) "at University Name" (word boundary)
  if (!uniMatch) {
    const atWord = text.match(/\bat\s+([A-Z][A-Za-z.\s&]{3,50})(?:\s*[|·\-,\d]|$)/);
    if (atWord) uniMatch = atWord[1].trim();
  }

  // 3) Indian institutional prefixes: IIT, NIT, BITS, IIM, IIIT, IISC
  if (!uniMatch) {
    const indian = text.match(/\b(IIT[\s\-]\w+|NIT[\s\-]\w+|BITS[\s\-]\w+|IIM[\s\-]\w+|IIIT[\s\-]\w+|IISc)\b/i);
    if (indian) uniMatch = indian[1].trim();
  }

  // 4) "X University" / "University of X" / "X Institute" / "X College" / "X School of"
  if (!uniMatch) {
    const std = text.match(/([A-Z][a-zA-Z\s&]+(?:University|Institute of Technology|College|School|Academy)|University\s+of\s+[A-Z][a-zA-Z\s]+)/);
    if (std) uniMatch = std[1].trim();
  }

  // 5) Common US/global abbreviations not caught above
  if (!uniMatch) {
    const abbrev = text.match(/\b(NYU|USC|ASU|PSU|UT(?:\s+\w+)?|SMU|GMU|GWU|VCU|LSU|FSU|OSU|UMass(?:\s+\w+)?|UConn|UVA|UNC|UIUC|NJIT|RIT|WPI|NEU|BU|UBC|UofT|NUS|NTU)\b/);
    if (abbrev) uniMatch = abbrev[1].trim();
  }

  const yr = text.match(/\b(202[3-9]|203\d)\b/);
  if (!deg) return null;
  return { schoolName: uniMatch || '', degreeName: deg[0], fieldOfStudy: fld?.[1]?.trim() || '', endDate: yr?.[0] || '' };
}

function normalizeGoogle(item: any, idx: number, actor: string): any {
  const url  = item.url || item.link || '';
  const snip = item.description || item.snippet || '';
  const title = item.title || '';
  const name = url.includes('linkedin.com/in/') ? title.replace(/\s*[-|].*$/i, '').trim() : (title || 'Unknown');
  const edu = extractEdu(`${title} ${snip}`);
  return { id: item.id || `goog-${idx}`, fullName: name, linkedinUrl: url, headline: snip || title, location: '', education: edu ? [edu] : [], email: null, metadata: { platform: 'Google', actor, snippet: snip } };
}

function normalizeGitHub(item: any, idx: number, actor: string): any {
  return { id: item.id?.toString() || `gh-${idx}`, fullName: item.name || item.login || 'Unknown', linkedinUrl: item.url || `https://github.com/${item.login}`, headline: item.bio || '', location: item.location || '', education: [], email: item.email || null, metadata: { platform: 'GitHub', actor, repos: item.publicRepos || 0 } };
}

function normalizeReddit(item: any, idx: number, actor: string): any {
  const author = item.author || '';
  const nameMatch = (item.title || '').match(/(?:I(?:'m| am)\s+)([A-Z][a-z]+ [A-Z][a-z]+)/);
  const fullName = nameMatch ? nameMatch[1] : (author.includes(' ') ? author : '');
  return { id: item.id || `rd-${idx}`, fullName: fullName || 'Unknown', linkedinUrl: item.url || item.permalink || '', headline: [item.title, item.body?.slice(0, 200)].filter(Boolean).join(' — '), location: '', education: [], email: null, metadata: { platform: 'Reddit', actor, subreddit: item.subreddit || '', redditAuthor: author } };
}

// ── Platform runners ──────────────────────────────────────────────────────────
async function runLinkedIn(queries: string[], limit: number, send: SendEvent): Promise<any[]> {
  if (!APIFY_TOKEN) return MOCK_PROFILES.slice(0, limit);

  // Step 1 — Discovery: one actor run per query (actor only accepts singular searchQuery)
  send('progress', { message: `LinkedIn: Step 1/2 — searching ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} in parallel…` });

  const perQuery = Math.max(5, Math.ceil((limit * 2) / queries.length));
  const takePages = Math.max(1, Math.ceil(perQuery / 25));

  const step1Runs = await Promise.all(queries.map(q =>
    startActorRun('harvestapi/linkedin-profile-search', {
      searchQuery: q,          // singular string — actor requires this, not a queries array
      maxItems: perQuery,
      takePages,
      profileScraperMode: 'Short',
      proxyConfiguration: { useApifyProxy: true },
    })
  ));

  // Poll all step-1 runs in parallel
  const step1Results = await Promise.all(
    step1Runs.map(({ runId, datasetId }) =>
      pollRun('harvestapi/linkedin-profile-search', runId, datasetId, perQuery, send)
        .catch(() => [] as any[]) // don't let one failure kill all queries
    )
  );

  const allRaw1 = step1Results.flat();
  const discovery = allRaw1.map((item, i) => normalizeLinkedIn(item, i, 'harvestapi/linkedin-profile-search'));
  const urls = [...new Set(
    discovery.map(p => p.url).filter((u): u is string => !!u && u.includes('linkedin.com/in/'))
  )];

  send('progress', { message: `LinkedIn: ${discovery.length} discovered (${urls.length} unique URLs). Step 2/2 — full scrape for education…` });

  if (urls.length === 0) return discovery.slice(0, limit);

  // Step 2 — Full scrape with education data
  try {
    const { runId: r2, datasetId: d2 } = await startActorRun('harvestapi/linkedin-profile-scraper', {
      urls: urls.slice(0, limit),
      maxItems: limit,
      proxyConfiguration: { useApifyProxy: true },
    });
    const raw2 = await pollRun('harvestapi/linkedin-profile-scraper', r2, d2, limit, send);
    if (raw2.length === 0) throw new Error('Scraper returned 0 items');
    const full = raw2.map((item, i) => normalizeLinkedIn(item, i, 'harvestapi/linkedin-profile-scraper'));
    send('progress', { message: `LinkedIn: ${full.length} full profiles with education ready.` });
    return full;
  } catch (err: any) {
    send('progress', { message: `LinkedIn full-scrape fallback (${err.message}) — using discovery profiles.` });
    return discovery.slice(0, limit);
  }
}

async function runGoogle(queries: string[], limit: number, send: SendEvent): Promise<any[]> {
  if (!APIFY_TOKEN) return [];
  send('progress', { message: 'Google: Running LinkedIn dork queries…' });
  const rpp = Math.ceil(limit / queries.length);
  const { runId, datasetId } = await startActorRun('apify/google-search-scraper', {
    queries: queries.join('\n'),
    maxPagesPerQuery: Math.max(1, Math.ceil(rpp / 10)),
    resultsPerPage: 10,
    countryCode: 'us',
    languageCode: 'en',
  });
  const items = await pollRun('apify/google-search-scraper', runId, datasetId, limit, send);
  return items.map((item, i) => normalizeGoogle(item, i, 'apify/google-search-scraper'));
}

async function runGitHub(queries: string[], limit: number, send: SendEvent): Promise<any[]> {
  if (!APIFY_TOKEN) return [];
  send('progress', { message: 'GitHub: Searching tech profiles…' });
  const { runId, datasetId } = await startActorRun('dtrungtin/github-users-scraper', {
    q: queries[0] || 'location:"United States" language:Python followers:>5',
    maxItems: limit,
  });
  const items = await pollRun('dtrungtin/github-users-scraper', runId, datasetId, limit, send);
  return items.map((item, i) => normalizeGitHub(item, i, 'dtrungtin/github-users-scraper'));
}

async function runReddit(queries: string[], limit: number, send: SendEvent): Promise<any[]> {
  if (!APIFY_TOKEN) return [];
  send('progress', { message: 'Reddit: Searching career forums…' });
  const { runId, datasetId } = await startActorRun('trudax/reddit-scraper', {
    searches: queries.slice(0, 4),
    maxItems: limit,
  });
  const items = await pollRun('trudax/reddit-scraper', runId, datasetId, limit, send);
  return items.map((item, i) => normalizeReddit(item, i, 'trudax/reddit-scraper'));
}

// ── Tier assignment ───────────────────────────────────────────────────────────
function assignTier(qualityScore: number, intentScore: number): 1 | 2 | 3 {
  if (qualityScore >= 8 && intentScore === 3) return 1;
  if (qualityScore >= 6 || intentScore >= 2)  return 2;
  return 3;
}

// ── Qualification ─────────────────────────────────────────────────────────────
const SENIOR_TITLES = ['director', 'vp', 'vice president', 'head of', 'chief', 'cto', 'ceo', 'principal', 'senior manager'];
const LOW_FIELDS    = ['history', 'philosophy', 'literature', 'fine arts', 'art history', 'music', 'theater'];

// Elite/brand-name universities — leads from these are HARD REJECTED (outside ICP).
// CareerX's ICP is students from non-elite schools who genuinely struggle to land jobs.
// Grads from these institutions have strong on-campus recruiting pipelines already.
const ELITE_UNIS = new Set([
  // ── USA ──
  'mit', 'massachusetts institute of technology',
  'stanford', 'stanford university',
  'harvard', 'harvard university',
  'carnegie mellon', 'carnegie mellon university', 'cmu',
  'uc berkeley', 'university of california berkeley', 'berkeley',
  'caltech', 'california institute of technology',
  'princeton', 'princeton university',
  'yale', 'yale university',
  'columbia', 'columbia university',
  'cornell', 'cornell university',
  'university of michigan', 'umich',
  'ucla', 'university of california los angeles',
  'uiuc', 'university of illinois', 'illinois urbana',
  'duke', 'duke university',
  'johns hopkins', 'jhu',
  'northwestern', 'northwestern university',
  'georgia tech', 'georgia institute of technology',
  'purdue', 'purdue university',
  'university of washington',
  'dartmouth', 'dartmouth college',
  'brown university',
  'university of pennsylvania', 'upenn', 'wharton',
  'rice university',
  'vanderbilt university',
  'emory university',
  'university of notre dame',
  'washington university in st louis', 'wustl',
  'university of virginia', 'uva',
  'university of north carolina', 'unc chapel hill',
  'university of southern california', 'usc viterbi',
  // ── India (IITs, IIMs, IISc, BITS) ──
  'indian institute of technology',
  'iit bombay', 'iit delhi', 'iit madras', 'iit kanpur', 'iit kharagpur',
  'iit roorkee', 'iit guwahati', 'iit hyderabad', 'iit gandhinagar', 'iit bhu',
  'iit jodhpur', 'iit patna', 'iit mandi', 'iit tirupati', 'iit palakkad',
  'iit dharwad', 'iit bhilai', 'iit jammu', 'iit indore', 'iit varanasi',
  'iisc', 'indian institute of science',
  'indian institute of management', 'iim ahmedabad', 'iim bangalore',
  'iim calcutta', 'iim kozhikode', 'iim lucknow', 'iim indore', 'iim shillong',
  'bits pilani', 'bits goa', 'bits hyderabad',
  // ── UK ──
  'university of oxford', 'oxford university',
  'university of cambridge', 'cambridge university',
  'imperial college', 'imperial college london',
  'london school of economics', 'lse',
  'ucl', 'university college london',
  // ── Canada ──
  'university of toronto', 'u of toronto',
  'university of british columbia', 'ubc',
  'university of waterloo',
  'mcgill', 'mcgill university',
  // ── Singapore ──
  'national university of singapore', 'nus',
  'nanyang technological university', 'ntu singapore',
  // ── Australia ──
  'university of melbourne',
  'university of sydney',
  'unsw', 'university of new south wales',
  'australian national university', 'anu',
  // ── Germany ──
  'tu munich', 'technical university of munich', 'tum',
  'lmu munich', 'ludwig maximilian university',
  'rwth aachen',
  // ── Switzerland ──
  'eth zurich', 'epfl',
  // ── China ──
  'peking university', 'pku',
  'tsinghua', 'tsinghua university',
  // ── Hong Kong ──
  'hkust', 'hong kong university of science and technology',
]);

/** Returns true if the university name matches any entry in ELITE_UNIS */
function isEliteUni(university: string): boolean {
  const u = university.toLowerCase().trim();
  if (!u) return false;
  if (ELITE_UNIS.has(u)) return true;
  // Substring check — catches "IIT Bombay, India" matching "iit bombay", etc.
  // Only apply for entries ≥7 chars to avoid false positives from short tokens.
  return Array.from(ELITE_UNIS).some(e => e.length >= 7 && u.includes(e));
}

function mockScore(p: any): any {
  const edu = p.education?.[0] || {};
  const university    = edu.schoolName   || p.university    || '';
  const degree        = edu.degreeName   || p.degree        || '';
  const fieldOfStudy  = edu.fieldOfStudy || p.fieldOfStudy  || '';
  const rawEndDate     = edu.endDate;
  const graduationYear = (typeof rawEndDate === 'object' ? rawEndDate?.text : rawEndDate) || p.graduationYear || '2025';
  const headline      = (p.headline || '').toLowerCase();
  const fullName      = p.fullName || p.name || '';

  const indianOriginConfirmed = /sharma|patel|desai|gupta|singh|kumar|mehta|joshi|kapoor|verma|reddy|rao|iyer|nair|pillai|chandra|krishna|agarwal|malhotra|bose|chatterjee|mukherjee|banerjee|das|ghosh|sen|saha|basu|dey|roy|mishra|tiwari|pandey|dubey|yadav|shukla|srivastava|tripathi|chauhan|jain|mahajan/i.test(fullName);
  const mastersStudent        = /master|ms\b|m\.s\.|mba|m\.b\.a\.|meng|m\.eng|m\.sc/i.test(degree) || /\bms\b|m\.s\.|master|mba|meng|m\.eng|m\.sc/i.test(headline);
  const jobSearchIntent       = /seeking|looking for|open to|internship|full.?time|job hunt|actively/i.test(headline);
  const relevantField         = !LOW_FIELDS.some(f => fieldOfStudy.toLowerCase().includes(f));
  // For Indian students studying IN India, university name is optional —
  // India has 1000+ institutions and our extractor won't recognise most of them.
  // For students studying abroad (any nationality), university name is required so
  // we can verify it is not elite.
  const locationStr = (p.location || '').toLowerCase();
  const studyingInIndia = /\bindia\b|mumbai|delhi|bangalore|bengaluru|chennai|hyderabad|kolkata|pune|ahmedabad|jaipur|surat|lucknow|kanpur|nagpur|indore|bhopal|patna|coimbatore|kochi|vizag|noida|gurgaon/i.test(locationStr) || (!locationStr && indianOriginConfirmed && !university);
  const profileComplete = (indianOriginConfirmed && studyingInIndia)
    ? !!(fullName && fieldOfStudy && p.linkedinUrl)
    : !!(fullName && university && fieldOfStudy && graduationYear && p.linkedinUrl);
  // Hard reject: elite university leads are outside ICP — they already have strong pipelines
  if (isEliteUni(university)) {
    return { id: p.id || Math.random().toString(36).slice(2, 11), qualityScore: 0, tier: 3 as const, name: fullName || 'Unknown', linkedinUrl: p.linkedinUrl || '', university, degree, fieldOfStudy, graduationYear, location: p.location || '', headline: p.headline || '', email: p.email || null, socialMediaUrl: null, seekingInternship: false, seekingFullTime: false, intentScore: 1 as const, outreachMessage: '', status: 'new', reviewFlag: 'review_needed' as const, qualityBreakdown: { indianOriginConfirmed: false, mastersStudent: false, jobSearchIntent: false, relevantField: false, profileComplete: false, nonTier1University: false }, metadata: p.metadata || undefined };
  }
  const qualityScore = (indianOriginConfirmed ? 3 : 0) + (mastersStudent ? 2 : 0) + (jobSearchIntent ? 2 : 0) + (relevantField ? 1 : 0) + (profileComplete ? 1 : 0) + 1; // +1 non-elite bonus (always, since elite is hard-rejected above)
  const intentScore: 1 | 2 | 3 = jobSearchIntent ? 3 : mastersStudent ? 2 : 1;
  const tier = assignTier(qualityScore, intentScore);

  return {
    id: p.id || Math.random().toString(36).slice(2, 11),
    name: fullName || 'Unknown',
    linkedinUrl: p.linkedinUrl || '',
    university, degree, fieldOfStudy, graduationYear,
    location: p.location || '',
    headline: p.headline || '',
    email: p.email || null,
    socialMediaUrl: p.metadata?.platform === 'GitHub' ? (p.url || null) : null,
    seekingInternship: headline.includes('intern'),
    seekingFullTime: headline.includes('full-time') || headline.includes('full time') || (headline.includes('seeking') && !headline.includes('intern')),
    tier,
    intentScore,
    qualityScore,
    outreachMessage: `Hi ${(fullName.split(' ')[0]) || 'there'},\n\nI noticed you're pursuing your ${degree || 'MS'} in ${fieldOfStudy} at ${university || 'your university'}. Many international students struggle converting applications to interviews. CareerXcelerator helps students move from role clarity to real job offers.\n\nHappy to share a few insights if helpful!`,
    status: 'new',
    reviewFlag: qualityScore >= 8 ? 'approved' : 'review_needed',
    qualityBreakdown: { indianOriginConfirmed, mastersStudent, jobSearchIntent, relevantField, profileComplete, nonTier1University: true },
    metadata: p.metadata || undefined,
  };
}

// ── Rejection analysis — tells Claude WHY profiles failed so it can adapt queries ─────
interface RejectionAnalysis {
  breakdown: Record<string, number>;
  topUniversities: [string, number][];
  topFields: [string, number][];
  dominantReason: string;
  adaptationHint: string;
}

function analyzeRejections(rawProfiles: any[], qualifiedLeads: any[]): RejectionAnalysis {
  const qualifiedIds = new Set(qualifiedLeads.map((l: any) => l.id));
  const breakdown: Record<string, number> = {
    seniorTitle: 0, irrelevantField: 0, missingProfile: 0,
    missingEducation: 0, notMasters: 0, eliteUniversity: 0,
    wrongOrigin: 0, tooLowScore: 0,
  };
  const uniCounts: Record<string, number> = {};
  const fieldCounts: Record<string, number> = {};

  for (const p of rawProfiles) {
    const edu      = p.education?.[0] || {};
    const uni      = edu.schoolName || p.university || '';
    const field    = edu.fieldOfStudy || p.fieldOfStudy || '';
    const degree   = edu.degreeName || edu.degree || p.degree || '';
    const headline = (p.headline || p.summary || '').toLowerCase();
    const name     = p.fullName || p.name || '';

    if (qualifiedIds.has(p.id)) {
      if (uni)   uniCounts[uni]   = (uniCounts[uni]   || 0) + 1;
      if (field) fieldCounts[field] = (fieldCounts[field] || 0) + 1;
      continue;
    }

    // Attribute primary rejection reason in priority order
    if (SENIOR_TITLES.some(t => headline.includes(t)))                            { breakdown.seniorTitle++;      continue; }
    if (LOW_FIELDS.some(f => field.toLowerCase().includes(f)))                    { breakdown.irrelevantField++;  continue; }
    if (!name || name === 'Unknown' || !p.linkedinUrl)                            { breakdown.missingProfile++;   continue; }
    // For Indian students studying IN India, missing university name is acceptable — only need degree or field
    const isIndianName  = /sharma|patel|desai|gupta|singh|kumar|mehta|joshi|kapoor|verma|reddy|rao|iyer|nair|pillai|chandra|krishna|agarwal|malhotra|bose|chatterjee|mukherjee|banerjee|das|ghosh|sen|saha/i.test(name);
    const pLoc = (p.location || '').toLowerCase();
    const inIndia = /\bindia\b|mumbai|delhi|bangalore|bengaluru|chennai|hyderabad|kolkata|pune|ahmedabad|jaipur/i.test(pLoc) || (!pLoc && isIndianName && !uni);
    const hasEnoughEdu = (isIndianName && inIndia) ? !!(edu.degree || edu.fieldOfStudy) : !!(edu.schoolName || edu.degree || edu.fieldOfStudy || p.university);
    if (!hasEnoughEdu)                                                             { breakdown.missingEducation++; continue; }
    const isMasters = /master|ms\b|m\.s\.|mba|meng|m\.sc/i.test(degree) ||
                      /\bms\b|m\.s\.|master|mba|meng/i.test(headline);
    if (!isMasters)                                                                { breakdown.notMasters++;       continue; }
    if (isEliteUni(uni))                                                           { breakdown.eliteUniversity++;  continue; }
    const originMatch = /sharma|patel|desai|gupta|singh|kumar|mehta|joshi|kapoor|verma|reddy|rao|iyer|nair|pillai|chandra|krishna|agarwal|malhotra|bose|chatterjee|mukherjee|banerjee|das|ghosh|sen|saha/i.test(name);
    if (!originMatch)                                                              { breakdown.wrongOrigin++;      continue; }
    breakdown.tooLowScore++;
  }

  const topUniversities = Object.entries(uniCounts).sort(([,a],[,b]) => b-a).slice(0, 5) as [string,number][];
  const topFields       = Object.entries(fieldCounts).sort(([,a],[,b]) => b-a).slice(0, 4) as [string,number][];

  // Find the dominant failure mode and map it to a concrete query fix
  const dominantEntry = Object.entries(breakdown).sort(([,a],[,b]) => b-a)[0];
  const dominantReason = dominantEntry?.[0] ?? 'tooLowScore';
  const HINTS: Record<string, string> = {
    wrongOrigin:       'Add origin country explicitly — e.g. "India" "Indian" or common Indian surnames to queries',
    notMasters:        'Tighten degree filter — add "MS" "Master of Science" "graduate student" to queries',
    missingEducation:  'Profiles lack education data — try more specific university name queries or use google dork with "university" keyword',
    eliteUniversity:   'Too many IIT/IIM/elite profiles — explicitly target Tier 2/3 Indian colleges: "private university India" "state university" "deemed university" or name specific schools like Amity, VIT, SRM, Manipal, NMIMS, Symbiosis, Pune University, Anna University, etc.',
    missingProfile:    'Profiles lack URL or name — try longer takePages or a different searchQuery to get more complete profiles',
    seniorTitle:       'Too many senior professionals — add "student" "2025" "recent grad" to exclude experienced hires',
    irrelevantField:   'Wrong field of study — narrow queries to specific relevant fields like "Computer Science" "Data Science" "Engineering"',
    tooLowScore:       'Profiles match demographics but lack intent signals — add "seeking" "internship" "open to work" "actively looking"',
  };
  const adaptationHint = HINTS[dominantReason] ?? 'Rewrite queries with more specific intent and degree signals';

  return { breakdown, topUniversities, topFields, dominantReason, adaptationHint };
}

function formatRejectionFeedback(raw: any[], qualified: any[], scraped: number): string {
  const analysis = analyzeRejections(raw, qualified);
  const rejected = scraped - qualified.length;
  if (rejected === 0) return '';

  const parts = Object.entries(analysis.breakdown)
    .filter(([,v]) => v > 0)
    .sort(([,a],[,b]) => b-a)
    .slice(0, 4)
    .map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
    .join(' | ');

  const unis = analysis.topUniversities.map(([u, n]) => `${u.split(' ').slice(-2).join(' ')} (${n})`).join(', ');
  const fields = analysis.topFields.map(([f, n]) => `${f} (${n})`).join(', ');

  return [
    `REJECTED ${rejected}: ${parts || 'various reasons'}`,
    unis   ? `QUALIFIED universities: ${unis}` : '',
    fields ? `QUALIFIED fields: ${fields}` : '',
    `→ ADAPT: ${analysis.adaptationHint}`,
  ].filter(Boolean).join('\n');
}

// ── GitHub bio enrichment ─────────────────────────────────────────────────────
// GitHub has no structured education. Enrich from bio text + location before qualify.
function enrichGitHub(p: any): any {
  const bio = p.headline || ''; // bio stored as headline
  const loc = (p.location || '').toLowerCase();

  // Infer education from bio (same regex as Google snippet extractor)
  const inferredEdu = extractEdu(bio);

  // India origin signal: location mentions Indian city/country
  const indiaLocation = /\b(india|bengaluru|bangalore|mumbai|delhi|hyderabad|chennai|pune|kolkata|ahmedabad|jaipur|surat|lucknow)\b/i.test(loc) ||
                        /\bindia\b/i.test(bio);

  // Job-search intent: GitHub bio sometimes has "open to work" type signals
  const bioLower = bio.toLowerCase();
  const jobSignal = /seeking|looking for|open to|internship|full.?time|job hunt|actively|available/i.test(bioLower);

  return {
    ...p,
    education: inferredEdu ? [inferredEdu] : p.education,
    // Inject a synthesized headline so mockScore/Claude can see these signals
    headline: [bio, indiaLocation ? '(India origin inferred from location)' : '', jobSignal ? '(job-search signal in bio)' : ''].filter(Boolean).join(' '),
    metadata: { ...p.metadata, indiaLocation, inferredEduFromBio: !!inferredEdu },
  };
}

async function qualifyProfiles(profiles: any[], params: any): Promise<any[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return profiles.map(mockScore).filter(l => l.qualityScore >= 6);
  }

  const CHUNK = 100; // was 15 — fewer round trips, same token cost per profile
  const allLeads: any[] = [];

  for (let i = 0; i < profiles.length; i += CHUNK) {
    const chunk = profiles.slice(i, i + CHUNK);
    try {
      const prompt = `You are a Lead Qualifier for CareerXcelerator, a platform helping international students land jobs in the US.

TARGET: Origin=${params.originCountry}, Stage=${params.stage}, Fields=${params.fields}, Opportunity=${params.opportunityTypes}

SCORING (max 10):
+3 origin matches ${params.originCountry} | +2 Masters student/grad | +2 job/intern intent | +1 relevant field | +1 complete profile | +1 non-elite university

INDIA RULE (applies only to students studying IN India):
India has 1000+ universities. For profiles located in India, the university name does NOT need to be well-known or recognisable. ANY Indian university not on the elite rejection list automatically earns the +1 non-elite bonus AND the +1 complete-profile bonus — do NOT penalise an unfamiliar name. Tier 2 and Tier 3 Indian colleges (Amity, VIT, SRM, Manipal, NMIMS, Symbiosis, state universities, deemed universities, private engineering colleges, etc.) are exactly our target. What matters is Masters degree + intent, not brand name.

ABROAD RULE (students studying outside India — any nationality):
University name IS required. If the university is elite/brand-name (see list below) → HARD REJECT regardless of nationality. If university name is missing for an abroad profile, treat profileComplete as false (-1 point). Non-elite foreign universities (regional state schools, mid-tier private universities, polytechnics, etc.) are welcomed.

ICP NOTE: CareerXcelerator targets Masters students from NON-ELITE schools who genuinely struggle to land jobs. Students from brand-name schools have strong on-campus recruiting pipelines and are NOT our target audience.

HARD REJECT (omit entirely from the leads array) if ANY of:
- University is elite/brand-name: MIT, Stanford, Harvard, CMU, Berkeley, Caltech, Princeton, Yale, Columbia, Cornell, UMich, UCLA, UIUC, Duke, JHU, Northwestern, Georgia Tech, Purdue, UWashington, Dartmouth, Brown, UPenn, Wharton — OR any IIT (IIT Bombay/Delhi/Madras/Kanpur/Kharagpur/Roorkee etc.), IIM, IISc, BITS Pilani — OR Oxford, Cambridge, Imperial, LSE, UCL — OR NUS, NTU, UofT, UBC, Waterloo, McGill, ETH Zurich, EPFL, TU Munich, Peking, Tsinghua
- qualityScore < 6
- Senior title (director, VP, head of, chief, principal, senior manager)
- Irrelevant field
- Missing name or profile URL

For profiles with no education array (Google/GitHub): infer from headline. If can't infer, leave blank — do NOT reject for missing education.

RAW PROFILES:
${JSON.stringify(chunk)}

RESPOND ONLY WITH VALID JSON:
{"leads":[{"id":"","name":"","linkedinUrl":"","university":"","degree":"","fieldOfStudy":"","graduationYear":"","location":"","headline":"","email":null,"socialMediaUrl":null,"seekingInternship":false,"seekingFullTime":false,"intentScore":2,"qualityScore":7,"outreachMessage":"Hi [First], I noticed you're pursuing your [Degree] in [Field] at [University]. Many international students struggle converting applications to interviews. CareerXcelerator helps students move from role clarity to real job offers. Happy to share a few insights if helpful!","status":"new","reviewFlag":"approved","qualityBreakdown":{"indianOriginConfirmed":true,"mastersStudent":true,"jobSearchIntent":true,"relevantField":true,"profileComplete":true,"nonTier1University":true}}]}`;

      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        system: 'You are a lead qualification expert. Respond only in valid JSON.',
        messages: [{ role: 'user', content: prompt }],
      });

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
      }).map((l: any) => ({
        ...l,
        tier: assignTier(l.qualityScore ?? 0, l.intentScore ?? 1),
      }));

      allLeads.push(...filtered);
    } catch {
      allLeads.push(...chunk.map(mockScore).filter(l => l.qualityScore >= 6));
    }
  }
  return allLeads;
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_platform',
    description: 'Search a platform for candidate profiles. Choose the platform based on the target profile and what previous results told you. Each call returns yield rate, tier breakdown, rejection reasons, and an ADAPT hint — use all of it to decide your next move.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', enum: ['linkedin', 'google', 'github', 'reddit'], description: 'Platform to search — choose based on recommended sequence and feedback from prior calls' },
        queries:  { type: 'array', items: { type: 'string' }, description: 'Search queries tailored to platform syntax. Rewrite between calls — never repeat a query that already returned low yield.' },
        limit:    { type: 'integer', description: 'Max profiles to scrape. Use 4× your remaining lead gap as buffer (e.g. need 80 more → limit 320).' },
      },
      required: ['platform', 'queries', 'limit'],
    },
  },
  {
    name: 'report_results',
    description: 'Signal discovery is complete. Call when totalQualified >= target OR you have exhausted all recommended platforms with no improvement.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'One sentence summary: how many leads found, which platforms worked, what the dominant tier was.' },
      },
      required: ['summary'],
    },
  },
];

// ── Dynamic platform strategy based on target profile ─────────────────────────
interface PlatformStrategy {
  sequence: string[];
  rationale: Record<string, string>;
}

function buildPlatformStrategy(params: any): PlatformStrategy {
  const fields           = (params.fields || '').toLowerCase();
  const opportunityTypes = (params.opportunityTypes || '').toLowerCase();
  const target           = parseInt(params.leadCount, 10) || 50;

  const isTech    = /computer|cs\b|data science|engineer|ml\b|ai\b|machine learning|software|developer|swe|information tech|cybersec/.test(fields);
  const isMLAI    = /ml\b|ai\b|machine learning|deep learning|nlp|data science|artificial intelligence|llm/.test(fields);
  const isBusiness = /mba|business|finance|marketing|management|consulting|operations|analytics/.test(fields);
  const needsIntern = /intern/.test(opportunityTypes);
  const isLargeRun  = target >= 100;

  const sequence: string[] = ['linkedin']; // LinkedIn always first — only source with structured education data
  const rationale: Record<string, string> = {
    linkedin: `Primary source. 2-step pipeline (search → full scrape) returns school + degree + field of study. Best for verifying ${params.originCountry} origin + Masters enrollment. ~$4/1000 profiles. Start here always.`,
  };

  if (isTech) {
    // For tech fields, GitHub is tier-2 not a last resort — active builders are high-value leads
    sequence.push('github');
    rationale['github'] = `High value for ${fields}. Real code activity signals genuine tech skill beyond self-reported education. Bio/location often reveals MS students. Repos in Python/ML = strong signal. ~$0.2/1000. Try early if LinkedIn yield is poor.`;
  }

  if (isLargeRun || needsIntern || isTech) {
    sequence.push('google');
    rationale['google'] = `Supplemental LinkedIn coverage. site:linkedin.com/in/ dork queries surface profiles LinkedIn's own search misses (especially intent keywords like "OPT", "seeking", "open to work"). ~$0.5/1000.`;
  }

  if (needsIntern || isBusiness || isMLAI) {
    sequence.push('reddit');
    rationale['reddit'] = `High intent signal. r/cscareerquestions + r/f1visa + r/gradadmissions have people actively discussing job hunts. Low structured data but confirms job-search intent. Good for internship targets. ~$0.1/1000.`;
  }

  return { sequence, rationale };
}

// ── Dynamic query examples tailored to target params ─────────────────────────
function buildQueryExamples(params: any, sequence: string[]): string {
  const origin  = params.originCountry || 'India';
  const fields  = params.fields || 'Computer Science';
  const field1  = fields.split(',')[0].trim();
  const field2  = (fields.split(',')[1] || '').trim();
  const gradYr  = new Date().getFullYear() + 1;
  const intent  = (params.opportunityTypes || '').toLowerCase().includes('intern') ? 'seeking internship' : 'open to work';
  const intKw   = intent.includes('intern') ? 'internship' : 'full-time';

  const exMap: Record<string, string[]> = {
    linkedin: [
      `MS ${field1} ${origin} ${gradYr} ${intent}`,
      `Master of Science ${field1} ${origin} student ${gradYr}`,
      `"${field1}" "${origin}" graduate student ${intKw}`,
      ...(field2 ? [`MS ${field2} ${origin} ${gradYr} seeking`] : []),
    ],
    google: [
      `site:linkedin.com/in/ "MS" "${field1}" "${origin}" "${intKw}" ${gradYr}`,
      `site:linkedin.com/in/ "Master of Science" "${field1}" "${origin}" "seeking"`,
      `site:linkedin.com/in/ "${origin}" "graduate student" "${field1}" "${gradYr}"`,
    ],
    github: [
      `location:"United States" language:Python "${origin}" followers:>2`,
      `location:"New York" OR location:"San Francisco" language:Python "${field1}"`,
      `"${field1}" "${origin}" "open to" OR "looking for" language:Python`,
    ],
    reddit: [
      `subreddit:f1visa ${intKw} "${origin}"`,
      `subreddit:cscareerquestions MS "${field1}" OPT ${gradYr}`,
      `subreddit:gradadmissions "${field1}" "${origin}" "${intKw}"`,
    ],
  };

  return sequence
    .filter(p => exMap[p])
    .map(p => `- ${p}: ${JSON.stringify(exMap[p])}`)
    .join('\n');
}

// ── Agent system prompt ───────────────────────────────────────────────────────
function buildAgentPrompt(params: any): string {
  const target = parseInt(params.leadCount, 10) || 50;
  const { sequence, rationale } = buildPlatformStrategy(params);
  const scrapeLimit = Math.min(target * 4, 200);

  const platformGuide = sequence.map((p, i) =>
    `${i + 1}. "${p}" — ${rationale[p]}`
  ).join('\n');

  const queryExamples = buildQueryExamples(params, sequence);

  return `You are a Lead Discovery Agent for CareerXcelerator. Find ${target} qualified leads matching the target profile below.

TARGET PROFILE:
- Audience: ${params.audience}
- Origin Country: ${params.originCountry}
- Current Location: ${params.currentLocation}
- Fields: ${params.fields}
- Opportunity: ${params.opportunityTypes}

RECOMMENDED PLATFORM SEQUENCE (chosen based on the target profile above):
${platformGuide}

You are NOT locked to this sequence. If feedback shows a platform is underperforming, skip ahead or go back. Use your judgment.

QUERY EXAMPLES (tailored to this target — adapt freely):
${queryExamples}

EXECUTION RULES:
1. Start with platform #1 in the sequence above.
2. Set limit to ${scrapeLimit} per call (4× remaining gap — e.g. need 60 more → use 240).
3. After each result, read the REJECTED breakdown and ADAPT hint before deciding the next call.
4. Never repeat a query that already returned < 10% yield — rewrite it or switch platforms.
5. Call report_results when totalQualified >= ${target} OR all platforms in sequence are exhausted.

ADAPTING FROM FEEDBACK:
Each result returns: yield rate · T1/T2/T3 · REJECTED breakdown · QUALIFIED universities/fields · ADAPT hint.

REJECTED line tells you WHY profiles failed — act on it:
- "wrong origin" dominant      → add "${params.originCountry}" and origin-specific keywords more explicitly
- "not Masters" dominant       → add "MS" "Master of Science" "graduate student" to every query
- "missing education" dominant → switch to google dork with university name in query, or target specific school names
- "elite university" dominant  → remove prestige keywords; target state schools, regional universities
- "senior title" dominant      → add "student" "${new Date().getFullYear() + 1}" "recent grad" "entry level"
- "too low score" dominant     → add "seeking" "internship" "open to work" "actively looking"

QUALIFIED UNIVERSITIES line tells you which schools are producing leads — if the same 2–3 schools dominate every batch, your queries are too narrow. Explicitly target different universities in next queries.

PLATFORM SWITCHING LOGIC:
- yield ≥ 20% and still short   → stay on same platform, use fresh queries
- yield 10–20%                  → try one more call with rewritten queries, then switch
- yield < 10%                   → follow ADAPT hint, then switch to next platform in sequence
- github returning 0 tech leads → bio/location signals absent; skip to google
- google returning duplicates   → change dork keywords, add different intent phrases

Begin now with platform #1: "${sequence[0]}".`;
}

// ── Route handler ─────────────────────────────────────────────────────────────
// Track in-progress runs to prevent double-submit
const activeRuns = new Set<string>();

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { params } = body ?? {};
  if (!params || typeof params !== 'object') {
    return new Response(JSON.stringify({ error: 'Missing params object' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const leadCount = parseInt(params.leadCount, 10);
  if (!params.audience || isNaN(leadCount) || leadCount < 1 || leadCount > 1000) {
    return new Response(JSON.stringify({ error: 'params.audience is required and leadCount must be 1–1000' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Prevent concurrent runs for the same audience+target to avoid double-spend
  const runKey = `${params.audience}|${leadCount}`;
  if (activeRuns.has(runKey)) {
    return new Response(JSON.stringify({ error: 'A run with these parameters is already in progress' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  }

  const encoder = new TextEncoder();
  const stream  = new TransformStream<Uint8Array, Uint8Array>();
  const writer  = stream.writable.getWriter();

  const send: SendEvent = (event, data) => {
    writer.write(encoder.encode(`data: ${JSON.stringify({ event, data })}\n\n`)).catch(() => {});
  };

  // Run the agent loop in the background
  activeRuns.add(runKey);
  (async () => {
    try {
      // ── No API key — return mock data directly ────────────────────────────
      if (!process.env.ANTHROPIC_API_KEY) {
        send('status', { message: 'Demo mode — no API keys detected.', step: 'mock' });
        const mockLeads = MOCK_PROFILES.map(mockScore).filter(l => l.qualityScore >= 6);
        try {
          const dataDir = join(process.cwd(), 'data', 'runs');
          mkdirSync(dataDir, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          await writeFile(join(dataDir, `${ts}_${mockLeads.length}leads_demo.json`), JSON.stringify({ timestamp: new Date().toISOString(), params, leads: mockLeads }, null, 2));
        } catch { /* no-op */ }
        send('complete', { leads: mockLeads, stats: { scraped: MOCK_PROFILES.length, qualified: mockLeads.length, rejected: MOCK_PROFILES.length - mockLeads.length }, isMock: true, mockReason: 'ANTHROPIC_API_KEY not set' });
        return;
      }

      const targetCount = parseInt(params.leadCount, 10) || 50;
      const MAX_ITER    = Math.max(20, Math.ceil(targetCount / 30)); // ~30 qualified leads/iteration
      const allLeads: any[] = [];
      const seenKeys = new Set<string>(); // multi-key dedup (email | url | name+uni)
      let done = false;
      let iteration = 0;

      // ── Per-run file for intermediate saves ──────────────────────────────
      const runTs  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const runFile = join(process.cwd(), 'data', 'runs', `${runTs}.json`);
      const saveProgress = async (leads: any[], stats: object) => {
        try {
          mkdirSync(join(process.cwd(), 'data', 'runs'), { recursive: true });
          await writeFile(runFile, JSON.stringify({ runTs, params, stats, leads }, null, 2));
        } catch { /* read-only fs (Vercel prod) */ }
      };

      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildAgentPrompt(params) }];

      send('status', { message: 'Agent initialising…', step: 'start' });

      while (!done && allLeads.length < targetCount && iteration < MAX_ITER) {
        iteration++;
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          tools: TOOLS,
          messages,
        });

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'end_turn') break;

        if (response.stop_reason === 'tool_use') {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;

            let result: unknown;

            // ── search_platform ─────────────────────────────────────────────
            if (block.name === 'search_platform') {
              const { platform, queries, limit } = block.input as { platform: string; queries: string[]; limit: number };
              send('tool_start', { platform, queries, step: 'scraping' });

              try {
                let rawProfiles: any[];
                if (platform === 'linkedin')     rawProfiles = await runLinkedIn(queries, limit, send);
                else if (platform === 'google')  rawProfiles = await runGoogle(queries, limit, send);
                else if (platform === 'github')  rawProfiles = await runGitHub(queries, limit, send);
                else                             rawProfiles = await runReddit(queries, limit, send);

                // Enrich GitHub profiles before scoring — bio/location signal extraction
                const enriched = platform === 'github' ? rawProfiles.map(enrichGitHub) : rawProfiles;

                send('progress', { message: `Qualifying ${enriched.length} profiles from ${platform}…`, step: 'qualifying' });
                const qualified = await qualifyProfiles(enriched, params);

                // ── Multi-key deduplication (email | url | name+uni) ──────────
                let newCount = 0;
                for (const lead of qualified) {
                  const keys: string[] = [];
                  if (lead.email) keys.push(`e:${lead.email.toLowerCase()}`);
                  const url = (lead.linkedinUrl || '').toLowerCase().replace(/\/$/, '');
                  if (url) keys.push(`u:${url}`);
                  const nameNorm = (lead.name || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();
                  const uniNorm  = (lead.university || '').toLowerCase().slice(0, 25);
                  if (nameNorm && nameNorm !== 'unknown') keys.push(`n:${nameNorm}|${uniNorm}`);

                  if (keys.length === 0 || keys.some(k => seenKeys.has(k))) continue;
                  keys.forEach(k => seenKeys.add(k));
                  allLeads.push(lead);
                  newCount++;
                }

                // ── Intermediate save after every batch ───────────────────────
                const interimStats = { scraped: rawProfiles.length, batchQualified: newCount, totalQualified: allLeads.length, target: targetCount };
                saveProgress(allLeads, interimStats);

                // ── Tier breakdown for Claude's feedback loop ─────────────────
                const t1 = qualified.filter((l: any) => l.tier === 1).length;
                const t2 = qualified.filter((l: any) => l.tier === 2).length;
                const t3 = qualified.filter((l: any) => l.tier === 3).length;
                const yieldPct = rawProfiles.length > 0 ? Math.round(newCount / rawProfiles.length * 100) : 0;

                const rejectionFeedback = formatRejectionFeedback(enriched, qualified, rawProfiles.length);

                send('tool_done', { platform, scraped: rawProfiles.length, qualifiedNew: newCount, totalQualified: allLeads.length, t1, t2, t3 });

                result = {
                  success: true,
                  scraped: rawProfiles.length,
                  qualifiedNew: newCount,
                  totalQualified: allLeads.length,
                  target: targetCount,
                  tierBreakdown: { t1, t2, t3 },
                  yieldRate: `${yieldPct}%`,
                  message: [
                    `${platform}: scraped ${rawProfiles.length}, yield ${yieldPct}% → ${newCount} new leads (T1:${t1} T2:${t2} T3:${t3}). Total ${allLeads.length}/${targetCount}.`,
                    rejectionFeedback,
                  ].filter(Boolean).join('\n'),
                };
              } catch (err: any) {
                send('progress', { message: `${platform} failed: ${err.message}` });
                result = { success: false, error: err.message, totalQualified: allLeads.length };
              }

            // ── report_results ──────────────────────────────────────────────
            } else if (block.name === 'report_results') {
              const { summary } = block.input as { summary: string };
              send('progress', { message: `Agent: ${summary}` });
              result = { acknowledged: true };
              done = true;

            } else {
              result = { error: `Unknown tool: ${block.name}` };
            }

            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          }

          if (!done) messages.push({ role: 'user', content: toolResults });
        }
      }

      const finalLeads = allLeads.slice(0, targetCount);
      const finalStats = { scraped: allLeads.length, qualified: finalLeads.length, rejected: Math.max(0, allLeads.length - targetCount) };

      // ── Save to JSON file (data/runs/) ────────────────────────────────────
      try {
        const dataDir = join(process.cwd(), 'data', 'runs');
        mkdirSync(dataDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${ts}_${finalLeads.length}leads.json`;
        await writeFile(join(dataDir, filename), JSON.stringify({ timestamp: new Date().toISOString(), params, stats: finalStats, leads: finalLeads }, null, 2));
      } catch { /* no-op: read-only filesystem (Vercel prod) */ }

      send('complete', { leads: finalLeads, stats: finalStats });

    } catch (err: any) {
      send('error', { message: err.message || 'Agent failed unexpectedly' });
    } finally {
      activeRuns.delete(runKey);
      writer.close().catch(() => {});
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
