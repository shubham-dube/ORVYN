/**
 * Merchant clean-up: what a bank or UPI message calls a payee ("UPI-RAZ*SWIGGY", "spotify.upi@hdfcbank",
 * "AMAZON PAY INDIA") → a name people recognise and a starting category (slugs of DEFAULT_CATEGORIES).
 * The person's own corrections win over these (see `learned` in categorise).
 */
const KNOWN: [RegExp, string, string][] = [
  // food
  [/swiggy/i, 'Swiggy', 'food'],
  [/zomato/i, 'Zomato', 'food'],
  [/domino/i, "Domino's", 'food'],
  [/mcdonald/i, "McDonald's", 'food'],
  [/starbucks/i, 'Starbucks', 'food'],
  [/chai ?point/i, 'Chai Point', 'food'],
  [/kfc\b/i, 'KFC', 'food'],
  [/pizza ?hut/i, 'Pizza Hut', 'food'],
  [/burger ?king/i, 'Burger King', 'food'],
  [/cafe coffee day|\bccd\b/i, 'Cafe Coffee Day', 'food'],
  // groceries
  [/big ?basket/i, 'BigBasket', 'groceries'],
  [/blinkit|grofers/i, 'Blinkit', 'groceries'],
  [/zepto/i, 'Zepto', 'groceries'],
  [/instamart/i, 'Swiggy Instamart', 'groceries'],
  [/d ?mart|avenue supermarts/i, 'DMart', 'groceries'],
  [/reliance (?:fresh|smart|retail)|jiomart/i, 'Reliance Retail', 'groceries'],
  // transport
  [/\buber\b/i, 'Uber', 'transport'],
  [/\bola\b|ani technologies/i, 'Ola', 'transport'],
  [/rapido/i, 'Rapido', 'transport'],
  [/irctc/i, 'IRCTC', 'travel'],
  [/metro rail|\bdmrc\b|bmrcl/i, 'Metro', 'transport'],
  [/fastag|nhai/i, 'FASTag', 'transport'],
  // fuel
  [/indian ?oil|\biocl?\b/i, 'Indian Oil', 'fuel'],
  [/hindustan petroleum|\bhpcl?\b/i, 'HP Petrol', 'fuel'],
  [/bharat petroleum|\bbpcl?\b/i, 'Bharat Petroleum', 'fuel'],
  [/\bshell\b/i, 'Shell', 'fuel'],
  // shopping
  [/amazon(?! ?prime)/i, 'Amazon', 'shopping'],
  [/flipkart/i, 'Flipkart', 'shopping'],
  [/myntra/i, 'Myntra', 'shopping'],
  [/ajio/i, 'AJIO', 'shopping'],
  [/meesho/i, 'Meesho', 'shopping'],
  [/nykaa/i, 'Nykaa', 'personal'],
  [/decathlon/i, 'Decathlon', 'shopping'],
  [/ikea/i, 'IKEA', 'shopping'],
  [/croma/i, 'Croma', 'shopping'],
  // subscriptions
  [/netflix/i, 'Netflix', 'subscriptions'],
  [/spotify/i, 'Spotify', 'subscriptions'],
  [/hotstar|jiocinema/i, 'Disney+ Hotstar', 'subscriptions'],
  [/prime ?video|amazon ?prime/i, 'Amazon Prime', 'subscriptions'],
  [/youtube/i, 'YouTube Premium', 'subscriptions'],
  [/apple\.com|itunes/i, 'Apple', 'subscriptions'],
  [/google ?(?:play|one|cloud)/i, 'Google', 'subscriptions'],
  [/openai|chatgpt/i, 'OpenAI', 'subscriptions'],
  // bills
  [/airtel/i, 'Airtel', 'bills'],
  [/\bjio\b|reliance jio/i, 'Jio', 'bills'],
  [/vodafone|\bvi\b/i, 'Vi', 'bills'],
  [/bescom|tata power|adani electricity|msedcl|electricity/i, 'Electricity', 'bills'],
  [/act fibernet|hathway|broadband/i, 'Broadband', 'bills'],
  [/indane|hp gas|bharat gas|\blpg\b/i, 'Cooking gas', 'bills'],
  // health
  [/apollo/i, 'Apollo Pharmacy', 'health'],
  [/pharmeasy/i, 'PharmEasy', 'health'],
  [/\b1mg\b|tata 1mg/i, 'Tata 1mg', 'health'],
  [/practo/i, 'Practo', 'health'],
  [/cult\.?fit|curefit/i, 'cult.fit', 'health'],
  // entertainment
  [/bookmyshow/i, 'BookMyShow', 'entertainment'],
  [/\bpvr\b|inox/i, 'PVR INOX', 'entertainment'],
  // travel
  [/makemytrip/i, 'MakeMyTrip', 'travel'],
  [/goibibo/i, 'Goibibo', 'travel'],
  [/indigo|interglobe/i, 'IndiGo', 'travel'],
  [/air ?india/i, 'Air India', 'travel'],
  [/\boyo\b/i, 'OYO', 'travel'],
  // investments
  [/zerodha/i, 'Zerodha', 'investments'],
  [/groww/i, 'Groww', 'investments'],
  // cash
  [/\batm\b|cash wdl|atm wdl/i, 'Cash withdrawal', ''],
];

const NOISE = [
  /^(?:upi|neft|imps|rtgs|pos|ecom|vps|vin|ach|nach)[-/ ]+/i,
  /^(?:raz|razp|payu|ccavenue|cashfree|bdsk|paytm|phonepe|pinelabs)\*/i,
  /\b(?:pvt|private)\.?\s*(?:ltd|limited)\.?$/i,
  /\b(?:ltd|limited|llp|inc)\.?$/i,
  /\b(?:india|in)$/i,
];

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s.&'-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
    .trim();

export interface Merchant {
  merchant: string;
  /** a DEFAULT_CATEGORIES slug, or null when it's a person or unknown */
  category: string | null;
}

/** "spotify.upi@hdfcbank" → Spotify · subscriptions; "PRIYA SHARMA" → Priya Sharma · (none). */
export function cleanMerchant(raw: string): Merchant {
  let s = raw.trim();
  if (!s) return { merchant: '', category: null };
  for (const [re, name, cat] of KNOWN) if (re.test(s)) return { merchant: name, category: cat || null };
  // a VPA: keep the handle, drop the bank and the "upi"-style suffixes
  const vpa = /^([\w.-]+)@[\w]+$/.exec(s);
  if (vpa) s = vpa[1]!.replace(/[._-](?:upi|ok\w*|pay|razorpay|ybl|axl|ibl)$/i, '').replace(/[._-]+/g, ' ');
  for (let i = 0; i < 3; i++) for (const re of NOISE) s = s.replace(re, '').trim();
  s = s
    .replace(/\s{2,}/g, ' ')
    .replace(/[*#]+/g, ' ')
    .trim();
  return { merchant: titleCase(s), category: null };
}
