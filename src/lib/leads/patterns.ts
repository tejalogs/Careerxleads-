// ── Qualification constants ────────────────────────────────────────────────────
export const SENIOR_TITLES = [
  'director', 'vp', 'vice president', 'head of', 'chief',
  'cto', 'ceo', 'principal', 'senior manager',
];
export const LOW_FIELDS = [
  'history', 'philosophy', 'literature', 'fine arts', 'art history', 'music', 'theater',
];

// ── Indian origin signals ─────────────────────────────────────────────────────
export const INDIAN_SURNAME_RE = /sharma|patel|desai|gupta|singh|kumar|mehta|joshi|kapoor|verma|reddy|rao|iyer|iyengar|nair|pillai|chandra|krishna|agarwal|malhotra|bose|chatterjee|mukherjee|banerjee|das|ghosh|sen|saha|basu|dey|roy|mishra|tiwari|pandey|dubey|yadav|shukla|srivastava|tripathi|chauhan|jain|mahajan|kulkarni|deshpande|parekh|sanghavi|shah|modi|parikh|thakkar|bhatt|trivedi|deshmukh|bhosale|jadhav|shinde|patil|mahapatra|panda|mohanty|nanda|gill|sidhu|dhillon|sandhu|grewal|brar|bajwa|arora|khanna|sethi|anand|chopra|bhatia|naidu|goud|chettiar|subramaniam|venkat|rajan|krishnan|swamy|hegde|shetty|menon|varma|murthy/i;

export const INDIAN_UNI_RE = /anna university|vtu|visvesvaraya|jntu|jawaharlal nehru technological|pu chandigarh|mumbai university|pune university|osmania university|bangalore university|calicut university|kerala university|madras university|delhi university|du\b|bhu|banaras|allahabad university|amity|chandigarh university|lpu|lovely professional|vit|srm|manipal|saveetha|sastra|shiv nadar|shivaji university|nit |national institute of technology|bits pilani|bits goa|bits hyderabad|nims|gitam|klu|kluniversity|nit surathkal|nit trichy|nit warangal|iiest|jadavpur|calcutta university|presidency|fergus|fergusson|pccoe|coep|coe pune|sgsits|ies ips|rgpv|csvtu|maulana azad|dr mgr|anna|coimbatore institute|psg|kct|mepco|karunya/i;

export const ISA_ORG_RE = /\bisa\b|igsa|indian student association|association of indian students|desi|isaca india|telugu association|tamil sangam|gujarati samaj|malayalee|bengali association|marathi mandal/i;

export const DESI_LANGUAGE_RE = /hindi|telugu|tamil|marathi|gujarati|punjabi|bengali|kannada|malayalam|urdu|odia|assamese/i;

export const INDIA_PREP_RE = /yocket|leapscholar|leap scholar|idp education|manya|princeton review india|jamboree|gradvine|edwise|ims india|made easy/i;

export const CPT_UNI_RE = /harrisburg university|university of the cumberlands|cumberlands university|trine university|monroe college|westcliff university|nexford university|greenwich university|california intercontinental|campbellsville university|national university.*san diego|southern states university|university of fairfax|midwest university|university of silicon valley|silicon valley university|american national university|university of north america|una\b|california miramar|strayer university|american intercontinental|sofia university|national louis university|\bnlu\b|international technological university|\bitu\b|saint peter.{0,5}university|mcdaniel college/i;

export const BODY_SHOP_RE = /\btcs\b|tata consultancy|infosys\b|wipro\b|cognizant\b|hcl technologies|tech mahindra|mphasis|hexaware|mindtree|l&t infotech|larsen.*toubro.*infotech|ltimindtree|\blti\b|mastech|mastech digital|syntel\b|igate\b|patni\b|niit technologies|zensar|persistent systems|virtusa|coforge|collabera|diverse.?lynx|princeton information|ust global|\bust\b.*technologies|cyient|birlasoft|yash technologies|compugain|trigent software|kellton tech|datamatics|css corp|movate\b|\beclerx\b|nagarro\b|infogain\b|jade global|apexon\b|\biolap\b|bahwan cybertek|softcrylic|svam international|coda global|infovision\b|inforeliance|srinsoft|ilink systems|sonata software/i;

