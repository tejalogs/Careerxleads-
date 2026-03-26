import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';
const APIFY_BASE  = 'https://api.apify.com/v2';

// ── Mock profiles (fallback when Apify is unavailable) ────────────────────────
const mockProfiles = Array.from({ length: 45 }).map((_, i) => ({
  id: `mock-${i}`,
  fullName: ['Priya Sharma', 'Rahul Desai', 'Anita Patel', 'Vikram Singh', 'Neha Gupta'][i % 5],
  url: `https://linkedin.com/in/mock-profile-${i}`,
  headline: ['MS Data Science @ NYU | Seeking Summer Internship 2025', 'MBA Candidate at Boston University', 'Incoming Software Engineer Intern at Google | MS CS @ Georgia Tech', 'Data Analyst | MS Business Analytics', 'Software Engineer @ Amazon | MS CS USC'][i % 5],
  location: ['New York, NY', 'Boston, MA', 'Atlanta, GA', 'San Francisco, CA', 'Seattle, WA'][i % 5],
  education: [
    { schoolName: ['New York University', 'Boston University', 'Georgia Institute of Technology', 'University of Texas at Dallas', 'University of Southern California'][i % 5], degreeName: 'Master of Science', fieldOfStudy: ['Data Science', 'MBA', 'Computer Science', 'Business Analytics', 'Computer Science'][i % 5], endDate: '2025' },
    { schoolName: 'University of Mumbai', degreeName: 'Bachelor of Engineering', fieldOfStudy: 'Computer Engineering', endDate: '2022' }
  ],
  email: i % 3 === 0 ? `mock.email${i}@example.com` : null,
  metadata: { platform: 'LinkedIn', actor: 'mock' },
}));

// ── Low-level Apify helpers ───────────────────────────────────────────────────

async function apifyPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${APIFY_BASE}${path}?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Apify POST ${path} failed: HTTP ${res.status} — ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function apifyGet(path: string): Promise<any> {
  const res = await fetch(`${APIFY_BASE}${path}?token=${APIFY_TOKEN}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Apify GET ${path} failed: HTTP ${res.status}`);
  }
  return data;
}

async function apifyGetItems(datasetId: string, limit: number): Promise<any[]> {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Apify dataset fetch failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// ── Poll a run until done or timeout ─────────────────────────────────────────

async function pollRun(actorId: string, runId: string, datasetId: string, limit: number, timeoutMs = 180_000): Promise<any[]> {
  const pollStart = Date.now();

  while (Date.now() - pollStart < timeoutMs) {
    await new Promise(r => setTimeout(r, 5000));

    const { data: { status } } = await apifyGet(`/actor-runs/${runId}`);
    console.log(`[${actorId}] Status: ${status} (${Math.round((Date.now() - pollStart) / 1000)}s)`);

    if (status === 'SUCCEEDED') {
      return apifyGetItems(datasetId, limit);
    }
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`[${actorId}] Run ended with status: ${status}`);
    }

    // Early exit if we already have enough partial results
    const partial = await apifyGetItems(datasetId, limit);
    if (partial.length >= limit) {
      console.log(`[${actorId}] Early exit — ${partial.length} items (target: ${limit})`);
      return partial;
    }
  }

  throw new Error(`[${actorId}] Timed out after ${timeoutMs / 1000}s`);
}

// ── Start an actor run and return { runId, datasetId } ───────────────────────

async function startActorRun(actorId: string, input: unknown): Promise<{ runId: string; datasetId: string }> {
  const normalizedId = actorId.replace('/', '~');
  console.log(`[${actorId}] Starting run. Input: ${JSON.stringify(input).slice(0, 300)}`);
  const { data } = await apifyPost(`/acts/${normalizedId}/runs`, input);
  console.log(`[${actorId}] Run ID: ${data.id}`);
  return { runId: data.id, datasetId: data.defaultDatasetId };
}

// ── Platform-native input builders ────────────────────────────────────────────
// Verified against actor documentation on Apify Store.

function buildLinkedInSearchInput(queries: string[], limit: number): Record<string, unknown> {
  // harvestapi/linkedin-profile-search
  // "Search Queries to Run in Batches" field = `queries` array of objects with `searchQuery`
  // Each search page returns 25 profiles. takePages controls how many pages per query.
  const takePages = Math.max(1, Math.ceil(limit / (queries.length * 25)));
  return {
    queries: queries.map(q => ({ searchQuery: q })),
    maxItems: limit,
    takePages,
    profileScraperMode: 'Short',     // Short = fast discovery, returns URL + headline + location
    proxyConfiguration: { useApifyProxy: true },
  };
}

