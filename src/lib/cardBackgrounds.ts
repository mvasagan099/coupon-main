export const DEFAULT_CARD_BACKGROUND = 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=900&auto=format&fit=crop&q=60';
export const CARD_BACKGROUNDS = [
  {"slug": "amazon", "name": "Amazon", "image": "/card-backgrounds/amazon.svg"},
  {"slug": "flipkart", "name": "Flipkart", "image": "/card-backgrounds/flipkart.svg"},
  {"slug": "meesho", "name": "Meesho", "image": "/card-backgrounds/meesho.svg"},
  {"slug": "facebook", "name": "Facebook", "image": "/card-backgrounds/facebook.svg"},
  {"slug": "google-play", "name": "Google Play", "image": "/card-backgrounds/google-play.svg"},
  {"slug": "apple", "name": "Apple", "image": "/card-backgrounds/apple.svg"},
  {"slug": "netflix", "name": "Netflix", "image": "/card-backgrounds/netflix.svg"},
  {"slug": "spotify", "name": "Spotify", "image": "/card-backgrounds/spotify.svg"},
  {"slug": "youtube", "name": "YouTube", "image": "/card-backgrounds/youtube.svg"},
  {"slug": "myntra", "name": "Myntra", "image": "/card-backgrounds/myntra.svg"},
  {"slug": "ajio", "name": "AJIO", "image": "/card-backgrounds/ajio.svg"},
  {"slug": "swiggy", "name": "Swiggy", "image": "/card-backgrounds/swiggy.svg"},
  {"slug": "zomato", "name": "Zomato", "image": "/card-backgrounds/zomato.svg"},
  {"slug": "uber", "name": "Uber", "image": "/card-backgrounds/uber.svg"},
  {"slug": "starbucks", "name": "Starbucks", "image": "/card-backgrounds/starbucks.svg"},
  {"slug": "aurora-glow", "name": "Aurora Glow", "image": "/card-backgrounds/aurora-glow.svg"},
  {"slug": "cosmic-nebula", "name": "Cosmic Nebula", "image": "/card-backgrounds/cosmic-nebula.svg"},
  {"slug": "golden-prestige", "name": "Golden Prestige", "image": "/card-backgrounds/golden-prestige.svg"},
  {"slug": "emerald-elegance", "name": "Emerald Elegance", "image": "/card-backgrounds/emerald-elegance.svg"},
  {"slug": "ocean-gradient", "name": "Ocean Gradient", "image": "/card-backgrounds/ocean-gradient.svg"},
  {"slug": "sunset-horizon", "name": "Sunset Horizon", "image": "/card-backgrounds/sunset-horizon.svg"},
  {"slug": "cyber-matrix", "name": "Cyber Matrix", "image": "/card-backgrounds/cyber-matrix.svg"},
  {"slug": "midnight-amethyst", "name": "Midnight Amethyst", "image": "/card-backgrounds/midnight-amethyst.svg"},
  {"slug": "crimson-pulse", "name": "Crimson Pulse", "image": "/card-backgrounds/crimson-pulse.svg"},
  {"slug": "minimalist-slate", "name": "Minimalist Slate", "image": "/card-backgrounds/minimalist-slate.svg"}
] as const;

export function normalizeCardBackground(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (CARD_BACKGROUNDS.some(preset => preset.image === trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost')) return null;
    return url.href;
  } catch { return null; }
}
export function cardBackgroundImage(value: string, dark = false): string {
  const image = normalizeCardBackground(value) ?? DEFAULT_CARD_BACKGROUND;
  return `linear-gradient(90deg, rgba(8,11,18,${dark ? '0.92' : '0.65'}) 0%, rgba(8,11,18,${dark ? '0.78' : '0.4'}) 42%, rgba(8,11,18,${dark ? '0.12' : '0.05'}) 100%), url(${JSON.stringify(image)})`;
}
