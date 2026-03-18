import { isH1BSeasonNow, isH1BResultsWindow } from './timing';

export interface PlatformStrategy {
  sequence: string[];
  rationale: Record<string, string>;
}

export function buildPlatformStrategy(params: any): PlatformStrategy {
  const fields           = (params.fields || '').toLowerCase();
  const opportunityTypes = (params.opportunityTypes || '').toLowerCase();
  const target           = parseInt(params.leadCount, 10) || 50;

  const isTech     = /computer|cs\b|data science|engineer|ml\b|ai\b|machine learning|software|developer|swe|information tech|cybersec/.test(fields);
  const isMLAI     = /ml\b|ai\b|machine learning|deep learning|nlp|data science|artificial intelligence|llm/.test(fields);
  const isBusiness = /mba|business|finance|marketing|management|consulting|operations|analytics/.test(fields);
  const needsIntern = /intern/.test(opportunityTypes);
  const isLargeRun  = target >= 100;

  const sequence: string[] = ['linkedin'];
  const rationale: Record<string, string> = {
    linkedin: `Primary source. 2-step pipeline (search → full scrape) returns school + degree + field of study. Best for verifying ${params.originCountry} origin + Masters enrollment. ~$4/1000 profiles. Start here always.`,
  };

  if (isTech) {
    sequence.push('github');
    rationale['github'] = `High value for ${fields}. Real code activity signals genuine tech skill beyond self-reported education. Bio/location often reveals MS students. Repos in Python/ML = strong signal. ~$0.2/1000. Try early if LinkedIn yield is poor.`;
  }

  if (isLargeRun || needsIntern || isTech) {
    sequence.push('google');
    rationale['google'] = `Supplemental LinkedIn coverage. site:linkedin.com/in/ dork queries surface profiles LinkedIn's own search misses (especially intent keywords like "OPT", "seeking", "open to work"). ~$0.5/1000.`;
  }

  if (needsIntern || isBusiness || isMLAI) {
    sequence.push('reddit');
    rationale['reddit'] = `High intent signal. r/cscareerquestions + r/f1visa + r/gradadmissions have people actively discussing job hunts. Low structured data but confirms job-search intent. Good for internship targets. ~$0.1/1000.`;
  }

  return { sequence, rationale };
}

