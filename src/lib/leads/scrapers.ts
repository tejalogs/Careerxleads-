export type SendEvent = (event: string, data: unknown) => void;

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';
const APIFY_BASE  = 'https://api.apify.com/v2';

// ── Mock profiles (used when APIFY_TOKEN absent) ───────────────────────────────
export const MOCK_PROFILES = Array.from({ length: 45 }).map((_, i) => ({
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

// ── Apify helpers ──────────────────────────────────────────────────────────────
async function apifyPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${APIFY_BASE}${path}?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Apify POST ${path}: HTTP ${res.status}`);
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

// ── Normalizers ────────────────────────────────────────────────────────────────
export function normalizeLinkedIn(item: any, idx: number, actor: string): any {
  const fullName = item.fullName || item.name ||
    [item.firstName, item.lastName].filter(Boolean).join(' ') || 'Unknown';
  const headline = item.headline || item.summary || '';
  const location = typeof item.location === 'string'
    ? item.location : (item.location?.linkedinText || item.locationName || '');
  const education = Array.isArray(item.education) ? item.education.map((e: any) => ({
    schoolName:  e.schoolName || e.school || '',
    degreeName:  e.degreeName || e.degree || '',
    fieldOfStudy: e.fieldOfStudy || e.field || '',
    endDate: typeof e.endDate === 'object'
      ? (e.endDate?.text || e.endDate?.year?.toString() || '')
      : (e.endDate || e.timePeriod?.endDate?.year?.toString() || ''),
  })) : [];
  return {
    id: item.id || item.profileId || `li-${idx}`,
    fullName, linkedinUrl: item.linkedinUrl || item.profileUrl || item.url || '',
    headline, location, education, email: item.email || null,
    metadata: { platform: 'LinkedIn', actor },
  };
}

// ── Phone extractor — works on PDF snippets, README text, bios ───────────────
// Students abroad use local numbers: +1 (US/CA), +44 (UK), +61 (AU), +49 (DE),
// +971 (UAE), +65 (SG), +91 (India WhatsApp), etc.
// Priority: explicit international +CC prefix → formatted local number
export function extractPhone(text: string): string | null {
  if (!text) return null;
  // Any +[country-code] number — covers all countries
  const intl = text.match(/(?<!\d)(\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?[\s.\-]\d{2,5}[\s.\-]\d{3,5}(?:[\s.\-]\d{2,4})?)(?!\d)/);
  if (intl) return intl[1].trim();
  // Formatted local number without country prefix: (XXX) XXX-XXXX | XXX-XXX-XXXX | XXX.XXX.XXXX
  const local = text.match(/(?<!\d)\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}(?!\d)/);
  if (local) return local[0].trim();
  return null;
}

export function extractEdu(text: string): any | null {
  if (!text) return null;
  const deg = text.match(/\b(MS|M\.S\.|MBA|M\.B\.A\.|MEng|M\.Eng|MTech|M\.Tech|M\.Sc|MSc|Master(?:s)?(?:\s+of\s+\w+)?(?:\s+in)?|MCS|MSCS|MSDS|MS-CS)\b/i);
  const fld = text.match(/(?:in|of)\s+([A-Za-z][a-zA-Z\s&\/]{2,35})(?:\s+[@|at]|\s*[-|·,]|\s+\d{4}|$)/i);
  let uniMatch: string | null = null;
  const atSymbol = text.match(/@\s*([A-Z][A-Za-z.\s]{1,50})(?:\s*[|·\-,]|$)/);
  if (atSymbol) uniMatch = atSymbol[1].trim();
  if (!uniMatch) {
    const atWord = text.match(/\bat\s+([A-Z][A-Za-z.\s&]{3,50})(?:\s*[|·\-,\d]|$)/);
    if (atWord) uniMatch = atWord[1].trim();
  }
  if (!uniMatch) {
    const indian = text.match(/\b(IIT[\s\-]\w+|NIT[\s\-]\w+|BITS[\s\-]\w+|IIM[\s\-]\w+|IIIT[\s\-]\w+|IISc)\b/i);
    if (indian) uniMatch = indian[1].trim();
  }
  if (!uniMatch) {
    const std = text.match(/([A-Z][a-zA-Z\s&]+(?:University|Institute of Technology|College|School|Academy)|University\s+of\s+[A-Z][a-zA-Z\s]+)/);
    if (std) uniMatch = std[1].trim();
  }
  if (!uniMatch) {
    const abbrev = text.match(/\b(NYU|USC|ASU|PSU|UT(?:\s+\w+)?|SMU|GMU|GWU|VCU|LSU|FSU|OSU|UMass(?:\s+\w+)?|UConn|UVA|UNC|UIUC|NJIT|RIT|WPI|NEU|BU|UBC|UofT|NUS|NTU)\b/);
    if (abbrev) uniMatch = abbrev[1].trim();
  }
  const yr = text.match(/\b(202[3-9]|203\d)\b/);
  if (!deg) return null;
  return { schoolName: uniMatch || '', degreeName: deg[0], fieldOfStudy: fld?.[1]?.trim() || '', endDate: yr?.[0] || '' };
}

export function normalizeGoogle(item: any, idx: number, actor: string): any {
  const url   = item.url || item.link || '';
  const snip  = item.description || item.snippet || '';
  const title = item.title || '';
  const name  = url.includes('linkedin.com/in/') ? title.replace(/\s*[-|].*$/i, '').trim() : (title || 'Unknown');
  const edu   = extractEdu(`${title} ${snip}`);
  const isPdf = url.toLowerCase().endsWith('.pdf') || /filetype:pdf/i.test(url);
  // Extract contact info from snippet — PDF resume headers are often shown in snippet
  const email = extractEmailFromText(snip);
  const phone = extractPhone(`${snip} ${title}`);
  return {
    id: item.id || `goog-${idx}`, fullName: name, linkedinUrl: url,
    headline: snip || title, location: '', education: edu ? [edu] : [],
    email: email || null, phone: phone || null,
    metadata: { platform: 'Google', actor, snippet: snip, isPdfResume: isPdf },
  };
}

// Extract email from arbitrary text (used for PDF snippet + README)
function extractEmailFromText(text: string): string | null {
  if (!text) return null;
  const m = text.match(/\b([a-zA-Z0-9._%+\-]+@(?!.*\bnoreply\b)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
  return m ? m[1] : null;
}

export function normalizeGitHub(item: any, idx: number, actor: string): any {
  return { id: item.id?.toString() || `gh-${idx}`, fullName: item.name || item.login || 'Unknown', linkedinUrl: item.url || `https://github.com/${item.login}`, headline: item.bio || '', location: item.location || '', education: [], email: item.email || null, metadata: { platform: 'GitHub', actor, repos: item.publicRepos || 0 } };
}

export function normalizeReddit(item: any, idx: number, actor: string): any {
  const author = item.author || '';
  const nameMatch = (item.title || '').match(/(?:I(?:'m| am)\s+)([A-Z][a-z]+ [A-Z][a-z]+)/);
  const fullName = nameMatch ? nameMatch[1] : (author.includes(' ') ? author : '');
  return { id: item.id || `rd-${idx}`, fullName: fullName || 'Unknown', linkedinUrl: item.url || item.permalink || '', headline: [item.title, item.body?.slice(0, 200)].filter(Boolean).join(' — '), location: '', education: [], email: null, metadata: { platform: 'Reddit', actor, subreddit: item.subreddit || '', redditAuthor: author } };
}

// ── Resume PDF dorker — extract login from GitHub URL ────────────────────────
function githubLoginFromUrl(url: string): string {
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || ''; } catch { return ''; }
}

export async function enrichGitHub(p: any): Promise<any> {
  const bio = p.headline || '';
  const loc = (p.location || '').toLowerCase();
  const inferredEdu = extractEdu(bio);
  const indiaLocation = /\b(india|bengaluru|bangalore|mumbai|delhi|hyderabad|chennai|pune|kolkata|ahmedabad|jaipur|surat|lucknow)\b/i.test(loc) || /\bindia\b/i.test(bio);
  const bioLower = bio.toLowerCase();
  const jobSignal = /seeking|looking for|open to|internship|full.?time|job hunt|actively|available/i.test(bioLower);

  // Try README for email + phone if not already present on the profile
  const login = githubLoginFromUrl(p.linkedinUrl || p.url || '');
  let readmeEmail: string | null = null;
  let readmePhone: string | null = null;
  if (login && (!p.email || !p.phone)) {
    for (const branch of ['main', 'master']) {
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/${login}/${login}/${branch}/README.md`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (!res.ok) continue;
        const text = await res.text();
        if (!p.email)  readmeEmail = extractEmailFromText(text);
        if (!p.phone)  readmePhone = extractPhone(text);
        break;
      } catch { /* timeout — skip */ }
    }
  }

  return {
    ...p,
    email: p.email || readmeEmail || null,
    phone: p.phone || readmePhone || null,
    education: inferredEdu ? [inferredEdu] : p.education,
    headline: [bio, indiaLocation ? '(India origin inferred from location)' : '', jobSignal ? '(job-search signal in bio)' : ''].filter(Boolean).join(' '),
    metadata: { ...p.metadata, indiaLocation, inferredEduFromBio: !!inferredEdu, emailFromReadme: !!readmeEmail },
  };
}

// ── Platform runners ───────────────────────────────────────────────────────────
export async function runLinkedIn(queries: string[], limit: number, send: SendEvent): Promise<any[]> {
  if (!APIFY_TOKEN) return MOCK_PROFILES.slice(0, limit);
  send('progress', { message: `LinkedIn: Step 1/2 — searching ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} in parallel…` });
  const perQuery  = Math.max(5, Math.ceil((limit * 2) / queries.length));
  const takePages = Math.max(1, Math.ceil(perQuery / 25));
  const step1Runs = await Promise.all(queries.map(q =>
    startActorRun('harvestapi/linkedin-profile-search', {
      searchQuery: q, maxItems: perQuery, takePages,
      profileScraperMode: 'Short', proxyConfiguration: { useApifyProxy: true },
    })
  ));
  const step1Results = await Promise.all(
    step1Runs.map(({ runId, datasetId }) =>
      pollRun('harvestapi/linkedin-profile-search', runId, datasetId, perQuery, send).catch(() => [] as any[])
    )
  );
  const allRaw1  = step1Results.flat();
  const discovery = allRaw1.map((item, i) => normalizeLinkedIn(item, i, 'harvestapi/linkedin-profile-search'));
  const urls = [...new Set(discovery.map(p => p.linkedinUrl).filter((u): u is string => !!u && u.includes('linkedin.com/in/')))];
  send('progress', { message: `LinkedIn: ${discovery.length} discovered (${urls.length} unique URLs). Step 2/2 — full scrape for education…` });
  if (urls.length === 0) return discovery.slice(0, limit);
  try {
    const { runId: r2, datasetId: d2 } = await startActorRun('harvestapi/linkedin-profile-scraper', {
      urls: urls.slice(0, limit), maxItems: limit, proxyConfiguration: { useApifyProxy: true },
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

export async function runGoogle(queries: string[], limit: number, send: SendEvent): Promise<any[]> {
  if (!APIFY_TOKEN) return [];
  send('progress', { message: 'Google: Running LinkedIn dork queries…' });
  const rpp = Math.ceil(limit / queries.length);
  const { runId, datasetId } = await startActorRun('apify/google-search-scraper', {
    queries: queries.join('\n'), maxPagesPerQuery: Math.max(1, Math.ceil(rpp / 10)),
    resultsPerPage: 10, countryCode: 'us', languageCode: 'en',
  });
  const items = await pollRun('apify/google-search-scraper', runId, datasetId, limit, send);
  return items.map((item, i) => normalizeGoogle(item, i, 'apify/google-search-scraper'));
}

export async function runGitHub(queries: string[], limit: number, send: SendEvent): Promise<any[]> {
  if (!APIFY_TOKEN) return [];
  send('progress', { message: 'GitHub: Searching tech profiles…' });
  const { runId, datasetId } = await startActorRun('dtrungtin/github-users-scraper', {
    q: queries[0] || 'location:"United States" language:Python followers:>5', maxItems: limit,
  });
  const items = await pollRun('dtrungtin/github-users-scraper', runId, datasetId, limit, send);
  return items.map((item, i) => normalizeGitHub(item, i, 'dtrungtin/github-users-scraper'));
}

export async function runReddit(queries: string[], limit: number, send: SendEvent): Promise<any[]> {
  if (!APIFY_TOKEN) return [];
  send('progress', { message: 'Reddit: Searching career forums…' });
  const { runId, datasetId } = await startActorRun('trudax/reddit-scraper', {
    searches: queries.slice(0, 4), maxItems: limit,
  });
  const items = await pollRun('trudax/reddit-scraper', runId, datasetId, limit, send);
  return items.map((item, i) => normalizeReddit(item, i, 'trudax/reddit-scraper'));
}
