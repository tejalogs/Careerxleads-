import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: Request) {
  try {
    const { params } = await req.json();
    const leadCount = parseInt(params.leadCount) || 100;

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({
        total: leadCount * 0.007,
        apify: leadCount * 0.005,
        ai: leadCount * 0.002,
        complexity: 'Medium'
      });
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: "application/json" }
    });

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
      
      Respond with JSON:
      {
        "total": 0.00,
        "apify": 0.00,
        "ai": 0.00,
        "complexity": "Low/Medium/High",
        "reasoning": "string"
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const estimate = JSON.parse(response.text());

    return NextResponse.json(estimate);

  } catch (error) {
    console.error('Budget Estimation Error:', error);
    return NextResponse.json({ error: 'Failed to estimate budget' }, { status: 500 });
  }
}
