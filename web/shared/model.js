// What a project is. Shared by the server, the studio and the renderer.

export const TYPES = {
  apartments: 'Apartments',
  villas: 'Villas',
  commercial: 'Commercial',
};
export const STAGES = {
  prelaunch: 'Pre-launch',
  launched: 'Newly launched',
  construction: 'Under construction',
  ready: 'Nearing possession',
};
export const STYLES = {
  balcony: 'Wide balconies',
  glass: 'Glass curtain',
  classic: 'Classic',
  green: 'Planted terraces',
};
export const SETTINGS = {
  city: 'City',
  suburb: 'Suburb',
  hills: 'Hills',
  water: 'Waterfront',
};
export const FORMATS = {
  '9:16': { label: 'Vertical', hint: 'Reels, Shorts, Status', w: 1080, h: 1920 },
  '1:1': { label: 'Square', hint: 'Feed', w: 1080, h: 1080 },
  '16:9': { label: 'Wide', hint: 'YouTube, site, TV', w: 1920, h: 1080 },
};
export const THEMES = { modern: 'Modern', heritage: 'Heritage', bold: 'Bold' };
export const LIGHTS = { arc: 'Morning to dusk', day: 'Day', golden: 'Golden hour', dusk: 'Dusk' };
export const FILM_STYLES = { reel: 'Photoreal reel', model: '3D model film' };
export const MUSIC = { warm: 'Warm', uplift: 'Uplifting', cinematic: 'Cinematic', upload: 'Your track', none: 'No music' };

export const AMENITIES = [
  'Swimming pool', 'Clubhouse', 'Gymnasium', 'Landscaped gardens', "Children's play area",
  'Jogging track', 'Yoga deck', 'Indoor games', 'Multipurpose hall', 'Sports court',
  'Co-working lounge', 'Mini theatre', 'Senior citizens area', 'Pet park',
  'Covered parking', 'EV charging', '24x7 security', 'Power backup', 'Rainwater harvesting', 'Temple',
];

export const EDITABLE = [
  'name', 'developer', 'tagline', 'type', 'stage', 'possession', 'land', 'units', 'rera',
  'locality', 'city', 'address', 'phone', 'email', 'website', 'priceFrom', 'offer',
  'configs', 'connectivity', 'amenities', 'building', 'film', 'brand', 'posterPhoto',
];

export const blankProject = () => ({
  name: '', developer: '', tagline: '', type: 'apartments', stage: 'prelaunch', possession: '',
  land: '', units: '', rera: '', locality: '', city: '', address: '',
  phone: '', email: '', website: '', priceFrom: '', offer: '',
  configs: [], connectivity: [], amenities: [],
  brand: '#E8552D',
  building: { towers: 2, floors: 18, style: 'balcony', wall: '#EFEAE0', trim: '#5B4636', setting: 'city', pool: true, podium: true },
  film: { style: 'reel', format: '9:16', theme: 'modern', light: 'arc', voice: 'kokoro:af_heart', music: 'uplift', scenes: {}, reel: {}, gold: '#FFD21F', viewNote: '', lookNote: '' },
  posterPhoto: '',
  photos: [], logo: null, track: null, outputs: [], footage: {},
});

// What has to be there before a film says anything useful.
export function missing(p) {
  const out = [];
  if (!p.name.trim()) out.push({ field: 'name', label: 'project name' });
  if (!p.locality.trim() && !p.city.trim()) out.push({ field: 'locality', label: 'location' });
  return out;
}