function buildLinkedInScrapeInput(profileUrls: string[], limit: number): Record<string, unknown> {
  // harvestapi/linkedin-profile-scraper
  // Takes an array of LinkedIn profile URLs and returns full profiles with education
  return {
    urls: profileUrls.slice(0, limit),
    maxItems: limit,
    proxyConfiguration: { useApifyProxy: true },
  };
}

function buildGoogleDorkInput(queries: string[], limit: number): Record<string, unknown> {
  // apify/google-search-scraper: queries = newline-separated string
  const resultsPerQuery = Math.ceil(limit / Math.max(queries.length, 1));
  return {
    queries: queries.join('\n'),
    maxPagesPerQuery: Math.max(1, Math.ceil(resultsPerQuery / 10)),
    resultsPerPage: 10,
    countryCode: 'us',
    languageCode: 'en',
  };
}

function buildGitHubInput(queries: string[], limit: number): Record<string, unknown> {
  // dtrungtin/github-users-scraper: single q string, maxItems
  return {
    q: queries[0] || 'location:"United States" language:Python followers:>5',
    maxItems: limit,
  };
}

function buildRedditInput(queries: string[], limit: number): Record<string, unknown> {
  // trudax/reddit-scraper: searches array, maxItems
  const targetSubreddits = ['cscareerquestions', 'f1visa', 'gradadmissions', 'datascience'];
  const searches = queries.length > 0
    ? queries
    : targetSubreddits.map(sub => `subreddit:${sub} internship OR "full time" OR "job search"`);
  return {
    searches: searches.slice(0, 4),
    maxItems: limit,
  };
}

// ── Profile normalizers ───────────────────────────────────────────────────────

function normalizeLinkedInProfile(item: any, idx: number, actorId: string): any {
  return {
    id: item.id || item.profileId || `li-${idx}`,
    fullName: item.fullName || item.name || 'Unknown',
    url: item.profileUrl || item.url || item.linkedinUrl || '',
    headline: item.headline || item.title || '',
    location: item.location || item.locationName || '',
    education: Array.isArray(item.education)
      ? item.education.map((e: any) => ({
          schoolName: e.schoolName || e.school || '',
          degreeName: e.degreeName || e.degree || '',
          fieldOfStudy: e.fieldOfStudy || e.field || '',
          endDate: e.endDate || e.timePeriod?.endDate?.year?.toString() || '',
        }))
      : [],
    email: item.email || null,
    metadata: { platform: 'LinkedIn', actor: actorId },
  };
}

function extractEducationFromText(text: string): { schoolName: string; degreeName: string; fieldOfStudy: string; endDate: string } | null {
  if (!text) return null;
  const degreeMatch = text.match(/\b(MS|M\.S\.|MBA|M\.B\.A\.|MEng|M\.Eng|Master(?:s)?(?: of Science)?(?:\s+in)?|MCS|MSCS|MSDS|MS-CS)\b/i);
  const fieldMatch  = text.match(/(?:in|of)\s+([A-Za-z][a-zA-Z\s&\/]{2,30})(?:\s+[@|at]|\s*[-|]|\s+\d{4}|$)/i);
  const uniMatch    = text.match(/(?:[@|at|@\s])\s*([A-Z][a-zA-Z\s]{4,40})(?:\s*[|·\-,]|$)/i) ||
                      text.match(/([A-Z][a-zA-Z\s]+University|[A-Z][a-zA-Z\s]+Institute|[A-Z]+U\b)/);
  const yearMatch   = text.match(/\b(202[3-9]|203\d)\b/);
  if (!degreeMatch) return null;
  return {
    schoolName:   uniMatch?.[1]?.trim()   || '',
    degreeName:   degreeMatch[0],
    fieldOfStudy: fieldMatch?.[1]?.trim() || '',
    endDate:      yearMatch?.[0]          || '',
  };
}

function normalizeGoogleResult(item: any, idx: number, actorId: string): any {
  const url     = item.url || item.link || '';
  const snippet = item.description || item.snippet || '';
  const title   = item.title || '';
  const isLinkedInProfile = url.includes('linkedin.com/in/');
  const fullName = isLinkedInProfile
    ? title.replace(/\s*[-|].*$/i, '').trim()
    : (title || 'Unknown');
  const edu = extractEducationFromText(`${title} ${snippet}`);
  return {
    id: item.id || `goog-${idx}`,
    fullName,
    url,
    headline: snippet || title,
    location: '',
    education: edu ? [edu] : [],
    email: null,
    metadata: { platform: 'Google', actor: actorId, snippet },
  };
}

