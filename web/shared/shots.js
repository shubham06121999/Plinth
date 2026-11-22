// Every picture a reel can use: what it shows, how to describe it, and how the camera moves.
const has = (p, re) => p.amenities.some((a) => re.test(a));
const FACADE = { balcony: 'wide balconies with glass railings', glass: 'a floor to ceiling glass curtain wall', classic: 'a classic stone facade with punched windows', green: 'planted terraces with lush greenery on the balconies' };
const AROUND = { city: 'dense Indian city skyline', suburb: 'leafy low-rise Indian neighbourhood', hills: 'green hills', water: 'green mangroves and a calm creek' };
const view = (p) => (p.film.viewNote || '').trim() || AROUND[p.building.setting];
const look = (p) => (p.film.lookNote || '').trim() || 'warm neutral palette, cream upholstery, walnut wood, polished beige marble floor';
const ROOM = 'Professional architectural interior photograph, vertical 24mm wide angle, natural light, realistic materials, sharp detail, no people, no text.';
const room = (what) => (p) => `${ROOM} ${what} Style: ${look(p)}. High floor, windows look out and down on ${view(p)}.`;
const place = (what) => (p) => `Professional architectural photograph, vertical, natural light, realistic, sharp detail, no text. ${what} In the grounds of a modern Indian residential complex of tall towers, surroundings: ${view(p)}.`;
const ext = (light, extra = '') => (p) => `Turn this 3D model into a photorealistic architectural photograph. Keep the same building, the same number of towers and floors, the same camera angle and framing. ${p.type === 'commercial' ? 'Modern office' : p.type === 'villas' ? 'Luxury villas' : 'Luxury residential'} with ${FACADE[p.building.style]}. ${light}. Real concrete, glass reflections, detailed mature landscaping in place of plain ground, surroundings: ${view(p)}. ${extra} No text.`;

