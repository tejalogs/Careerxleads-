import { NextResponse } from 'next/server';
import { GenerationParams } from '@/types';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '@/lib/auth';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// ── Actor Catalog ─────────────────────────────────────────────────────────────
// Tier 1: High-yield, identity-rich profiles — always include at least one
// Tier 2: Strong supplemental, platform-specific context
// Tier 3: Niche / community signals — use only when ICP calls for it
export const ACTOR_CATALOG = {
  LINKEDIN_CORE: {
    id: 'harvestapi/linkedin-profile-search',
    platform: 'LinkedIn',
    tier: 1,
    bestFor: ['any'],
    inputStyle: 'linkedin_keywords',
    description: 'Step 1 of LinkedIn pipeline — people search by keyword. Input: queries array of {searchQuery} objects. Returns basic profiles with URLs. Automatically followed by linkedin-profile-scraper (Step 2) to get full education data.',
  },
  LINKEDIN_DEEP: {
    id: 'logical_scrapers/linkedin-people-search-scraper',
    platform: 'LinkedIn',
    tier: 1,
    bestFor: ['any'],
    inputStyle: 'linkedin_keywords',
    description: 'Alternative LinkedIn search. Use instead of LINKEDIN_CORE when lead count > 100 or when broader net is needed.',
  },
  GOOGLE_DORK: {
    id: 'apify/google-search-scraper',
    platform: 'Google',
    tier: 2,
    bestFor: ['any'],
    inputStyle: 'google_dork',
    description: 'Google site: and inurl: dorks against linkedin.com/in/ and university pages. Great for catching profiles not returned by direct LinkedIn search.',
  },
  GITHUB: {
    id: 'dtrungtin/github-users-scraper',
    platform: 'GitHub',
    tier: 2,
    bestFor: ['software', 'engineering', 'data science', 'computer science', 'machine learning', 'ai'],
    inputStyle: 'github_search',
    description: 'GitHub user search by location + language. Strong signal for SWE/DS/ML students who maintain public repos.',
  },
  REDDIT: {
    id: 'trudax/reddit-scraper',
    platform: 'Reddit',
    tier: 3,
    bestFor: ['community', 'visa', 'career advice', 'international students'],
    inputStyle: 'reddit_search',
    description: 'Targets r/cscareerquestions, r/f1visa, r/gradadmissions. Catches students actively discussing job search — very high intent signal.',
  },
} as const;

export type ActorKey = keyof typeof ACTOR_CATALOG;
export type ActorId = typeof ACTOR_CATALOG[ActorKey]['id'];

// ── Default strategy (used when ANTHROPIC_API_KEY is absent) ─────────────────
// Platform-specific queries — NOT shared across actors
const DEFAULT_STRATEGY = {
  platforms: ['LinkedIn', 'Google', 'GitHub'],
  apifyActors: [
    ACTOR_CATALOG.LINKEDIN_CORE.id,
    ACTOR_CATALOG.GOOGLE_DORK.id,
    ACTOR_CATALOG.GITHUB.id,
  ],
  perActorQueries: {
    // LinkedIn queries: plain keyword strings — scrape-leads wraps these into {searchQuery: q} objects
    [ACTOR_CATALOG.LINKEDIN_CORE.id]: [
      'MS Computer Science 2025 India seeking internship',
      'Master Data Science India open to work United States',
      'MS Computer Science India University Texas Dallas Boston NYU',
      'MBA India international student seeking full time 2025',
    ],
    // Google dork queries: site:linkedin.com/in/ format for catching profiles direct search misses
    [ACTOR_CATALOG.GOOGLE_DORK.id]: [
      'site:linkedin.com/in/ "MS in Computer Science" "India" "seeking" 2025',
      'site:linkedin.com/in/ "Master of Science" "Data Science" "open to work" India',
      'site:linkedin.com/in/ "MS" "computer science" "University" India internship 2025',
    ],
    // GitHub queries: location + language syntax
    [ACTOR_CATALOG.GITHUB.id]: [
      'location:"United States" language:Python followers:>5',
      'location:"New York" OR location:"Boston" OR location:"San Francisco" language:Python',
    ],
  },
  reasoning: 'Default: LinkedIn 2-step pipeline (search → full scrape) for structured profiles with education + Google dorks for broader coverage + GitHub for tech signal.',
};