export const COMMENT_INTENT_RE = /\binterested\b|please refer me|can anyone refer|refer me|dm me|looking to connect|open for referral|would love to be referred|can refer|actively applying|please share.*resume|tag me|drop your resume|referral.*request|looking for referral|would appreciate a referral/i;

export const FINANCIAL_CLOCK_RE = /\bemi\b|loan repayment|education loan|sbi loan|hdfc credila|\bavanse\b|prodigy finance|\bmpower\b|need job urgently|immediate joining|immediate start|financial assistance|financial pressure|can.{0,10}join immediately|available immediately|notice period.*zero|zero notice period|relieve.*immediately/i;

export const RESUME_REVIEW_RE = /resume review|critique my resume|please review my resume|roast my resume|resume feedback|resume help|\bcv review\b|resume critique|ats score|ats friendly|resume tips|career review|profile review|improving my resume|rewriting my resume|resume not getting|resume getting rejected|not getting interviews/i;

export const LINKEDIN_PREMIUM_RE = /linkedin premium|premium member|open link|career insights|inmail credit|premium subscriber|career premium|linkedin career/i;

export const PRODUCT_COMPANY_RE = /\bgoogle\b|alphabet\b|meta\b|facebook\b|amazon\b|\baws\b|microsoft\b|apple\b|netflix\b|uber\b|airbnb\b|stripe\b|databricks\b|openai\b|salesforce\b|adobe\b|nvidia\b|palantir\b|doordash\b|lyft\b|pinterest\b|reddit\b|twitter\b|\bx\.com\b|linkedin\b|snap\b|spotify\b|dropbox\b|square\b|block\b|robinhood\b|coinbase\b|twilio\b|snowflake\b|confluent\b|hashicorp\b|figma\b|notion\b|asana\b|monday\.com\b/i;

// ── Elite university set (HARD REJECT — outside ICP) ─────────────────────────
const ELITE_UNIS = new Set([
  'mit', 'massachusetts institute of technology',
  'stanford', 'stanford university',
  'harvard', 'harvard university',
  'carnegie mellon', 'carnegie mellon university', 'cmu',
  'uc berkeley', 'university of california berkeley', 'berkeley',
  'caltech', 'california institute of technology',
  'princeton', 'princeton university', 'yale', 'yale university',
  'columbia', 'columbia university', 'cornell', 'cornell university',
  'university of michigan', 'umich', 'ucla', 'university of california los angeles',
  'uiuc', 'university of illinois', 'illinois urbana',
  'duke', 'duke university', 'johns hopkins', 'jhu',
  'northwestern', 'northwestern university',
  'georgia tech', 'georgia institute of technology',
  'purdue', 'purdue university', 'university of washington',
  'dartmouth', 'dartmouth college', 'brown university',
  'university of pennsylvania', 'upenn', 'wharton',
  'rice university', 'vanderbilt university', 'emory university',
  'university of notre dame', 'washington university in st louis', 'wustl',
  'university of virginia', 'uva', 'university of north carolina', 'unc chapel hill',
  'university of southern california', 'usc viterbi',
  'indian institute of technology',
  'iit bombay', 'iit delhi', 'iit madras', 'iit kanpur', 'iit kharagpur',
  'iit roorkee', 'iit guwahati', 'iit hyderabad', 'iit gandhinagar', 'iit bhu',
  'iit jodhpur', 'iit patna', 'iit mandi', 'iit tirupati', 'iit palakkad',
  'iit dharwad', 'iit bhilai', 'iit jammu', 'iit indore', 'iit varanasi',
  'iisc', 'indian institute of science',
  'indian institute of management', 'iim ahmedabad', 'iim bangalore',
  'iim calcutta', 'iim kozhikode', 'iim lucknow', 'iim indore', 'iim shillong',
  'bits pilani', 'bits goa', 'bits hyderabad',
  'university of oxford', 'oxford university', 'university of cambridge', 'cambridge university',
  'imperial college', 'imperial college london',
  'london school of economics', 'lse', 'ucl', 'university college london',
  'university of toronto', 'u of toronto', 'university of british columbia', 'ubc',
  'university of waterloo', 'mcgill', 'mcgill university',
  'national university of singapore', 'nus', 'nanyang technological university', 'ntu singapore',
  'university of melbourne', 'university of sydney',
  'unsw', 'university of new south wales', 'australian national university', 'anu',
  'tu munich', 'technical university of munich', 'tum',
  'lmu munich', 'ludwig maximilian university', 'rwth aachen',
  'eth zurich', 'epfl',
  'peking university', 'pku', 'tsinghua', 'tsinghua university',
  'hkust', 'hong kong university of science and technology',
]);

