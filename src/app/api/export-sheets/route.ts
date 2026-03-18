import { NextResponse } from 'next/server';
import { google } from 'googleapis';

const targetSheetId = process.env.GOOGLE_SHEETS_ID;

export async function POST(req: Request) {
  try {
    let body: any;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { leads } = body ?? {};
    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: 'leads must be a non-empty array' }, { status: 400 });
    }

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !targetSheetId) {
      console.log('No Google credentials found or Sheet ID missing.');
      return NextResponse.json({ error: 'Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEETS_ID.' }, { status: 503 });
    }

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // ── Check if "Leads" tab exists, if not use the first sheet ──
    let sheetName = 'Leads';
    try {
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: targetSheetId });
      const sheetExists = spreadsheet.data.sheets?.some(s => s.properties?.title === 'Leads');
      if (!sheetExists) {
        const rawName = spreadsheet.data.sheets?.[0]?.properties?.title || 'Sheet1';
        // Sanitize to prevent malformed range strings (e.g. "Foo!Bar" → "FooBar")
        sheetName = rawName.replace(/[!']/g, '');
        console.log(`"Leads" tab not found. Using "${sheetName}" instead.`);
      }
    } catch (e) {
      console.error('Error fetching spreadsheet info:', e);
    }

    // ── Duplicate Prevention ────────────────────────────────────────────────
    // Normalise a LinkedIn URL to a canonical form so minor variations
    // (trailing slash, query strings, http vs https, www prefix, case) don't
    // fool the check.
    function normalizeUrl(raw: string): string {
      try {
        const u = new URL(raw.trim().toLowerCase().replace(/^http:\/\//, 'https://'));
        // Strip query params and hash; remove trailing slash from pathname
        return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`;
      } catch {
        return raw.trim().toLowerCase().replace(/\/$/, '');
      }
    }
    // Fallback fingerprint when URL is absent: "name|university" lowercased
    function fallbackKey(l: any): string {
      return `${(l.name || '').toLowerCase().trim()}|${(l.university || '').toLowerCase().trim()}`;
    }

    const existingUrlKeys  = new Set<string>();
    const existingNameKeys = new Set<string>();
    try {
      // Read columns B (Full Name) and C (LinkedIn URL) together
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: targetSheetId,
        range: `${sheetName}!B:C`,
      });
      const rows = response.data.values ?? [];
      for (const [name, url] of rows) {
        if (url) existingUrlKeys.add(normalizeUrl(url));
        if (name && !url) existingNameKeys.add(`${(name as string).toLowerCase().trim()}|`);
      }
    } catch (e) {
      console.log(`Could not read existing leads from ${sheetName}. Proceeding without dedup.`);
    }

    // Also dedup within the incoming batch itself (prevent double-export of same lead)
    const seenInBatch = new Set<string>();
    const newLeads = leads.filter((l: any) => {
      const urlKey  = l.linkedinUrl ? normalizeUrl(l.linkedinUrl) : '';
      const nameKey = fallbackKey(l);
      const batchKey = urlKey || nameKey;

      if (seenInBatch.has(batchKey)) return false;
      seenInBatch.add(batchKey);

      if (urlKey && existingUrlKeys.has(urlKey)) return false;
      if (!urlKey && existingNameKeys.has(nameKey)) return false;
      return true;
    });

    if (newLeads.length === 0) {
      return NextResponse.json({ success: true, exportedCount: 0, message: 'No new leads to export.' });
    }

    // ── Ensure Headers if sheet is empty ───────────────────────────────────
    let firstNewRow = 2; // assume row 1 is header
    try {
      const countRes = await sheets.spreadsheets.values.get({ spreadsheetId: targetSheetId, range: `${sheetName}!A:A` });
      if (!countRes.data.values || countRes.data.values.length === 0) {
        // Sheet empty, write headers
        await sheets.spreadsheets.values.update({
          spreadsheetId: targetSheetId,
          range: `${sheetName}!A1:P1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[
              'Timestamp', 'Full Name', 'LinkedIn URL', 'University', 'Degree', 
              'Field Of Study', 'Graduation Year', 'Location', 'Headline', 'Email', 
              'Seeking Internship', 'Seeking Full Time', 'Intent Score', 'Priority', 
              'Outreach Message', 'Status'
            ]],
          },
        });
        firstNewRow = 2;
      } else {
        firstNewRow = countRes.data.values.length + 1;
      }
    } catch { /* use default */ }

    const rowsToAppend = newLeads.map((l: any) => [
      new Date().toISOString(),                       // A: Timestamp
      l.name        || '',                            // B: Full Name
      l.linkedinUrl || '',                            // C: LinkedIn URL
      l.university  || '',                            // D: University
      l.degree      || '',                            // E: Degree
      l.fieldOfStudy || '',                           // F: Field Of Study
      l.graduationYear || '',                         // G: Graduation Year
      l.location    || '',                            // H: Location
      l.headline    || '',                            // I: Headline
      l.email       || '',                            // J: Email
      l.seekingInternship ? 'Yes' : 'No',             // K: Seeking Internship
      l.seekingFullTime   ? 'Yes' : 'No',             // L: Seeking Full Time
      l.intentScore ?? '',                            // M: Intent Score
      ({ 1: 'Hot', 2: 'Warm', 3: 'Cold' } as Record<number,string>)[l.tier] ?? '', // N: Priority
      (l.outreachMessage || '').replace(/\n/g, ' '), // O: Outreach Message
      l.status      || 'new',                         // P: Status
    ]);

    // ── Append rows ─────────────────────────────────────────────────────────
    await sheets.spreadsheets.values.append({
      spreadsheetId: targetSheetId,
      range: `${sheetName}!A:P`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rowsToAppend },
    });

    // ── Color-code rows by tier ──────────────────────────────────────────────
    // T1=red, T2=amber, T3=light gray
    const TIER_COLORS: Record<number, { red: number; green: number; blue: number }> = {
      1: { red: 1,    green: 0.80, blue: 0.80 }, // light red
      2: { red: 1,    green: 0.95, blue: 0.80 }, // light amber
      3: { red: 0.95, green: 0.95, blue: 0.95 }, // light gray
    };
    const sheetId = (await sheets.spreadsheets.get({ spreadsheetId: targetSheetId }))
      .data.sheets?.find(s => s.properties?.title === sheetName)?.properties?.sheetId ?? 0;

    const colorRequests = newLeads.map((l: any, i: number) => {
      const color = TIER_COLORS[l.tier as number] ?? TIER_COLORS[3];
      const rowIndex = firstNewRow - 1 + i; // 0-based
      return {
        repeatCell: {
          range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 16 },
          cell: { userEnteredFormat: { backgroundColor: color } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      };
    });

    if (colorRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: targetSheetId,
        requestBody: { requests: colorRequests },
      });
    }

    return NextResponse.json({
      success: true,
      exportedCount: newLeads.length,
      totalSent: leads.length,
      duplicatesFound: leads.length - newLeads.length
    });

  } catch (error: any) {
    console.error('Error exporting to Google Sheets:', error);
    return NextResponse.json({ 
      error: 'Failed to export to Google Sheets',
      details: error.message 
    }, { status: 500 });
  }
}
