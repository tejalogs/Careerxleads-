import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { MOCK_PROFILES, runLinkedIn, runGoogle, runGitHub, runReddit, enrichGitHub } from '@/lib/leads/scrapers';
import type { SendEvent } from '@/lib/leads/scrapers';
import { mockScore, qualifyProfiles } from '@/lib/leads/qualification';
import { formatRejectionFeedback } from '@/lib/leads/rejection';
import { buildAgentPrompt } from '@/lib/leads/queries';

export const maxDuration = 60; // Vercel Hobby max (300 on Pro)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

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

// ── Track in-progress runs to prevent double-submit ───────────────────────────
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
  if (!params.audience || isNaN(leadCount) || leadCount < 1 || leadCount > 100) {
    return new Response(JSON.stringify({ error: 'params.audience is required and leadCount must be 1–100' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

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
      const MAX_ITER    = Math.max(20, Math.ceil(targetCount / 30));
      const allLeads: any[] = [];
      const seenKeys = new Set<string>();
      let done = false;
      let iteration = 0;

      const runTs  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const runFile = join(process.cwd(), 'data', 'runs', `${runTs}.json`);
      const saveProgress = async (leads: any[], stats: object) => {
        try {
          mkdirSync(join(process.cwd(), 'data', 'runs'), { recursive: true });
          await writeFile(runFile, JSON.stringify({ runTs, params, stats, leads }, null, 2));
        } catch { /* read-only fs (Vercel prod) */ }
      };

      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildAgentPrompt(params) }];
      const tokenUsage = { input: 0, output: 0 };
      const addTokens = (input: number, output: number) => { tokenUsage.input += input; tokenUsage.output += output; };

      send('status', { message: 'Agent initialising…', step: 'start' });

      while (!done && allLeads.length < targetCount && iteration < MAX_ITER) {
        iteration++;
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          tools: TOOLS,
          messages,
        });
        if (response.usage) addTokens(response.usage.input_tokens, response.usage.output_tokens);

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

                const enriched = platform === 'github'
                  ? await Promise.all(rawProfiles.map(enrichGitHub))
                  : rawProfiles;

                send('progress', { message: `Qualifying ${enriched.length} profiles from ${platform}…`, step: 'qualifying' });
                const qualified = await qualifyProfiles(enriched, params, addTokens);

                // ── Multi-key deduplication ───────────────────────────────────
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

                const interimStats = { scraped: rawProfiles.length, batchQualified: newCount, totalQualified: allLeads.length, target: targetCount };
                saveProgress(allLeads, interimStats);

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

      try {
        const dataDir = join(process.cwd(), 'data', 'runs');
        mkdirSync(dataDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${ts}_${finalLeads.length}leads.json`;
        await writeFile(join(dataDir, filename), JSON.stringify({ timestamp: new Date().toISOString(), params, stats: finalStats, leads: finalLeads }, null, 2));
      } catch { /* no-op: read-only filesystem (Vercel prod) */ }

      const estimatedCostUsd = parseFloat(
        ((tokenUsage.input / 1_000_000) * 3 + (tokenUsage.output / 1_000_000) * 15).toFixed(4),
      );
      send('cost_estimate', { inputTokens: tokenUsage.input, outputTokens: tokenUsage.output, estimatedCostUsd });
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