export function buildQueryExamples(params: any, sequence: string[]): string {
  const origin   = params.originCountry || 'India';
  const fields   = params.fields || 'Computer Science';
  const field1   = fields.split(',')[0].trim();
  const field2   = (fields.split(',')[1] || '').trim();

  // Graduation year: prefer user-specified, fall back to computed next year
  const rawGradYr = (params.graduationYear || '').match(/\d{4}/g);
  const gradYr    = rawGradYr ? parseInt(rawGradYr[0]) : new Date().getFullYear() + 1;
  const gradYr2   = rawGradYr && rawGradYr[1] ? parseInt(rawGradYr[1]) : gradYr + 1;
  const gradYrStr = rawGradYr ? rawGradYr.join(' OR ') : String(gradYr);

  const isIntern = (params.opportunityTypes || '').toLowerCase().includes('intern');
  const intent   = isIntern ? 'seeking internship' : 'open to work';
  const intKw    = isIntern ? 'internship' : 'full-time';

  // Derive visa keyword from destination country answer
  const visaRaw  = (params.visaStatus || '').toLowerCase();
  const visaKw   = visaRaw.includes('canada') ? 'PGWP'
    : visaRaw.includes('uk') || visaRaw.includes('united kingdom') || visaRaw.includes('graduate visa') ? 'Graduate Visa'
    : visaRaw.includes('ireland') || visaRaw.includes('australia') || visaRaw.includes('uae') || visaRaw.includes('europe') ? 'work permit'
    : 'OPT'; // default: United States

  // Target city hint for GitHub location queries
  const cityHint = params.targetCities && !/all/i.test(params.targetCities)
    ? params.targetCities.split(/[,\/]/).map((c: string) => c.trim().split(' ')[0]).filter(Boolean).join(' OR ')
    : null;

  const exMap: Record<string, string[]> = {
    linkedin: [
      // Tier-1: explicit visa status + intent
      `MS "${field1}" ${visaKw} ${gradYrStr} ${intent} ${origin}`,
      `"F1 visa" "${field1}" "seeking" ${gradYrStr} ${origin}`,
      // Tier-2: degree + origin + year
      `Master of Science "${field1}" ${origin} student ${gradYrStr}`,
      `"${field1}" "${origin}" graduate student ${intKw} ${gradYrStr}`,
      // Tier-3: B.Tech India → MS abroad pattern (100% origin accuracy)
      `"B.Tech" "${field1}" MS ${gradYrStr} ${origin}`,
      `"B.E." OR "B.Tech" India "${field1}" "MS" "seeking" OR "${visaKw}"`,
      // ISA/IGSA membership — community-embedded students
      `"Indian Student Association" "${field1}" MS ${gradYrStr}`,
      `"IGSA" OR "ISA" "${field1}" graduate ${gradYrStr} "seeking"`,
      // Time pressure: imminent graduation = urgency
      `"Graduating May ${gradYr}" "${field1}" "${origin}" "seeking" OR "${visaKw}"`,
      `"Graduating Dec ${gradYr}" "${field1}" "${origin}" "internship" OR "full-time"`,
      `"Incoming Summer ${gradYr}" "${field1}" "${origin}" internship`,
      `"Class of ${gradYr}" "${field1}" "${origin}" "open to work" OR "seeking"`,
      // Skill gap: self-aware about gaps → perfect CareerX candidate
      `"upskilling" "${field1}" MS "${origin}" ${gradYrStr}`,
      `"self-taught" OR "bootcamp" "${field1}" MS "${origin}" "seeking"`,
      // Alternate grad year + field2
      ...(field2 ? [`MS "${field2}" ${origin} ${gradYrStr} ${intent}`] : []),
      `"${field1}" "${origin}" "CPT" OR "${visaKw}" ${gradYr2} entry level`,
      // Comment intent: person actively asked for referrals
      `"interested" "refer me" "${field1}" MS ${origin} ${gradYrStr}`,
      `"looking for referral" "${field1}" "${origin}" "${visaKw}" OR "MS"`,
      // Financial clock: needs immediate joining
      `"immediate joining" "${field1}" "${origin}" MS ${gradYrStr}`,
      `"available immediately" "${field1}" "${origin}" "${visaKw}" seeking`,
      // Resume review help-seekers
      `"resume review" "${field1}" "${origin}" MS ${gradYrStr} seeking`,
      // LinkedIn Premium badge + still seeking = willing buyer
      `"LinkedIn Premium" "${field1}" "${origin}" MS "seeking" OR "open to work"`,
      // Day 1 CPT schools — 100% struggle signal
      `"Harrisburg University" OR "University of the Cumberlands" OR "Trine University" "${field1}" MS ${origin}`,
      `"Monroe College" OR "Westcliff University" "${field1}" MS ${origin} "seeking"`,
      // Body shop exit — wants product company
      `"TCS" OR "Infosys" OR "Wipro" MS "${field1}" ${origin} ${gradYr} "seeking" OR "product company"`,
      // Regional undergrad alma mater dorks
      `"JNTU" OR "Osmania University" MS "${field1}" ${origin} seeking`,
      `"Anna University" OR "SRM" OR "VIT" MS "${field1}" ${origin} "open to work"`,
      `"Jadavpur" OR "IIEST" OR "Calcutta University" MS "${field1}" ${origin} OPT`,
      `"Mumbai University" OR "COEP" OR "VJTI" MS "${field1}" ${origin} seeking`,
      `"AKTU" OR "Delhi University" OR "Amity" MS "${field1}" ${origin} OPT`,
    ],
    google: [
      // Visa/status struggle dorks
      `site:linkedin.com/in/ "${visaKw}" "${field1}" "${origin}" ${gradYrStr}`,
      `site:linkedin.com/in/ "F1" "MS" "${field1}" "${origin}" "seeking"`,
      `site:linkedin.com/in/ "STEM OPT" OR "STEM extension" "${field1}" "${origin}"`,
      `site:linkedin.com/in/ "H1B sponsorship" "MS" "${field1}" "${origin}"`,
      // B.Tech dorks — highly specific India origin signal
      `site:linkedin.com/in/ "B.Tech" "${field1}" "MS" "${origin}" ${gradYrStr}`,
      `site:linkedin.com/in/ "B.Tech" India "MS" "${field1}" "seeking" OR "${visaKw}"`,
      // Time pressure dorks
      `site:linkedin.com/in/ "Graduating ${gradYr}" "${field1}" "${origin}" "${visaKw}" OR "seeking"`,
      `site:linkedin.com/in/ "Class of ${gradYr}" "${field1}" "${origin}" "seeking" OR "looking"`,
      // Skill gap dorks
      `site:linkedin.com/in/ "upskilling" "MS" "${field1}" "${origin}"`,
      `site:linkedin.com/in/ "self-taught" OR "bootcamp" "${field1}" "${origin}" "MS" ${gradYrStr}`,
      // Frustration intent dorks
      `site:linkedin.com/in/ "actively looking" "MS" "${field1}" "${origin}" ${gradYrStr}`,
      `site:linkedin.com/in/ "open to work" "${field1}" "${origin}" "graduate" ${gradYrStr}`,
      // University-targeted dorks
      `site:linkedin.com/in/ "${origin}" "graduate student" "${field1}" "${gradYrStr}"`,
      ...(field2 ? [`site:linkedin.com/in/ "MS" "${field2}" "${origin}" "${visaKw}" OR "seeking"`] : []),
      // Day 1 CPT school dorks
      `site:linkedin.com/in/ "Harrisburg University" OR "Cumberlands" "${field1}" "${origin}"`,
      `site:linkedin.com/in/ "Day 1 CPT" "${field1}" "${origin}" "seeking"`,
      // Body shop exit dorks
      `site:linkedin.com/in/ "TCS" OR "Infosys" "MS" "${field1}" "${origin}" "seeking" OR "product"`,
      `site:linkedin.com/in/ "Wipro" OR "Cognizant" "${field1}" "${origin}" "looking for product company"`,
      // Comment Intent Sniffer (post pages, not profile pages)
      `site:linkedin.com/posts/ "interested" "${field1}" "${origin}" hiring`,
      `site:linkedin.com/posts/ "please refer me" "${field1}" "${origin}"`,
      `site:linkedin.com/posts/ "can anyone refer" "${field1}" "${origin}" "MS" OR "OPT"`,
      `site:linkedin.com/posts/ "looking for referral" "${field1}" "${origin}"`,
      `site:linkedin.com/posts/ "would love to be referred" "${field1}" "${origin}"`,
      `site:linkedin.com/posts/ "open to referral" "${field1}" "${origin}" MS`,
      `site:linkedin.com "interested" "please refer" "${field1}" "${origin}" "MS"`,
      `site:linkedin.com "can anyone refer" "${field1}" "${origin}" "OPT" OR "MS"`,
      `site:linkedin.com "looking for referral" "${field1}" "${origin}"`,
      // Financial clock dorks
      `site:linkedin.com/in/ "immediate joining" "${field1}" "${origin}" "MS"`,
      `site:linkedin.com/in/ "available immediately" "${field1}" "${origin}" "OPT"`,
      `site:linkedin.com/in/ "financial assistance" "${field1}" "${origin}" "seeking"`,
      // Resume review seekers
      `site:linkedin.com "resume review" "${field1}" "${origin}" MS ${gradYrStr}`,
      `site:linkedin.com "critique my resume" "${field1}" "${origin}"`,
      `site:linkedin.com "resume feedback" "${field1}" "${origin}" "not getting interviews"`,
      // LinkedIn Premium seekers
      `site:linkedin.com/in/ "LinkedIn Premium" "${field1}" "${origin}" "seeking" OR "open to work"`,
      // H1B results window (March 25–April 30)
      ...(isH1BResultsWindow() ? [
        `site:linkedin.com/in/ "H1B not selected" OR "H1B rejected" "${field1}" "${origin}"`,
        `site:linkedin.com/in/ "Day 1 CPT" "${field1}" "${origin}" "immediately available"`,
        `site:linkedin.com/in/ "OPT 60 days" OR "60 days OPT" "${field1}" "${origin}"`,
        `site:linkedin.com "just found out" "H1B" "Day 1 CPT" "${field1}"`,
      ] : isH1BSeasonNow() ? [
        `site:linkedin.com/in/ "H1B not selected" OR "Day 1 CPT" "${field1}" "${origin}"`,
        `site:linkedin.com/in/ "OPT extension" "MS" "${field1}" "${origin}" "seeking"`,
      ] : []),
      // ── PDF Resume Hunter — phone + personal email in snippet, completely free ─
      // Indian students abroad post CV PDFs publicly for review. Google indexes them.
      // Resume headers contain local phone (US, UK, CA, AU, DE…), personal email, visa status.
      // WhatsApp-labeled +91 may also appear for students who kept their Indian number.
      `site:linkedin.com "${field1}" "${origin}" "resume" filetype:pdf "OPT" OR "MS"`,
      `site:linkedin.com "${field1}" "${origin}" "resume.pdf" "seeking" OR "open to work"`,
      `site:drive.google.com "${field1}" "${origin}" "MS" "resume" "OPT" OR "F1"`,
      `site:linkedin.com/posts/ "${field1}" "${origin}" "attached my resume" OR "resume for review" OR "please review my resume"`,
      `"${field1}" "${origin}" "MS" filetype:pdf "${visaKw}" "email" ${gradYrStr}`,
      `"${field1}" "${origin}" "MS" filetype:pdf "WhatsApp" "OPT" OR "F1"`,
      `site:github.com "${field1}" "${origin}" "resume" "MS" "OPT" OR "seeking"`,
      // Regional alma mater dorks
      `site:linkedin.com/in/ "JNTU" OR "Osmania University" "MS" "${field1}" "${origin}" "seeking" OR "OPT"`,
      `site:linkedin.com/in/ "GITAM" OR "KLU" "MS" "${field1}" "${origin}" "open to work"`,
      `site:linkedin.com/in/ "Anna University" OR "SRM University" "MS" "${field1}" "${origin}" "seeking"`,
      `site:linkedin.com/in/ "VIT Vellore" OR "PSG College" "MS" "${field1}" "${origin}" OPT`,
      `site:linkedin.com/in/ "Jadavpur University" OR "IIEST" "MS" "${field1}" "${origin}" "open to work"`,
      `site:linkedin.com/in/ "Mumbai University" OR "Pune University" OR "COEP" "MS" "${field1}" "${origin}"`,
      `site:linkedin.com/in/ "AKTU" OR "IPU" OR "DTU" OR "NSIT" "MS" "${field1}" "${origin}" OPT`,
    ],
    github: [
      `location:"United States" "${origin}" "open to" OR "looking for" language:Python`,
      `location:"United States" "${field1}" "MS" OR "Masters" ${origin} followers:>1`,
      ...(cityHint
        ? [`location:${cityHint.split(' OR ').map((c: string) => `"${c}"`).join(' OR location:')} "${origin}" "seeking" language:Python`]
        : [`location:"New York" OR location:"San Jose" OR location:"Seattle" "${origin}" "seeking" language:Python`]
      ),
      `location:"Boston" OR location:"Austin" OR location:"Atlanta" "${field1}" "${origin}"`,
      `"${field1}" "${origin}" "open to work" OR "job hunting" language:Python`,
    ],
    reddit: [
      `subreddit:f1visa "${field1}" "no offers" OR "struggling" OR "please help" ${origin}`,
      `subreddit:f1visa ${visaKw} "${field1}" ${gradYrStr} ${origin}`,
      `subreddit:cscareerquestions "MS" "${field1}" ${visaKw} ${gradYrStr} "no interviews" OR "resume" OR "rejected"`,
      `subreddit:cscareerquestions "international student" "${field1}" "entry level" ${gradYrStr}`,
      `subreddit:gradadmissions "${field1}" "${origin}" ${intKw} "help" OR "advice"`,
      `subreddit:immigration ${visaKw} EAD "${field1}" "job" ${origin}`,
      `subreddit:indiansabroad "${field1}" job ${visaKw} ${gradYrStr}`,
      `subreddit:ABCDesis "${field1}" "new grad" OR "entry level" OR "struggling"`,
      `subreddit:usajobs OR subreddit:jobsearchhacks "international" "${field1}" ${visaKw} ${gradYrStr}`,
      // H1B results window crisis posts
      ...(isH1BResultsWindow() ? [
        `subreddit:f1visa "just found out" "H1B not selected" "${field1}" ${origin}`,
        `subreddit:f1visa "H1B rejected" OR "didn't get selected" "what now" "${field1}"`,
        `subreddit:immigration "H1B lottery" "not selected" "Day 1 CPT" ${origin}`,
        `subreddit:f1visa "60 days" OR "90 days" "OPT" "H1B" "panic" "${field1}"`,
      ] : isH1BSeasonNow() ? [
        `subreddit:f1visa "H1B not selected" OR "didn't get H1B" "${field1}" ${origin}`,
        `subreddit:f1visa "Day 1 CPT" OR "day1 cpt" "${field1}" "job" ${origin}`,
        `subreddit:immigration "H1B lottery" "not selected" "${field1}" ${gradYrStr}`,
      ] : []),
      `subreddit:cscareerquestions "TCS" OR "Infosys" OR "Wipro" "product company" "${field1}" ${origin}`,
      ...(field2 ? [`subreddit:f1visa OR subreddit:cscareerquestions "${field2}" OPT struggling ${origin}`] : []),
    ],
  };

  const annotations: Record<string, string> = {
    linkedin: `(layers: OPT/F1 → degree+origin+year → B.Tech+Indian uni → ISA/IGSA → comment intent → financial clock → regional alma mater)`,
    google:   `(dork layers: OPT/visa struggle → B.Tech India specific → /posts/ comment hunter → frustration intent → uni-targeted → regional alma mater [JNTU/Anna/Jadavpur/COEP/AKTU])`,
    github:   `(US location → tech hubs → field repo signals)`,
    reddit:   `(f1visa+cscareer struggle → gradadmissions → immigration → indiansabroad → ABCDesis)`,
  };

  return sequence
    .filter(p => exMap[p])
    .map(p => `- ${p} ${annotations[p] || ''}:\n  ${exMap[p].map((q, i) => `${i + 1}. ${q}`).join('\n  ')}`)
    .join('\n');
}