export async function POST(req: Request) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const params = await req.json() as GenerationParams;

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === '') {
      console.log('[generate-strategy] No API key — using default strategy.');
      return NextResponse.json(DEFAULT_STRATEGY);
    }

    try {
      const catalogDesc = Object.values(ACTOR_CATALOG)
        .map(a => `  - "${a.id}" (Tier ${a.tier}, ${a.platform}): ${a.description}`)
        .join('\n');

      const prompt = `You are an elite Lead Discovery Strategist for CareerXcelerator, a service helping international students (primarily Indian-origin MS/MBA students) find jobs in the US.

CANDIDATE PERSONA:
- Audience: ${params.audience}
- Origin Country: ${params.originCountry}
- Current Location: ${params.currentLocation}
- Fields: ${params.fields}
- Opportunity Types: ${params.opportunityTypes}

YOUR JOB:
Select 2–3 Apify actors that will yield the highest volume of RELEVANT profiles for this exact persona.
Then generate platform-native queries for EACH actor separately — different platforms need completely different query syntax.

ACTOR SELECTION RULES:
1. Always include one Tier 1 LinkedIn actor as the primary source — LinkedIn profiles are identity-rich and structured.
2. Always include Google Dork as a secondary — it catches LinkedIn profiles that direct search misses, and can also hit university profile pages.
3. Add GitHub ONLY if fields include software/engineering/data science/ML/AI — it adds strong technical signal.
4. Add Reddit ONLY if the persona is highly community-active (visa discussions, job hunt forums) — use r/cscareerquestions, r/f1visa, r/gradadmissions.
5. Never include both LINKEDIN_CORE and LINKEDIN_DEEP — pick one based on volume needs (DEEP for >100 leads).
6. Maximum 3 actors total.

ACTOR CATALOG:
${catalogDesc}

QUERY GENERATION RULES BY PLATFORM:

LinkedIn queries (inputStyle: linkedin_keywords):
- These are plain keyword strings. The app automatically wraps them into {searchQuery: "..."} objects for the actor.
- Use natural keyword phrases: degree type, field, origin country, job intent, location
- Include the origin country name and degree level
- Examples: "MS Computer Science 2025 India seeking internship", "Master Data Science India open to work United States"
- Generate 3–4 queries, each targeting a different angle (field, university tier, intent signal, graduation year)

Google queries (inputStyle: google_dork):
- Always use site:linkedin.com/in/ as the anchor
- Combine degree, field, origin, intent, and year signals
- Use quotes for exact phrases
- Examples: 'site:linkedin.com/in/ "MS in Data Science" "India" "seeking" 2025'
- Generate 3–4 dork queries

GitHub queries (inputStyle: github_search):
- Use GitHub search syntax: location:"City" language:Python/JavaScript followers:>N
- Target US cities with large Indian student populations (New York, Boston, San Francisco, Seattle, Austin, Atlanta)
- Generate 2–3 queries

Reddit queries (inputStyle: reddit_search):
- Target specific subreddits: r/cscareerquestions, r/f1visa, r/gradadmissions, r/datascience
- Use keyword searches that match job-seeking students
- Generate 2–3 queries

Respond ONLY with this exact JSON (no markdown, no explanation):
{
  "platforms": ["Platform1", "Platform2"],
  "apifyActors": ["actor-id-1", "actor-id-2"],
  "perActorQueries": {
    "actor-id-1": ["query1", "query2", "query3"],
    "actor-id-2": ["query1", "query2", "query3"]
  },
  "reasoning": "One sentence: why this actor combination and query approach for this specific persona."
}`;

      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: 'You are a professional lead generation AI. Respond only in valid JSON.',
        messages: [{ role: 'user', content: prompt }],
      });

      if (!msg.content?.length || msg.content[0].type !== 'text') {
        throw new Error('Unexpected response shape from Claude');
      }

      const jsonStr = msg.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
      let strategy: any;
      try {
        strategy = JSON.parse(jsonStr);
      } catch {
        console.error('[generate-strategy] Failed to parse Claude JSON:', jsonStr.slice(0, 200));
        return NextResponse.json({ ...DEFAULT_STRATEGY, warning: 'AI returned invalid JSON; using default strategy' });
      }

      if (strategy.reasoning) {
        console.log('[generate-strategy] Reasoning:', strategy.reasoning);
      }

      // Validate actors are from our known catalog to prevent injection
      const knownActorIds = Object.values(ACTOR_CATALOG).map(a => a.id);
      strategy.apifyActors = (strategy.apifyActors || []).filter((id: string) => {
        const known = knownActorIds.includes(id as ActorId);
        if (!known) console.warn(`[generate-strategy] Ignoring unknown actor: ${id}`);
        return known;
      });

      if (strategy.apifyActors.length === 0) {
        console.warn('[generate-strategy] No valid actors after validation — using default.');
        return NextResponse.json({ ...DEFAULT_STRATEGY, warning: 'Actor validation failed; using default strategy' });
      }

      return NextResponse.json(strategy);

    } catch (apiError: any) {
      console.error('[generate-strategy] Anthropic API error:', apiError.message);
      return NextResponse.json({ ...DEFAULT_STRATEGY, warning: 'AI strategy unavailable; using default' });
    }

  } catch (error: any) {
    console.error('[generate-strategy] Critical error:', error);
    return NextResponse.json({ ...DEFAULT_STRATEGY, warning: 'Critical error; using default', details: error.message });
  }
}