export function isEliteUni(university: string): boolean {
  const u = university.toLowerCase().trim();
  if (!u) return false;
  if (ELITE_UNIS.has(u)) return true;
  // Word-boundary check: match only if the elite name appears as a complete
  // word/phrase within the university string (prevents "Columbia" matching
  // "British Columbia" or "Stanford" matching "Stanford-adjacent Community College")
  return Array.from(ELITE_UNIS).some(e => {
    if (e.length < 7) return false;
    const re = new RegExp(`(?:^|\\W)${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\W|$)`, 'i');
    return re.test(u);
  });
}

// ── University tiering ────────────────────────────────────────────────────────
// Tier 2: well-known mid-tier — decent recruiting but high competition
const TIER2_UNI_PATTERNS = [
  'san jose state', 'sjsu', 'ut dallas', 'university of texas at dallas',
  'northeastern', 'drexel', 'arizona state', 'asu',
  'university of florida', 'ohio state', 'university of maryland',
  'university of minnesota', 'penn state', 'pennsylvania state', 'michigan state',
  'university of pittsburgh', 'university of massachusetts', 'umass',
  'rutgers', 'stony brook', 'suny stony brook',
  'george mason', 'george washington', 'gwu', 'boston university',
  'university of illinois at chicago', 'uic', 'university of houston',
  'temple university', 'rensselaer polytechnic', 'rpi',
  'worcester polytechnic', 'wpi', 'depaul', 'villanova',
  'texas tech', 'virginia tech', 'clemson',
  'university of connecticut', 'uconn', 'university of delaware',
  'university of iowa', 'university of colorado', 'university of arizona',
];

// Tier 3: regional/private — prime CareerX targets (recruiters rarely visit)
const TIER3_UNI_PATTERNS = [
  'stevens institute', 'illinois institute of technology', 'illinois tech',
  'new jersey institute', 'njit', 'pace university', 'hofstra',
  'long island university', 'liu', 'fairleigh dickinson', 'fdu',
  'kean university', 'montclair state', 'florida international', 'fiu',
  'florida atlantic', 'fau', 'university of central florida', 'ucf',
  'university of south florida', 'usf', 'california state', 'cal state',
  'california polytechnic', 'cal poly', 'san francisco state', 'sfsu',
  'san diego state', 'sdsu', 'colorado state', 'kansas state',
  'oklahoma state', 'louisiana state', 'lsu', 'university of alabama',
  'university of arkansas', 'wright state', 'kent state', 'bowling green',
  'western michigan', 'eastern michigan', 'ball state',
  'indiana university purdue', 'iupui', 'university of memphis',
  'university of louisville', 'old dominion', 'virginia commonwealth', 'vcu',
  'howard university', 'morgan state', 'florida state',
  'university of mississippi', 'university of nebraska', 'university of nevada',
  'university of new mexico', 'university of akron', 'university of dayton',
  'university of hartford', 'quinnipiac', 'sacred heart', 'adelphi',
  'nyit', 'new york institute of technology',
  'suny albany', 'suny buffalo', 'suny binghamton', 'suny new paltz',
  'mercy college', 'molloy', 'touro', 'yeshiva university',
];

/** 1=elite (reject), 2=mid-tier target, 3=prime regional, 4=ultra-prime small */
export function categorizeUniversity(university: string): 1 | 2 | 3 | 4 {
  if (isEliteUni(university)) return 1;
  const u = university.toLowerCase().trim();
  if (TIER2_UNI_PATTERNS.some(p => u.includes(p))) return 2;
  if (TIER3_UNI_PATTERNS.some(p => u.includes(p))) return 3;
  return 4;
}
