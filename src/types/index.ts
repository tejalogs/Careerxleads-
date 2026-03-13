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
  socialMediaUrl: string | null;
  seekingInternship: boolean;
  seekingFullTime: boolean;
  intentScore: number; // 1, 2, or 3
  qualityScore: number; // 0–10 composite quality score (Guardrail 9)
  outreachMessage: string;
  status: 'new' | 'contacted' | 'replied' | 'call booked' | 'converted';
  reviewFlag: 'approved' | 'review_needed'; // Guardrail 11
  feedback?: 'good_lead' | 'irrelevant_lead' | 'converted_lead'; // Guardrail 12
  qualityBreakdown: {
    indianOriginConfirmed: boolean;   // Guardrail 2: +3
    mastersStudent: boolean;          // Guardrail 3: +2
    jobSearchIntent: boolean;         // Guardrail 5: +2
    relevantField: boolean;           // Guardrail 4: +1
    profileComplete: boolean;         // Guardrail 7: +1
    nonTier1University: boolean;      // Guardrail 6: +1
  };
}

export interface GenerationParams {
  audience: string;
  originCountry: string;
  currentLocation: string;
  stage: string;
  fields: string;
  opportunityTypes: string;
  leadCount: string;
}
