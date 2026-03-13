import { NextResponse } from 'next/server';

// In-memory feedback store (in production, persist to DB or Sheets)
const feedbackStore: Record<string, { feedback: string; timestamp: string }> = {};

export async function POST(req: Request) {
  try {
    const { leadId, linkedinUrl, feedback } = await req.json();

    if (!leadId || !feedback) {
      return NextResponse.json({ error: 'leadId and feedback are required' }, { status: 400 });
    }

    const validFeedback = ['good_lead', 'irrelevant_lead', 'converted_lead'];
    if (!validFeedback.includes(feedback)) {
      return NextResponse.json({ error: 'Invalid feedback value' }, { status: 400 });
    }

    feedbackStore[linkedinUrl || leadId] = {
      feedback,
      timestamp: new Date().toISOString(),
    };

    console.log(`[Feedback Loop] Lead ${leadId} (${linkedinUrl}) marked as: ${feedback}`);
    console.log(`[Feedback Loop] Total feedback entries: ${Object.keys(feedbackStore).length}`);

    return NextResponse.json({ success: true, feedback, leadId });

  } catch (error) {
    console.error('Error saving feedback:', error);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}

// GET endpoint to retrieve feedback stats for improving future qualification
export async function GET() {
  const stats = {
    total: Object.keys(feedbackStore).length,
    good: Object.values(feedbackStore).filter(f => f.feedback === 'good_lead').length,
    irrelevant: Object.values(feedbackStore).filter(f => f.feedback === 'irrelevant_lead').length,
    converted: Object.values(feedbackStore).filter(f => f.feedback === 'converted_lead').length,
  };

  return NextResponse.json({ stats, entries: feedbackStore });
}
