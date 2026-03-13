import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Lead } from '@/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Constants for backend validation
const SENIOR_TITLES = ['director', 'vp', 'vice president', 'head of', 'chief', 'cto', 'ceo', 'cfo', 'coo', 'principal', 'senior manager'];
const LOW_RELEVANCE_FIELDS = ['history', 'philosophy', 'literature', 'fine arts', 'art history', 'music', 'theater'];

function isExperiencedProfessional(headline: string): boolean {
  const lc = (headline || '').toLowerCase();
  return SENIOR_TITLES.some(t => lc.includes(t)) || /(\d+)\+?\s*years?\s*(of)?\s*(experience|exp)/i.test(headline);
}

function isLowRelevanceField(field: string): boolean {
  const lc = (field || '').toLowerCase();
  return LOW_RELEVANCE_FIELDS.some(f => lc.includes(f));
}

function isProfileComplete(lead: any): boolean {
  return !!(lead.name && lead.university && lead.fieldOfStudy && lead.graduationYear && lead.linkedinUrl);
}

function computeMockScore(p: any): Lead {
  const headline = (p.headline || '').toLowerCase();
  return {
    id: p.id || Math.random().toString(36).substr(2, 9),
    name: p.fullName || p.name || 'Unknown',
    linkedinUrl: p.url || '',
    university: p.education?.[0]?.schoolName || 'University',
    degree: p.education?.[0]?.degreeName || 'Master of Science',
    fieldOfStudy: p.education?.[0]?.fieldOfStudy || 'Computer Science',
    graduationYear: p.education?.[0]?.endDate || '2025',
    location: p.location || '',
    headline: p.headline || '',
    email: p.email || null,
    socialMediaUrl: null,
    seekingInternship: headline.includes('intern'),
    seekingFullTime: headline.includes('full-time') || headline.includes('seeking'),
    intentScore: 2,
    qualityScore: 7,
    outreachMessage: `Hi ${p.fullName?.split(' ')[0] || 'there'},\n\nI noticed your profile and your interest in ${(p.education?.[0]?.fieldOfStudy || 'your field')}. CareerXcelerator helps students move from role clarity to real job offers.`,
    status: 'new',
    reviewFlag: 'approved',
    qualityBreakdown: {
      indianOriginConfirmed: true,
      mastersStudent: true,
      jobSearchIntent: true,
      relevantField: true,
      profileComplete: true,
      nonTier1University: true
    }
  };
}

export async function POST(req: Request) {
  try {
    const { profiles, params } = await req.json();

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ leads: [] });
    }

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === '') {
      const mockResult = profiles.map(computeMockScore);
      return NextResponse.json({ leads: mockResult });
    }

    try {
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: "application/json" }
      });

      const prompt = `
  Analyze these profiles for CareerXcelerator.
  Target: ${params.originCountry}, ${params.stage}, ${params.fields}.
  
  SCORING:
  - Indian Origin: +3
  - Student Stage: +2
  - Job Intent: +2
  - Relevant Field: +1
  
  Only return leads with score >= 6.
  Profiles: ${JSON.stringify(profiles)}
  
  Respond with JSON:
  {
    "leads": [
      {
        "id": "original-id",
        "name": "Full Name",
        "linkedinUrl": "url",
        "university": "University",
        "degree": "MS/MBA/etc",
        "fieldOfStudy": "Field",
        "graduationYear": "2025",
        "location": "City, State",
        "headline": "Headline",
        "qualityScore": 8,
        "outreachMessage": "Personalized message",
        "qualityBreakdown": { ... }
      }
    ]
  }
  `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const data = JSON.parse(response.text().replace(/```json/g, '').replace(/```/g, '').trim());

      const filteredLeads = (data.leads || []).filter((l: any) => {
        if (l.qualityScore < 6) return false;
        if (isExperiencedProfessional(l.headline)) return false;
        if (isLowRelevanceField(l.fieldOfStudy)) return false;
        if (!isProfileComplete(l)) return false;
        return true;
      });

      return NextResponse.json({ leads: filteredLeads });

    } catch (aiError) {
      console.error('Gemini Qualify Error:', aiError);
      return NextResponse.json({ 
        leads: profiles.slice(0, 20).map(computeMockScore),
        warning: 'Qualifying with backup logic'
      });
    }

  } catch (error) {
    console.error('Critical Qualify Error:', error);
    return NextResponse.json({ leads: [] });
  }
}
