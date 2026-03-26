import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { requireAuth } from '@/lib/auth';

// #13: In-memory store kept as a fast read cache; all entries also persisted to Sheets
const feedbackStore: Record<string, { feedback: string; timestamp: string; leadId: string; name?: string }> = {};

async function persistToSheets(entry: {
  leadId: string;
  linkedinUrl: string;
  feedback: string;
  name?: string;
}) {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_ID } = process.env;
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEETS_ID) return;

  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Find or use "Feedback" tab
  let sheetName = 'Feedback';
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEETS_ID });
    const exists = spreadsheet.data.sheets?.some(s => s.properties?.title === 'Feedback');
    if (!exists) {
      sheetName = spreadsheet.data.sheets?.[0]?.properties?.title || 'Sheet1';
    }
  } catch {
    // proceed with default sheetName
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: `${sheetName}!A:E`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        new Date().toISOString(),
        entry.leadId,
        entry.linkedinUrl || '',
        entry.name || '',
        entry.feedback,
      ]],
    },
  });
}

export async function POST(req: Request) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const { leadId, linkedinUrl, feedback, name } = await req.json();

    if (!leadId || !feedback) {
      return NextResponse.json({ error: 'leadId and feedback are required' }, { status: 400 });
    }

    const validFeedback = ['good_lead', 'irrelevant_lead', 'converted_lead'];
    if (!validFeedback.includes(feedback)) {
      return NextResponse.json({ error: 'Invalid feedback value' }, { status: 400 });
    }

    const key = linkedinUrl || leadId;
    feedbackStore[key] = { feedback, timestamp: new Date().toISOString(), leadId, name };

    console.log(`[Feedback] Lead ${leadId} (${linkedinUrl}) → ${feedback}`);

    // Persist to Sheets in the background; don't block the response
    persistToSheets({ leadId, linkedinUrl, feedback, name }).catch(err =>
      console.error('[Feedback] Sheets persistence failed:', err.message)
    );

    return NextResponse.json({ success: true, feedback, leadId });

  } catch (error: any) {
    console.error('Error saving feedback:', error);
    return NextResponse.json({ error: 'Failed to save feedback', details: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const values = Object.values(feedbackStore);
  const stats = {
    total:     values.length,
    good:      values.filter(f => f.feedback === 'good_lead').length,
    irrelevant: values.filter(f => f.feedback === 'irrelevant_lead').length,
    converted: values.filter(f => f.feedback === 'converted_lead').length,
  };

  return NextResponse.json({ stats, entries: feedbackStore });
}
