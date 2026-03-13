import { NextResponse } from 'next/server';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';

// Mock profiles for development fallback
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
  email: i % 3 === 0 ? `mock.email${i}@example.com` : null
}));

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const strategy = body.strategy || {};
    const queries = strategy.searchQueries || [];
    
    if (!APIFY_TOKEN || APIFY_TOKEN === 'mock-token') {
      console.log('No Apify Token found. Returning mock results.');
      return NextResponse.json({ profiles: mockProfiles });
    }
    
    // Normalize actor ID (replace / with ~ for API URL)
    let actorId = process.env.APIFY_LINKEDIN_ACTOR_ID || 'apify/linkedin-search-scraper';
    const normalizedActorId = actorId.replace('/', '~');
    
    console.log(`Starting Apify Actor (${normalizedActorId}) via fetch...`);
    
    try {
      // 1. Start the actor run
      const startRunRes = await fetch(`https://api.apify.com/v2/acts/${normalizedActorId}/runs?token=${APIFY_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          queries: queries.length > 0 ? queries : ['Masters students USA Indian origin'],
          count: 20
        })
      });

      const runInfo = await startRunRes.json();
      if (!startRunRes.ok) {
        throw new Error(runInfo.error?.message || 'Failed to start run');
      }

      const runId = runInfo.data.id;
      const datasetId = runInfo.data.defaultDatasetId;
      
      console.log('Apify Run started:', runId);

      // 2. Poll for results (Wait for at least some items to appear)
      let items = [];
      const pollStartTime = Date.now();
      const timeout = 90000; // 90s timeout

      while (Date.now() - pollStartTime < timeout) {
        const checkRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
        const statusData = await checkRes.json();
        const status = statusData.data.status;
        
        console.log(`Run ${runId} status: ${status}`);

        if (status === 'SUCCEEDED') {
          const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`);
          items = await itemsRes.json();
          break;
        } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
          throw new Error(`Apify Run ${status}`);
        }
        
        // Even if not succeeded, check if items are being populated
        const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`);
        const currentItems = await itemsRes.json();
        if (currentItems.length > 0) {
          console.log(`Captured ${currentItems.length} partial results while run is in progress...`);
          items = currentItems;
          // If we have enough for a demo, we can break early
          if (items.length >= 5) break; 
        }

        await new Promise(r => setTimeout(r, 4000)); // Poll every 4s
      }

      if (items.length === 0) {
        throw new Error('No items found in dataset after polling');
      }
      
      const profiles = items.map((item: any, idx: number) => ({
        id: item.id || `apify-${idx}`,
        fullName: item.fullName || item.name || 'Unknown',
        url: item.url || item.profileUrl || '',
        headline: item.headline || item.title || '',
        location: item.location || '',
        education: item.education || [],
        email: item.email || null,
        raw: item
      }));

      return NextResponse.json({ profiles });

    } catch (apifyError: any) {
      console.error('Apify API failure:', apifyError.message);
      return NextResponse.json({ 
        profiles: mockProfiles, 
        warning: 'Apify search failed or timed out, using fallback profiles',
        errorDetails: apifyError.message 
      });
    }

  } catch (error: any) {
    console.error('Scrape-leads critical error:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}