export const SHOTS = {
  ext_low:   { label: 'Looking up', ref: ['street', 1, 0.5], move: 'up', prompt: ext('Soft golden hour sun, warm haze') },
  ext_hero:  { label: 'The building', ref: ['rise', 0.6, 0.6], move: 'push', prompt: ext('Clear early morning light, blue sky with soft clouds') },
  ext_air:   { label: 'From the air', ref: ['aerial', 0.7, 0.4], move: 'right', prompt: ext('Late afternoon sun, long shadows', 'Drone photograph.') },
  ext_close: { label: 'Facade', ref: ['close', 0.9, 0.5], move: 'up', prompt: ext('Golden hour side light', 'Telephoto detail.') },
  ext_deck:  { label: 'Pool deck', ref: ['deck', 1, 0.5], move: 'left', when: (p) => p.type !== 'villas' && p.building.podium && p.building.pool, prompt: ext('Golden hour, clear turquoise water with gentle reflections', 'Teak loungers, parasols, tropical planting.') },
  ext_dusk:  { label: 'At dusk', ref: ['hero', 1.8, 0.5], move: 'pull', prompt: ext('Blue hour just after sunset, warm lights glowing in the windows, pink horizon') },
  living:    { label: 'Living room', move: 'push', prompt: room('Spacious living room, full height sliding glass doors to a balcony, sheer linen curtains, soft late sun casting long shadows on the floor, low sofa, coffee table, linear track lights.') },
  living2:   { label: 'Second living room', move: 'right', prompt: room('Bright double living and family lounge, sectional sofa, large art on the wall, bookshelf with soft lighting, cove lit ceiling, big windows.') },
  dining:    { label: 'Dining', move: 'left', prompt: room('Dining area with a long table for eight and a sculptural pendant light, opening to the living room, evening glow.') },
  kitchen:   { label: 'Kitchen', move: 'push', prompt: room('Modern kitchen with handleless cabinets, stone island, under cabinet lights, built in ovens.') },
  bedroom:   { label: 'Bedroom', move: 'push', prompt: room('Master bedroom, upholstered headboard, crisp white bedding, wood wall panels, cove lit ceiling, large window, morning light.') },
  bedroom2:  { label: 'Second bedroom', move: 'left', prompt: room('Elegant guest bedroom with a window seat and a study desk, linen curtains, soft daylight.') },
  balcony:   { label: 'Balcony', move: 'push', prompt: (p) => place('Deep private sundeck balcony of a high floor apartment, glass railing, outdoor lounge chairs, potted palms, stone floor, golden hour, view to the horizon.')(p) },
  lobby:     { label: 'Lobby', move: 'push', when: (p) => p.type !== 'villas', prompt: room('Grand double height residential lobby with stone walls, a reception desk, sculptural chandelier and lounge seating.') },
  office:    { label: 'Workspace', move: 'push', when: (p) => p.type === 'commercial', prompt: room('Open modern office floor, workstations, glass meeting rooms, plants, bright daylight.') },
  a_pool:    { label: 'Swimming pool', move: 'left', when: (p) => has(p, /pool/i), prompt: place('Infinity swimming pool with clear turquoise water, teak loungers, palms, sunset reflections.') },
  a_club:    { label: 'Clubhouse', move: 'push', when: (p) => has(p, /club/i), prompt: room('Residents clubhouse lounge with deep armchairs, warm lamps, dark wood and tall windows.') },
  a_gym:     { label: 'Gymnasium', move: 'right', when: (p) => has(p, /gym/i), prompt: room('Premium gymnasium with treadmills facing the window, free weights, mirrors, wooden floor.') },
  a_garden:  { label: 'Gardens', move: 'up', when: (p) => has(p, /garden|landscap/i), prompt: place('Lush landscaped garden with winding stone path, lawns, flowering trees and tropical plants, morning sun through leaves.') },
  a_kids:    { label: "Children's play area", move: 'left', when: (p) => has(p, /child|kids|play/i), prompt: place("Bright modern children's play area with colourful slides, a climbing net and soft rubber flooring, among trees, no people.") },
  a_track:   { label: 'Jogging track', move: 'push', when: (p) => has(p, /jog|track/i), prompt: place('Curving jogging track under a canopy of trees at sunrise.') },
  a_yoga:    { label: 'Yoga deck', move: 'push', when: (p) => has(p, /yoga/i), prompt: place('Open timber yoga deck among bamboo with rolled mats, soft morning mist.') },
  a_games:   { label: 'Indoor games', move: 'right', when: (p) => has(p, /indoor games|billiard/i), prompt: room('Indoor games room with a billiards table, dark wood panels, tall windows.') },
  a_court:   { label: 'Sports court', move: 'left', when: (p) => has(p, /court|sport/i), prompt: place('Outdoor multi sport court with crisp line markings, floodlights, trees around.') },
  a_work:    { label: 'Co-working lounge', move: 'push', when: (p) => has(p, /work/i), prompt: room('Quiet co-working lounge with long oak table, task lamps, plants and phone booths.') },
  a_film:    { label: 'Mini theatre', move: 'push', when: (p) => has(p, /theat|cinema/i), prompt: room('Private mini theatre with plush recliners, acoustic walls and dim step lights.') },
};

// Amenity names that have a picture of their own.
const PIC = [[/pool/i, 'a_pool'], [/club/i, 'a_club'], [/gym/i, 'a_gym'], [/garden|landscap/i, 'a_garden'], [/child|kids|play area/i, 'a_kids'], [/jog/i, 'a_track'], [/yoga/i, 'a_yoga'], [/indoor games|billiard/i, 'a_games'], [/court|sport/i, 'a_court'], [/work/i, 'a_work'], [/theat|cinema/i, 'a_film']];
export const amenityShot = (name) => PIC.find(([re]) => re.test(name))?.[1];
export const available = (p) => Object.keys(SHOTS).filter((k) => !SHOTS[k].when || SHOTS[k].when(p));
