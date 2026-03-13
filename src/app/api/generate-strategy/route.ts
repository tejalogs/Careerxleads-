import { NextResponse } from 'next/server';
import { GenerationParams } from '@/types';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const DEFAULT_STRATEGY = {
  platforms: ['LinkedIn', 'Google Search', 'University Directories'],
  searchQueries: [
    'MS Data Science student USA seeking internship',
    'Master\'s student business analytics United States',
    'Indian MS Computer Science student USA'
  ],
  apifyActors: ['apify/linkedin-search-scraper']
};

export async function POST(req: Request) {
  try {
    const params = await req.json() as GenerationParams;
    
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === '') {
      console.log('No Gemini API key found, returning mock strategy.');
      return NextResponse.json(DEFAULT_STRATEGY);
    }

    try {
      // Use 'gemini-1.5-flash-latest' which is the common alias for the newest flash model
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash-latest', 
        generationConfig: { responseMimeType: "application/json" }
      });

      const prompt = `
        You are an expert AI Lead Generation operator for CareerXcelerator. 
        Based on these audience parameters:
        - Audience: ${params.audience}
        - Origin Country: ${params.originCountry}
        - Current Location: ${params.currentLocation}
        - Stage: ${params.stage}
        - Fields: ${params.fields}
        - Looking for: ${params.opportunityTypes}
        
        Generate a search strategy.
        
        Respond ONLY with a JSON object:
        {
          "platforms": ["Platform 1", "Platform 2"],
          "searchQueries": ["query 1", "query 2", "query 3"],
          "apifyActors": ["apify/linkedin-search-scraper"]
        }
      `;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      
      const response = await result.response;
      let text = response.text();
      
      // Safety parsing
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const strategy = JSON.parse(text);
      
      return NextResponse.json(strategy);

    } catch (apiError: any) {
      console.error('Gemini API Error (generate-strategy):', apiError.message);
      // Absolute safety fallback
      return NextResponse.json(DEFAULT_STRATEGY);
    }

  } catch (error) {
    console.error('Critical Error (generate-strategy):', error);
    return NextResponse.json(DEFAULT_STRATEGY);
  }
}