function normalizeGitHubProfile(item: any, idx: number, actorId: string): any {
  return {
    id: item.id?.toString() || item.login || `gh-${idx}`,
    fullName: item.name || item.login || 'Unknown',
    url: item.url || `https://github.com/${item.login}`,
    headline: item.bio || '',
    location: item.location || '',
    education: [],
    email: item.email || item.publicEmail || null,
    metadata: { platform: 'GitHub', actor: actorId, company: item.company || '', repos: item.publicRepos || 0 },
  };
}

function normalizeRedditPost(item: any, idx: number, actorId: string): any {
  const author = item.author || '';
  const isUsername = !author.includes(' ') && author.length < 30;
  const titleNameMatch = (item.title || '').match(/(?:I(?:'m| am)\s+)([A-Z][a-z]+ [A-Z][a-z]+)/);
  const fullName = titleNameMatch ? titleNameMatch[1] : (isUsername ? '' : author);
  return {
    id: item.id || `rd-${idx}`,
    fullName: fullName || 'Unknown',
    url: item.url || item.permalink || '',
    headline: [item.title, item.body?.slice(0, 200)].filter(Boolean).join(' — '),
    location: '',
    education: [],
    email: null,
    metadata: {
      platform: 'Reddit',
      actor: actorId,
      subreddit: item.subreddit || '',
      redditAuthor: author,
      body: item.body?.slice(0, 500) || '',
    },
  };
}

function normalizeProfile(item: any, idx: number, actorId: string): any {
  if (actorId.includes('linkedin-profile-search') || actorId.includes('linkedin-profile-scraper') || actorId.includes('logical_scrapers')) {
    return normalizeLinkedInProfile(item, idx, actorId);
  }
  if (actorId.includes('google-search-scraper')) {
    return normalizeGoogleResult(item, idx, actorId);
  }
  if (actorId.includes('github')) {
    return normalizeGitHubProfile(item, idx, actorId);
  }
  if (actorId.includes('reddit')) {
    return normalizeRedditPost(item, idx, actorId);
  }
  return {
    id: item.id || `raw-${idx}`,
    fullName: item.fullName || item.name || item.title || 'Unknown',
    url: item.url || item.profileUrl || item.link || '',
    headline: item.headline || item.bio || item.description || '',
    location: item.location || '',
    education: item.education || [],
    email: item.email || null,
    metadata: { platform: 'Unknown', actor: actorId },
  };
}

// ── LinkedIn 2-step pipeline ──────────────────────────────────────────────────
// Step 1: harvestapi/linkedin-profile-search  → basic profiles + URLs
// Step 2: harvestapi/linkedin-profile-scraper → full profiles with education
//
// Step 2 is optional — if it fails, Step 1 basic profiles are returned.

async function runLinkedInPipeline(queries: string[], limit: number): Promise<any[]> {
  const SEARCH_ACTOR  = 'harvestapi/linkedin-profile-search';
  const SCRAPE_ACTOR  = 'harvestapi/linkedin-profile-scraper';

  // ── Step 1: Discovery ────────────────────────────────────────────────────
  const discoveryLimit = limit * 2; // fetch 2x to account for filtering after step 2
  const searchInput = buildLinkedInSearchInput(queries, discoveryLimit);
  const { runId: searchRunId, datasetId: searchDatasetId } = await startActorRun(SEARCH_ACTOR, searchInput);
  const rawDiscovery = await pollRun(SEARCH_ACTOR, searchRunId, searchDatasetId, discoveryLimit);

  if (rawDiscovery.length === 0) throw new Error(`[${SEARCH_ACTOR}] No profiles found in discovery`);

  const discoveryProfiles = rawDiscovery.map((item, idx) => normalizeLinkedInProfile(item, idx, SEARCH_ACTOR));
  console.log(`[LinkedIn] Step 1 complete — ${discoveryProfiles.length} profiles discovered`);

  // Extract valid LinkedIn URLs for full scrape
  const profileUrls = discoveryProfiles
    .map(p => p.url)
    .filter((u): u is string => typeof u === 'string' && u.includes('linkedin.com/in/'));

  if (profileUrls.length === 0) {
    console.warn('[LinkedIn] No valid profile URLs — returning discovery profiles as-is');
    return discoveryProfiles.slice(0, limit);
  }

  // ── Step 2: Full profile scrape ──────────────────────────────────────────
  try {
    const scrapeInput = buildLinkedInScrapeInput(profileUrls, limit);
    const { runId: scrapeRunId, datasetId: scrapeDatasetId } = await startActorRun(SCRAPE_ACTOR, scrapeInput);
    const rawFull = await pollRun(SCRAPE_ACTOR, scrapeRunId, scrapeDatasetId, limit);

    if (rawFull.length === 0) throw new Error('No results from profile scraper');

    const fullProfiles = rawFull.map((item, idx) => normalizeLinkedInProfile(item, idx, SCRAPE_ACTOR));
    console.log(`[LinkedIn] Step 2 complete — ${fullProfiles.length} full profiles with education`);
    return fullProfiles;

  } catch (scrapeErr: any) {
    console.warn(`[LinkedIn] Step 2 failed (${scrapeErr.message}) — falling back to Step 1 profiles`);
    return discoveryProfiles.slice(0, limit);
  }
}

// ── Generic single-actor runner ───────────────────────────────────────────────

async function runSingleActor(actorId: string, queries: string[], limit: number): Promise<any[]> {
  let input: Record<string, unknown>;
  if (actorId.includes('google-search-scraper')) {
    input = buildGoogleDorkInput(queries, limit);
  } else if (actorId.includes('github')) {
    input = buildGitHubInput(queries, limit);
  } else if (actorId.includes('reddit')) {
    input = buildRedditInput(queries, limit);
  } else {
    console.warn(`[scrape-leads] Unknown actor "${actorId}" — using generic query input`);
    input = { queries, maxItems: limit };
  }

  const { runId, datasetId } = await startActorRun(actorId, input);
  const items = await pollRun(actorId, runId, datasetId, limit);

  if (items.length === 0) throw new Error(`[${actorId}] No items returned`);

  const profiles = items.map((item, idx) => normalizeProfile(item, idx, actorId));
  console.log(`[${actorId}] Yielded ${profiles.length} normalized profiles`);
  return profiles;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const strategy = body.strategy || {};
    const params   = body.params   || {};
    const leadCount = Math.max(1, parseInt(params.leadCount, 10) || 50);

    if (!APIFY_TOKEN) {
      console.log('[scrape-leads] No Apify token — returning mock profiles.');
      return NextResponse.json({
        profiles: mockProfiles.slice(0, leadCount),
        isMock: true,
        mockReason: 'APIFY_API_TOKEN is not set',
      });
    }

    const allActorIds: string[] = strategy.apifyActors?.length > 0
      ? strategy.apifyActors
      : ['harvestapi/linkedin-profile-search', 'apify/google-search-scraper'];

    const perActorQueries: Record<string, string[]> = strategy.perActorQueries || {};
    const fallbackQueries: string[] = strategy.searchQueries || [];

    // Separate LinkedIn actors (need 2-step pipeline) from other actors
    const linkedInActorIds = allActorIds.filter(id => id.includes('harvestapi/linkedin-profile-search') || id.includes('logical_scrapers'));
    const otherActorIds    = allActorIds.filter(id => !linkedInActorIds.includes(id));

    const perActorLimit = Math.ceil((leadCount * 4) / Math.max(allActorIds.length, 1));

    console.log(`[scrape-leads] LinkedIn pipeline actors: ${linkedInActorIds.length}, Other actors: ${otherActorIds.length}`);

    // Run LinkedIn pipeline(s) and other actors in parallel
    const linkedInPromises = linkedInActorIds.map(actorId => {
      const queries = perActorQueries[actorId]?.length > 0 ? perActorQueries[actorId] : fallbackQueries;
      return runLinkedInPipeline(queries, perActorLimit);
    });

    const otherPromises = otherActorIds.map(actorId => {
      const queries = perActorQueries[actorId]?.length > 0 ? perActorQueries[actorId] : fallbackQueries;
      return runSingleActor(actorId, queries, perActorLimit);
    });

    const results = await Promise.allSettled([...linkedInPromises, ...otherPromises]);

    // Merge and deduplicate by URL
    const seenKeys = new Set<string>();
    const allProfiles: any[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const profile of result.value) {
          const rawKey = profile.url || profile.id;
          if (!rawKey) {
            console.warn(`[scrape-leads] Dropping profile with no url or id (name: "${profile.fullName}")`);
            continue;
          }
          const key = rawKey.toLowerCase().replace(/\/$/, '');
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          allProfiles.push(profile);
        }
      } else {
        console.error('[scrape-leads] Actor failed:', (result.reason as Error)?.message || result.reason);
      }
    }

    if (allProfiles.length === 0) {
      console.warn('[scrape-leads] All actors failed — falling back to mock profiles.');
      return NextResponse.json({
        profiles: mockProfiles.slice(0, leadCount),
        isMock: true,
        mockReason: 'All Apify actors failed or returned no results',
        warning: 'All actors failed; using fallback profiles',
      });
    }

    console.log(`[scrape-leads] ${allProfiles.length} deduplicated profiles from ${allActorIds.length} actors.`);
    return NextResponse.json({ profiles: allProfiles });

  } catch (error: any) {
    console.error('[scrape-leads] Critical error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
