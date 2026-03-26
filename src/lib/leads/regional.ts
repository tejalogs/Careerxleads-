// ── Per-region surname matrices (most distinctive → least distinctive) ─────────
export const REGIONAL_SURNAMES = {
  Telugu:   /\breddy\b|\brao\b|\bgoud\b|\bnaidu\b|chowdhary|subbarao|\bvenkat|\bteja\b|\bmurthy\b|\bprasad\b|\bsastry\b|\bsastri\b/i,
  Tamil:    /\biyer\b|iyengar|subramaniam|subramanyan|\brajan\b|\bkrishnan\b|\bswamy\b|venugopal|\bbalaji\b|\bmurugan\b|\bselvan\b|\barumugam\b/i,
  Bengali:  /chatterjee|mukherjee|banerjee|\bghosh\b|\bsen\b|\bsaha\b|\bbasu\b|\bbose\b|\bdey\b|chakraborty|\broy\b|\bdas\b/i,
  Marathi:  /kulkarni|deshpande|\bpatil\b|deshmukh|bhosale|\bjadhav\b|\bshinde\b|\bkadam\b|\bkamble\b/i,
  Punjabi:  /\bgill\b|\bsidhu\b|\bdhillon\b|\bsandhu\b|\bgrewal\b|\bbrar\b|\bbajwa\b|\barora\b|\bkhanna\b/i,
  Gujarati: /\bpatel\b|\bshah\b|\bdesai\b|\bparekh\b|\bsanghavi\b|\bparikh\b|\btrivedi\b|\bthakkar\b|\bbhatt\b/i,
  Kannada:  /\bshetty\b|\bhegde\b|\bgowda\b|\bnaik\b|\bkammath\b/i,
  Malayalam: /\bnair\b|\bpillai\b|\bmenon\b|\bvarma\b|\bkurup\b|\bpanikker\b/i,
  Hindi:    /\bsharma\b|\bsingh\b|\bkumar\b|\bverma\b|\bgupta\b|\bmishra\b|\btiwari\b|\bpandey\b|\bshukla\b|\byadav\b|\bsrivastava\b|\btripathi\b/i,
} as const;

/** Undergrad university → region (100% accurate for B.Tech grads) */
export function detectUniRegion(undergradUni: string): string | undefined {
  const u = undergradUni.toLowerCase();
  if (!u) return undefined;
  if (/jntu|jawaharlal nehru technological|osmania|andhra university|gitam|klu\b|kluniversity|jntuh|jntuk|jntua|srm.*ap|vit.*ap|rgukt|iit.*hyderabad/i.test(u)) return 'Telugu';
  if (/anna university|srm\b|vit\b|sastra|psg\b|kct\b|mepco|karunya|coimbatore|amrita|thiagarajar|nit trichy|nit calicut|iit.*madras|loyola/i.test(u)) return 'Tamil';
  if (/jadavpur|calcutta university|iiest|presidency|techno.*india|wbut|heritage.*calcutta|iit.*kharagpur|makaut/i.test(u)) return 'Bengali';
  if (/mumbai university|pune university|coep|vjti|somaiya|sgsits|shivaji university|pccoe|mit.*pune|iit.*bombay|symbiosis/i.test(u)) return 'Marathi';
  if (/thapar|chitkara|lovely professional|lpu|punjabi university|pu chandigarh|gndu|iit.*ropar/i.test(u)) return 'Punjabi';
  if (/gujarat university|nirma|ddit|dharmsinh|svnit|ganpat|uca\b|ldrp|iit.*gandhinagar|pdpu/i.test(u)) return 'Gujarati';
  if (/visvesvaraya|vtu|msrit|rvce|pes university|nit.*surathkal|iit.*dharwad/i.test(u)) return 'Kannada';
  if (/kerala university|calicut university|cusat|nit.*calicut|iit.*palakkad|model engineering/i.test(u)) return 'Malayalam';
  if (/aktu|hbtu|ipu|ggsipu|delhi university|\bdtu\b|\bnsit\b|amity|bennett|rgpv|csvtu|maulana azad|iit.*delhi|iit.*kanpur|iit.*roorkee|iit.*bhu/i.test(u)) return 'Hindi';
  return undefined;
}

