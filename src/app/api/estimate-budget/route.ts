import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '@/lib/auth';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export async function POST(req: Request) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const { params } = await req.json();
    const leadCount = parseInt(params.leadCount, 10) || 100;

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === '') {
      return NextResponse.json({
        total: leadCount * 0.007,
        apify: leadCount * 0.005,
        ai: leadCount * 0.002,
        complexity: 'Medium',
        reasoning: 'Basic estimation applied due to missing API key.'
      });
    }

    try {
      const prompt = `
        As an AI Lead Generation Cost Estimator, analyze these discovery parameters:
        - Audience: ${params.audience}
        - Origin: ${params.originCountry}
        - Location: ${params.currentLocation}
        - Fields: ${params.fields}
        - Target Lead Count: ${params.leadCount}

        Estimate the budget for:
        1. Apify LinkedIn Scraper (Standard is $0.005/lead, but niche audiences or hard-to-find locations can be $0.01-$0.02/lead).
        2. AI Qualification Credits ($0.002/lead).
        
        Provide a "Complexity Score" (Low/Medium/High) based on the niche.
        
        Respond ONLY with JSON:
        {
          "total": 0.00,
          "apify": 0.00,
          "ai": 0.00,
          "complexity": "Low/Medium/High",
          "reasoning": "string"
        }
      `;

      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
        system: "You are a cost estimation expert. You must respond in valid JSON format only."
      });

      // #14: Guard content[0] access
      if (!msg.content?.length || msg.content[0].type !== 'text') {
        throw new Error('Unexpected response shape from Claude');
      }
      const responseContent = msg.content[0].text;
      let estimate: any;
      try {
        estimate = JSON.parse(responseContent.replace(/```json/g, '').replace(/```/g, '').trim());
      } catch {
        console.error('[estimate-budget] Failed to parse Claude JSON:', responseContent.slice(0, 200));
        return NextResponse.json({
          total: leadCount * 0.007,
          apify: leadCount * 0.005,
          ai: leadCount * 0.002,
          complexity: 'Medium',
          reasoning: 'Fallback estimation — AI returned invalid JSON.'
        });
      }

      return NextResponse.json(estimate);

    } catch (apiError: any) {
      console.error('Claude Budget Estimation Error:', apiError.message);
      return NextResponse.json({
        total: leadCount * 0.007,
        apify: leadCount * 0.005,
        ai: leadCount * 0.002,
        complexity: 'Medium',
        reasoning: 'Fallback estimation applied due to API error.'
      });
    }

  } catch (error) {
    console.error('Critical Budget Estimation Error:', error);
    return NextResponse.json({ error: 'Failed to estimate budget', details: (error as Error).message }, { status: 500 });
  }
}
