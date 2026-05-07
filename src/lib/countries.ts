export interface CountryConfig {
  slug: string;
  code: string;
  name: string;
  queries: string[];
  candidateLimit?: number;
  locationTerms: string[];
}

export const COUNTRY_CONFIGS: CountryConfig[] = [
  {
    slug: 'australia',
    code: 'AU',
    name: 'Australia',
    queries: [
      'location:Australia repos:>5',
      'location:Sydney repos:>5',
      'location:Melbourne repos:>5',
      'location:Brisbane repos:>5',
      'location:Australia followers:<10 repos:80..120',
      'location:Australia followers:<20 repos:80..120',
      'location:Australia saas',
      'location:Australia automation',
      'location:Australia agentic'
    ],
    candidateLimit: 900,
    locationTerms: ['Australia', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Hobart', 'Darwin', 'NSW', 'VIC', 'QLD']
  },
  { slug: 'new-zealand', code: 'NZ', name: 'New Zealand', queries: ['location:"New Zealand" repos:>5'], locationTerms: ['New Zealand', 'Aotearoa', 'Auckland', 'Wellington', 'Christchurch'] },
  { slug: 'united-states', code: 'US', name: 'United States', queries: ['location:"United States" repos:>5', 'location:California repos:>5', 'location:"San Francisco" repos:>5', 'location:Seattle repos:>5', 'location:NYC repos:>5'], locationTerms: ['United States', 'USA', 'U.S.', 'US', 'California', 'New York', 'Seattle', 'San Francisco', 'Bay Area', 'Austin', 'Boston', 'Chicago'] },
  { slug: 'canada', code: 'CA', name: 'Canada', queries: ['location:Canada repos:>5', 'location:Toronto repos:>5', 'location:Vancouver repos:>5', 'location:Montreal repos:>5'], locationTerms: ['Canada', 'Toronto', 'Vancouver', 'Montreal', 'Ottawa', 'Calgary'] },
  { slug: 'united-kingdom', code: 'GB', name: 'United Kingdom', queries: ['location:"United Kingdom" repos:>5', 'location:London repos:>5', 'location:England repos:>5', 'location:Scotland repos:>5'], locationTerms: ['United Kingdom', 'UK', 'England', 'Scotland', 'Wales', 'London', 'Manchester', 'Edinburgh'] },
  { slug: 'ireland', code: 'IE', name: 'Ireland', queries: ['location:Ireland repos:>5'], locationTerms: ['Ireland', 'Dublin', 'Cork'] },
  { slug: 'germany', code: 'DE', name: 'Germany', queries: ['location:Germany repos:>5', 'location:Berlin repos:>5', 'location:Munich repos:>5'], locationTerms: ['Germany', 'Deutschland', 'Berlin', 'Munich', 'München', 'Hamburg'] },
  { slug: 'france', code: 'FR', name: 'France', queries: ['location:France repos:>5', 'location:Paris repos:>5'], locationTerms: ['France', 'Paris', 'Lyon', 'Toulouse'] },
  { slug: 'netherlands', code: 'NL', name: 'Netherlands', queries: ['location:Netherlands repos:>5', 'location:Amsterdam repos:>5'], locationTerms: ['Netherlands', 'Nederland', 'Amsterdam', 'Rotterdam', 'Utrecht'] },
  { slug: 'sweden', code: 'SE', name: 'Sweden', queries: ['location:Sweden repos:>5'], locationTerms: ['Sweden', 'Stockholm', 'Göteborg', 'Gothenburg', 'Malmö'] },
  { slug: 'norway', code: 'NO', name: 'Norway', queries: ['location:Norway repos:>5'], locationTerms: ['Norway', 'Oslo', 'Bergen'] },
  { slug: 'denmark', code: 'DK', name: 'Denmark', queries: ['location:Denmark repos:>5'], locationTerms: ['Denmark', 'Copenhagen', 'København'] },
  { slug: 'finland', code: 'FI', name: 'Finland', queries: ['location:Finland repos:>5'], locationTerms: ['Finland', 'Helsinki', 'Espoo'] },
  { slug: 'switzerland', code: 'CH', name: 'Switzerland', queries: ['location:Switzerland repos:>5'], locationTerms: ['Switzerland', 'Schweiz', 'Suisse', 'Zurich', 'Zürich', 'Geneva'] },
  { slug: 'austria', code: 'AT', name: 'Austria', queries: ['location:Austria repos:>5', 'location:Vienna repos:>5', 'location:Wien repos:>5'], locationTerms: ['Austria', 'Österreich', 'Vienna', 'Wien'] },
  { slug: 'spain', code: 'ES', name: 'Spain', queries: ['location:Spain repos:>5'], locationTerms: ['Spain', 'España', 'Madrid', 'Barcelona'] },
  { slug: 'portugal', code: 'PT', name: 'Portugal', queries: ['location:Portugal repos:>5'], locationTerms: ['Portugal', 'Lisbon', 'Lisboa', 'Porto'] },
  { slug: 'italy', code: 'IT', name: 'Italy', queries: ['location:Italy repos:>5'], locationTerms: ['Italy', 'Italia', 'Rome', 'Roma', 'Milan', 'Milano'] },
  { slug: 'poland', code: 'PL', name: 'Poland', queries: ['location:Poland repos:>5'], locationTerms: ['Poland', 'Polska', 'Warsaw', 'Warszawa', 'Krakow', 'Kraków'] },
  { slug: 'ukraine', code: 'UA', name: 'Ukraine', queries: ['location:Ukraine repos:>5'], locationTerms: ['Ukraine', 'Kyiv', 'Kiev', 'Lviv'] },
  { slug: 'india', code: 'IN', name: 'India', queries: ['location:India repos:>5'], locationTerms: ['India', 'Bangalore', 'Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai'] },
  { slug: 'china', code: 'CN', name: 'China', queries: ['location:China repos:>5'], locationTerms: ['China', 'Beijing', 'Shanghai', 'Shenzhen', 'Hangzhou', 'Guangzhou'] },
  { slug: 'japan', code: 'JP', name: 'Japan', queries: ['location:Japan repos:>5'], locationTerms: ['Japan', 'Tokyo', 'Osaka', 'Kyoto'] },
  { slug: 'republic-of-korea', code: 'KR', name: 'Republic of Korea', queries: ['location:Korea repos:>5'], locationTerms: ['Korea', 'South Korea', 'Republic of Korea', 'Seoul'] },
  { slug: 'taiwan', code: 'TW', name: 'Taiwan', queries: ['location:Taiwan repos:>5'], locationTerms: ['Taiwan', 'Taipei'] },
  { slug: 'hong-kong', code: 'HK', name: 'Hong Kong', queries: ['location:"Hong Kong" repos:>5'], locationTerms: ['Hong Kong', 'HK'] },
  { slug: 'singapore', code: 'SG', name: 'Singapore', queries: ['location:Singapore repos:>5'], locationTerms: ['Singapore'] },
  { slug: 'indonesia', code: 'ID', name: 'Indonesia', queries: ['location:Indonesia repos:>5'], locationTerms: ['Indonesia', 'Jakarta', 'Bandung', 'Surabaya'] },
  { slug: 'malaysia', code: 'MY', name: 'Malaysia', queries: ['location:Malaysia repos:>5'], locationTerms: ['Malaysia', 'Kuala Lumpur', 'Penang'] },
  { slug: 'philippines', code: 'PH', name: 'Philippines', queries: ['location:Philippines repos:>5'], locationTerms: ['Philippines', 'Manila', 'Cebu'] },
  { slug: 'thailand', code: 'TH', name: 'Thailand', queries: ['location:Thailand repos:>5'], locationTerms: ['Thailand', 'Bangkok'] },
  { slug: 'vietnam', code: 'VN', name: 'Vietnam', queries: ['location:Vietnam repos:>5'], locationTerms: ['Vietnam', 'Viet Nam', 'Hanoi', 'Ho Chi Minh', 'Saigon'] },
  { slug: 'brazil', code: 'BR', name: 'Brazil', queries: ['location:Brazil repos:>5'], locationTerms: ['Brazil', 'Brasil', 'São Paulo', 'Sao Paulo', 'Rio de Janeiro'] },
  { slug: 'mexico', code: 'MX', name: 'Mexico', queries: ['location:Mexico repos:>5'], locationTerms: ['Mexico', 'México', 'CDMX', 'Guadalajara', 'Monterrey'] },
  { slug: 'argentina', code: 'AR', name: 'Argentina', queries: ['location:Argentina repos:>5'], locationTerms: ['Argentina', 'Buenos Aires', 'Córdoba'] },
  { slug: 'chile', code: 'CL', name: 'Chile', queries: ['location:Chile repos:>5'], locationTerms: ['Chile', 'Santiago'] },
  { slug: 'south-africa', code: 'ZA', name: 'South Africa', queries: ['location:"South Africa" repos:>5'], locationTerms: ['South Africa', 'Cape Town', 'Johannesburg', 'Pretoria'] },
  { slug: 'israel', code: 'IL', name: 'Israel', queries: ['location:Israel repos:>5'], locationTerms: ['Israel', 'Tel Aviv', 'Jerusalem'] },
  { slug: 'united-arab-emirates', code: 'AE', name: 'United Arab Emirates', queries: ['location:"United Arab Emirates" repos:>5'], locationTerms: ['United Arab Emirates', 'UAE', 'Dubai', 'Abu Dhabi'] }
];
