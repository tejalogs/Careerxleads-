export interface Lead {
  id: string;
  name: string;
  linkedinUrl: string;
  university: string;
  degree: string;
  fieldOfStudy: string;
  graduationYear: string;
  location: string;
  headline: string;
  email: string | null;
  phone: string | null;           // extracted from PDF resume snippet or GitHub README
  socialMediaUrl: string | null;
  seekingInternship: boolean;
  seekingFullTime: boolean;
  tier: 1 | 2 | 3;       // 1=hot (score≥8+intent3), 2=warm, 3=cold
  intentScore: number;   // 1, 2, or 3
  qualityScore: number;  // 0–10 composite quality score
  outreachMessage: string;
  status: 'new' | 'contacted' | 'replied' | 'call booked' | 'converted';
  reviewFlag: 'approved' | 'review_needed';
  feedback?: 'good_lead' | 'irrelevant_lead' | 'converted_lead';
  struggleScore?: number;      // 0–10: profile-gap signals (grad gap, no internship, visa, thin profile)
  universityTier?: 2 | 3 | 4; // 2=mid-tier target, 3=prime regional, 4=ultra-prime small (1=elite → rejected)
  networkingScore?: number;    // 0–10: product-company network exposure (low = service-company trap)
  optDaysRemaining?: number;   // days until 90-day OPT unemployment limit (set when < 90 days post-grad)
  detectedLanguage?: string;   // first Indian language detected (Telugu/Tamil/etc.) for regional outreach
  regionalTag?: string;        // highest-confidence region via 4-signal combinator (undergrad uni > lang > org > surname)
  qualityBreakdown: {
    indianOriginConfirmed: boolean;
    mastersStudent: boolean;
    jobSearchIntent: boolean;
    relevantField: boolean;
    profileComplete: boolean;
    nonTier1University: boolean;
  };
  metadata?: { platform?: string; actor?: string; [key: string]: unknown };
}

export interface GenerationParams {
  audience: string;
  originCountry: string;
  currentLocation: string;
  graduationYear: string;
  stage: string;
  fields: string;
  visaStatus: string;
  opportunityTypes: string;
  targetCities: string;
  leadCount: string;
}

export interface PipelineStats {
  scraped: number;
  qualified: number;
  rejected: number;
}

export interface SearchHistoryEntry {
  id: string;
  timestamp: string;
  params: GenerationParams;
  qualifiedCount: number;
}
