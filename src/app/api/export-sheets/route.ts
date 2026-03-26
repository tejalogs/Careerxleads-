import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { requireAuth } from '@/lib/auth';

export const maxDuration = 60; // 1 min — Sheets API writes

const targetSheetId = process.env.GOOGLE_SHEETS_ID;

export async function POST(req: Request) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    let body: any;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { leads, rejectedLeads } = body ?? {};
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
          range: `${sheetName}!A1:V1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[
              'Timestamp', 'Full Name', 'LinkedIn URL', 'University', 'Degree',
              'Field Of Study', 'Graduation Year', 'Location', 'Headline', 'Email',
              'Seeking Internship', 'Seeking Full Time', 'Intent Score', 'Priority',
              'Outreach Message', 'Status',
              'Struggle Score', 'Uni Tier', 'Networking Score', 'OPT Days Remaining', 'Regional Tag', 'Phone',
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
      l.struggleScore      ?? '',                     // Q: Struggle Score
      l.universityTier     ?? '',                     // R: Uni Tier
      l.networkingScore    ?? '',                     // S: Networking Score
      l.optDaysRemaining   ?? '',                     // T: OPT Days Remaining
      l.regionalTag || l.detectedLanguage || '',      // U: Regional Tag
      l.phone || '',                                  // V: Phone (WhatsApp)
    ]);

    // ── Write rows at exact position (avoids append column-offset bugs) ─────
    const lastRow = firstNewRow + rowsToAppend.length - 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: targetSheetId,
      range: `${sheetName}!A${firstNewRow}:V${lastRow}`,
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
          range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 0, endColumnIndex: 22 },
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

    // ── Export Rejected Leads tab ────────────────────────────────────────────
    let rejectedExportedCount = 0;
    if (Array.isArray(rejectedLeads) && rejectedLeads.length > 0) {
      const REJECTED_TAB = 'Rejected Leads';
      try {
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: targetSheetId });
        const allSheets = spreadsheet.data.sheets ?? [];
        const rejectedSheetMeta = allSheets.find(s => s.properties?.title === REJECTED_TAB);
        let rejectedSheetId: number;

        if (!rejectedSheetMeta) {
          // Create the tab
          const addRes = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: targetSheetId,
            requestBody: { requests: [{ addSheet: { properties: { title: REJECTED_TAB } } }] },
          });
          rejectedSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 1;
        } else {
          rejectedSheetId = rejectedSheetMeta.properties?.sheetId ?? 1;
        }

        // Dedup against existing rejected URLs
        const existingRejectedRes = await sheets.spreadsheets.values.get({
          spreadsheetId: targetSheetId,
          range: `${REJECTED_TAB}!C:C`,
        });
        const existingRejectedUrls = new Set(
          (existingRejectedRes.data.values ?? []).flat().map((u: string) => normalizeUrl(u))
        );

        // Ensure header
        const rejectedCountRes = await sheets.spreadsheets.values.get({
          spreadsheetId: targetSheetId,
          range: `${REJECTED_TAB}!A:A`,
        });
        if (!rejectedCountRes.data.values || rejectedCountRes.data.values.length === 0) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: targetSheetId,
            range: `${REJECTED_TAB}!A1:K1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [['Timestamp', 'Name', 'LinkedIn URL', 'University', 'Degree', 'Field Of Study', 'Graduation Year', 'Location', 'Headline', 'Platform', 'Rejection Reason']],
            },
          });
        }

        const seenInBatchRejected = new Set<string>();
        const newRejected = rejectedLeads.filter((r: any) => {
          const key = r.linkedinUrl ? normalizeUrl(r.linkedinUrl) : `${(r.name || '').toLowerCase()}|rejected`;
          if (seenInBatchRejected.has(key) || existingRejectedUrls.has(key)) return false;
          seenInBatchRejected.add(key);
          return true;
        });

        if (newRejected.length > 0) {
          const rejectedStartRow = (rejectedCountRes.data.values?.length ?? 1) + 1;
          const rejectedLastRow = rejectedStartRow + newRejected.length - 1;
          await sheets.spreadsheets.values.update({
            spreadsheetId: targetSheetId,
            range: `${REJECTED_TAB}!A${rejectedStartRow}:K${rejectedLastRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: newRejected.map((r: any) => [
                new Date().toISOString(),
                r.name || '',
                r.linkedinUrl || '',
                r.university || '',
                r.degree || '',
                r.fieldOfStudy || '',
                r.graduationYear || '',
                r.location || '',
                r.headline || '',
                r.platform || '',
                r.rejectionReason || '',
              ]),
            },
          });

          // Light gray background for all rejected rows (rejectedStartRow already declared above)
          const colorReqs = newRejected.map((_: any, i: number) => ({
            repeatCell: {
              range: { sheetId: rejectedSheetId, startRowIndex: (rejectedStartRow - 1) + i, endRowIndex: (rejectedStartRow - 1) + i + 1, startColumnIndex: 0, endColumnIndex: 11 },
              cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.88, blue: 0.88 } } },
              fields: 'userEnteredFormat.backgroundColor',
            },
          }));
          await sheets.spreadsheets.batchUpdate({ spreadsheetId: targetSheetId, requestBody: { requests: colorReqs } });
          rejectedExportedCount = newRejected.length;
        }
      } catch (e) {
        console.error('Failed to export rejected leads tab:', e);
      }
    }

    return NextResponse.json({
      success: true,
      exportedCount: newLeads.length,
      totalSent: leads.length,
      duplicatesFound: leads.length - newLeads.length,
      rejectedExportedCount,
    });

  } catch (error: any) {
    console.error('Error exporting to Google Sheets:', error);
    return NextResponse.json({ 
      error: 'Failed to export to Google Sheets',
      details: error.message 
    }, { status: 500 });
  }
}