export function buildAgentPrompt(params: any): string {
  const target = parseInt(params.leadCount, 10) || 50;
  const { sequence, rationale } = buildPlatformStrategy(params);
  const scrapeLimit = Math.min(target * 4, 200);

  const platformGuide = sequence.map((p, i) =>
    `${i + 1}. "${p}" — ${rationale[p]}`
  ).join('\n');

  const queryExamples = buildQueryExamples(params, sequence);

  const h1bSeasonNote = isH1BResultsWindow()
    ? `\n🚨 H1B RESULTS WINDOW (March 25–April 30): USCIS is announcing H1B lottery selections RIGHT NOW. Thousands of Indian students are finding out TODAY they didn't get selected — peak panic, maximum urgency. HAMMER queries with "just found out H1B not selected", "H1B rejected", "Day 1 CPT now", "OPT 60 days". These leads are in crisis mode and will convert in hours, not days.\n`
    : isH1BSeasonNow()
    ? `\n⚠️ H1B SEASON ACTIVE (March–May): H1B lottery registration just closed / results imminent. Thousands of Indian students will find out they didn't get selected — peak panic period. PRIORITISE queries with "H1B not selected", "Day 1 CPT", "OPT extension". These leads have MAXIMUM urgency and will convert fastest.\n`
    : '';

  // Target cities hint for github queries
  const cityHint = params.targetCities && !/all/i.test(params.targetCities)
    ? params.targetCities.split(/[,\/]/).map((c: string) => c.trim().split(' ')[0]).filter(Boolean).join(' OR ')
    : null;

  return `You are a Lead Discovery Agent for CareerXcelerator. Find ${target} qualified leads matching the target profile below.
${h1bSeasonNote}
TARGET PROFILE:
- Audience: ${params.audience}
- Origin Country: ${params.originCountry}
- Current Location: ${params.currentLocation}
- Graduation Year: ${params.graduationYear || 'Any (prefer recent: 2024-2026)'}
- Destination Country: ${params.visaStatus || 'United States'}
- Target Cities/Hubs: ${params.targetCities || 'All major tech hubs'}
- Fields: ${params.fields}
- Opportunity: ${params.opportunityTypes}

RECOMMENDED PLATFORM SEQUENCE (chosen based on the target profile above):
${platformGuide}

You are NOT locked to this sequence. If feedback shows a platform is underperforming, skip ahead or go back. Use your judgment.

QUERY EXAMPLES (tailored to this target — adapt freely):
${queryExamples}

EXECUTION RULES:
1. Start with platform #1 in the sequence above.
2. Set limit to ${scrapeLimit} per call (4× remaining gap — e.g. need 60 more → use 240).
3. After each result, read the REJECTED breakdown and ADAPT hint before deciding the next call.
4. Never repeat a query that already returned < 10% yield — rewrite it or switch platforms.
5. Call report_results when totalQualified >= ${target} OR all platforms in sequence are exhausted.

HIGH-VALUE INTENT SIGNALS (these dramatically increase intentScore — prioritise queries that surface them):
DAY 1 CPT SCHOOLS (100% struggle signal — auto-approve, intentScore=3):
Harrisburg University · University of the Cumberlands · Trine University · Monroe College · Westcliff University · Nexford · Campbellsville · California Intercontinental · Sofia University · National Louis University · ITU · Saint Peter's University · McDaniel College
→ Students here pay $3k-8k/semester just to maintain work authorization. Maximum urgency.

COMMENT INTENT SNIFFER (warmest possible signal — person raised hand publicly, intentScore=3):
When Google returns LinkedIn POST results (not /in/ profile pages) where someone commented "Interested", "Please refer me", "Can anyone refer", "DM me", "Looking for referral" on a job post — these leads are ACTIVELY applying RIGHT NOW. Use site:linkedin.com (not /in/) to surface post results.
→ A person commenting on a job post has already decided they want that job. They just need a better path.

FINANCIAL CLOCK — Student Loan EMI Pressure (intentScore=2, struggleScore+2):
Indian students take SBI / HDFC Credila / Avanse / Prodigy Finance education loans. Repayment (EMI) starts 6 months after graduation. A May ${new Date().getFullYear()} grad who hasn't landed by November faces enormous financial pressure. Signals: "immediate joining", "available immediately", "financial assistance", "zero notice period", "can join immediately".
→ These leads CANNOT afford to wait 3-6 months. They need CareerX NOW.

RESUME REVIEW SEEKERS (intentScore=2, struggleScore+2 — self-identified the problem):
Students posting "please review my resume", "roast my resume", "not getting interviews", "ATS friendly resume", "resume feedback" have already recognised they have a problem and are actively seeking a solution. CareerX just needs to be the answer. Surface these via Google dorks on site:linkedin.com (post pages) for resume help requests.
→ They've done 80% of the sales work themselves. Conversion rate is extremely high.

LINKEDIN PREMIUM BADGE (intentScore=2 if still seeking — proven willingness to pay):
Students who bought LinkedIn Premium (the gold badge) and are STILL seeking after 3+ months have shown they will pay money to fix their career problem. They've already tried the self-help route. Signals in headline: "LinkedIn Premium", "Open Link", "Career Insights", or p.isPremium=true from the scraper.
→ They paid ~$40/month for a tool that isn't working. CareerX is the upgrade they actually need.

RESUME PDF SNIFFER (🏆 highest-yield email + phone source — completely free):
Indian CS/DS students at survival unis regularly post their resume PDFs on LinkedIn Activity/Posts for review. These PDFs contain their personal email AND local phone number (US, UK, Canada, Australia, Germany, UAE — wherever they are).
→ Google dork: site:linkedin.com "[field]" "[origin]" "resume" filetype:pdf "OPT" OR "MS"
→ Also try: site:drive.google.com "[field]" "[origin]" "MS" "resume" "OPT"
→ Post sniffer: site:linkedin.com/posts/ "[field]" "[origin]" "attached my resume" OR "resume for review"
When Google returns a PDF result from a LinkedIn post/activity, it means:
1. The student publicly shared their resume asking for feedback → highest intent signal
2. The PDF contains their personal email and phone → direct contact without InMail
3. They've already decided they need help — 90% pre-sold to CareerXcelerator

GITHUB README GOLDMINE (email extracted automatically from username/username repo):
The system already fetches the GitHub intro README (username/username repo) for every GitHub profile found. 90% of CS students list their email there for recruiters. No API key needed — completely free.
→ If email appears in a lead's record from GitHub, it came from their README — it's always their personal/student email, not a professional address.

CONSULTANCY EXIT SIGNAL (salary-doubling angle — high pain, wants product company):
Experience at TCS · Infosys · Wipro · Cognizant · HCL Technologies · Tech Mahindra · Mphasis · Hexaware · Mindtree + currently seeking product-company role = strong CareerX fit.
→ Body shop salary: $60-80k. Product company salary: $130-160k. CareerX is the bridge to doubling their income.

ORIGIN CONFIRMATION signals (5-way check — any one is sufficient to confirm Indian origin):
  1. SURNAME: Sharma/Patel/Singh/Reddy/Iyer/Nair/Kulkarni/Gill/Shah/Mahapatra etc.
  2. B.TECH UNDERGRAD: Education shows "B.Tech" or "B.E." from Indian university (Anna/VTU/JNTU/NIT/VIT/SRM/Manipal/Amity/LPU)
  3. INDIAN LANGUAGE: Hindi/Telugu/Tamil/Marathi/Gujarati/Punjabi/Bengali/Kannada/Malayalam in Languages
  4. ISA/IGSA MEMBERSHIP: Indian Student Association, IGSA, Telugu Association, Tamil Sangam, Desi club
  5. PREP SERVICES: Yocket/LeapScholar/IDP Education/Manya/Jamboree/Gradvine in profile

REGIONAL TARGETING — Undergrad Alma Mater = Origin (100% Accuracy for B.Tech grads):
  Telugu origin → JNTU · Osmania · Andhra University · GITAM · KLU · RGUKT
  Tamil origin  → Anna University · SRM · VIT · PSG · KCT · SASTRA · NIT Trichy
  Bengali origin → Jadavpur · IIEST · Calcutta University · Techno India
  Marathi origin → Mumbai University · Pune University · COEP · VJTI · Shivaji University
  Punjabi origin → Thapar · LPU · Chitkara · Punjabi University · GNDU
  Gujarati origin → Gujarat University · Nirma · SVNIT · DDIT
  Hindi/North origin → AKTU · IPU · DTU · NSIT · Delhi University · Amity
→ Dork strategy: site:linkedin.com/in/ "[undergrad uni]" "MS" "[field]" "[origin]" "seeking"
→ This targets people who did B.Tech in India and are now doing MS in USA — perfect ICP.
VISA/STATUS signals (strongest — student faces a structural barrier, exactly our ICP):
  OPT · F1 · CPT · EAD · "visa sponsorship" · "no sponsorship needed" · "work authorization"
  "OPT student" · "F1 student" · "STEM OPT" · "H1B" (already navigating the system)
ACTIVE JOB HUNT signals:
  "open to work" · "actively looking" · "seeking internship" · "job hunt" · "entry-level"
  "no offers" · "struggling" · "resume review" · "please help" · "no interviews" · "rejected"
  "career switch" · "new grad" · "recent graduate" · "graduating soon"
FRUSTRATION/STRUGGLE signals (highest conversion — they NEED the service):
  "no callbacks" · "ghosted" · "ATS" · "rejections" · "application season" · "no response"
  Reddit posts asking for resume/job help, posting rejection counts, asking for advice

Use these as secondary qualifiers: a profile with OPT + "no interviews" is a stronger lead than one with neither, even at the same qualityScore.

REDDIT SUBREDDIT PRIORITY (highest-intent first):
1. r/f1visa            — OPT job hunt venting, asking for help → highest struggle signal
2. r/cscareerquestions — rejection counts, resume help, entry-level frustration
3. r/gradadmissions    — earlier funnel but shows degree + field + origin clearly
4. r/immigration       — OPT/EAD/H1B navigators → strong visa-struggle signal
5. r/usajobs / r/jobsearchhacks — international applicants asking for strategy
6. r/datascience / r/MachineLearning — field-specific, find active students

Reddit query tip: include sentiment words (struggling, help, no offers, ghosted) alongside field + visa keywords. Posts WITH these words indicate active pain.

ADAPTING FROM FEEDBACK:
Each result returns: yield rate · T1/T2/T3 · REJECTED breakdown · QUALIFIED universities/fields · ADAPT hint.

REJECTED line tells you WHY profiles failed — act on it:
- "wrong origin" dominant      → add "${params.originCountry}" AND common surnames; try "Indian student" "desi" explicitly
- "not Masters" dominant       → add "MS" "Master of Science" "graduate student"; drop bachelor/undergrad signals
- "missing education" dominant → switch to google dork with university name in query, or target specific school names
- "elite university" dominant  → add "state university" "regional" "polytechnic" explicitly; remove prestige keywords
- "senior title" dominant      → add "student" "${new Date().getFullYear() + 1}" "${new Date().getFullYear() + 2}" "recent grad"
- "too low score" dominant     → layer visa/OPT signals: "OPT" "F1" "visa sponsorship" + frustration keywords
- low Reddit yield             → switch subreddits (f1visa → cscareerquestions → immigration); add struggle sentiment

QUALIFIED UNIVERSITIES line tells you which schools are producing leads — if the same 2–3 schools dominate every batch, your queries are too narrow. Explicitly name different universities in the next queries.

PLATFORM SWITCHING LOGIC:
- yield ≥ 20% and still short   → stay, rotate visa signals (OPT → F1 → CPT) in fresh queries
- yield 10–20%                  → try one more call with rewritten queries, then switch
- yield < 10%                   → follow ADAPT hint, then switch to next platform in sequence
- github returning 0 tech leads → bio/location signals absent; skip to google dorks
- google returning duplicates   → change dork keywords, add OPT/visa intent phrases not yet tried
- reddit returning few profiles → switch to higher-struggle subreddit (r/f1visa is usually best)

Begin now with platform #1: "${sequence[0]}".`;
}