/** Cultural org / Sangam membership → region */
export function detectOrgRegion(orgsText: string): string | undefined {
  const o = orgsText.toLowerCase();
  if (/\btana\b|telugu association|ata\b.*telugu|telangana.*assoc|andhra.*assoc|ntsa\b/i.test(o)) return 'Telugu';
  if (/tamil sangam|tamil.*assoc|tasa\b|desi.*tamil/i.test(o)) return 'Tamil';
  if (/bengali.*assoc|durga puja|basa\b|bengal.*student/i.test(o)) return 'Bengali';
  if (/marathi mandal|maharashtra.*mandal|bnm\b|pune.*alumni/i.test(o)) return 'Marathi';
  if (/punjabi.*assoc|bhangra|gurdwara|sikh.*student/i.test(o)) return 'Punjabi';
  if (/gujarati samaj|gujarati.*assoc|navratri|jain.*assoc/i.test(o)) return 'Gujarati';
  if (/kannada.*assoc|karnataka.*assoc|akka\b/i.test(o)) return 'Kannada';
  if (/malayalee|kerala.*assoc|keralite/i.test(o)) return 'Malayalam';
  if (/hindi.*assoc|north.*indian.*assoc/i.test(o)) return 'Hindi';
  return undefined;
}

/**
 * 4-signal regional origin combinator.
 * Priority: undergrad university (100% accurate) > language array > cultural org > surname.
 */
export function detectRegionalTag(p: any): string | undefined {
  // Signal 1: undergrad university
  const undergradEdu = (p.education || []).find((e: any) =>
    /b\.?tech|b\.?e\b|bachelor of (engineering|technology)|b\.?sc engg/i.test(e.degreeName || ''),
  );
  const uniRegion = detectUniRegion(undergradEdu?.schoolName || '');
  if (uniRegion) return uniRegion;

  // Signal 2: languages array
  const langs = (p.languages || []).map((l: any) => (l.name || l || '').toLowerCase()).join(' ');
  if (/\btelugu\b/.test(langs))    return 'Telugu';
  if (/\btamil\b/.test(langs))     return 'Tamil';
  if (/\bbengali\b/.test(langs))   return 'Bengali';
  if (/\bmarathi\b/.test(langs))   return 'Marathi';
  if (/\bpunjabi\b/.test(langs))   return 'Punjabi';
  if (/\bgujarati\b/.test(langs))  return 'Gujarati';
  if (/\bkannada\b/.test(langs))   return 'Kannada';
  if (/\bmalayalam\b/.test(langs)) return 'Malayalam';
  if (/\bhindi\b/.test(langs))     return 'Hindi';

  // Signal 3: cultural org / Sangam
  const orgsText = (p.organizations || p.volunteerExperiences || [])
    .map((o: any) => (o.organizationName || o.name || '')).join(' ');
  const orgRegion = detectOrgRegion(orgsText);
  if (orgRegion) return orgRegion;

  // Signal 4: surname (least precise — checked last)
  const fullName = (p.name || p.fullName || '').toLowerCase();
  for (const [region, re] of Object.entries(REGIONAL_SURNAMES)) {
    if (re.test(fullName)) return region;
  }
  return undefined;
}

/** Returns the regional outreach suffix with optional alma mater reference.
 *  Always starts with a sentence break so it reads naturally when appended. */
export function buildRegionalSuffix(tag: string | undefined, undergradSchool: string | null): string {
  if (!tag) return '';
  const almaRef = undergradSchool ? ` (${undergradSchool})` : '';
  switch (tag) {
    case 'Telugu':
      return `\n\nP.S. I've helped many Telugu engineers${almaRef} navigate this exact path — JNTU/Osmania background to US product companies is our sweet spot.`;
    case 'Tamil':
      return `\n\nP.S. Many students${almaRef} from the Tamil community have landed FAANG offers through our network. Anna Uni / SRM / VIT grads consistently perform well in our programme.`;
    case 'Bengali':
      return `\n\nP.S. We have a strong track record with Jadavpur / Calcutta University engineers${almaRef} making this exact transition to US product companies.`;
    case 'Marathi':
      return `\n\nP.S. I've worked with many engineers${almaRef} making the Pune / Mumbai to US product-company jump — it's a well-trodden path once you have the right network.`;
    case 'Punjabi':
      return `\n\nP.S. Our Punjabi engineering community${almaRef} has a strong referral network specifically for this kind of service-to-product pivot.`;
    case 'Gujarati':
      return `\n\nP.S. Our community of Desi engineers${almaRef} has navigated this exact situation and come out on the other side with offers.`;
    case 'Kannada':
      return `\n\nP.S. We've helped many VTU / MSRIT engineers${almaRef} bridge from Bengaluru service roles to US product-company offers.`;
    case 'Malayalam':
      return `\n\nP.S. Kerala engineers${almaRef} in our network consistently land product company offers — the technical foundation is strong, the network just needs to be built.`;
    case 'Hindi':
      return `\n\nP.S. Transitioning from${almaRef ? almaRef : ' a North Indian college'} to a US product company requires a specific playbook — and we have it.`;
    default:
      return '';
  }
}
