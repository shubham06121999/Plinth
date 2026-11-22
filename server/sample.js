// Adds a made-up project so there is something to look at: npm run sample
import * as store from './store.js';
const p = store.create({
  name: 'Neem Court', developer: 'Sample Estates', tagline: 'Shade, space and a slower evening',
  type: 'apartments', stage: 'prelaunch', possession: 'December 2029', land: '4.2 acres', units: '312',
  rera: 'SAMPLE/0000/2026', locality: 'Baner', city: 'Pune', address: 'Sample Road, Baner, Pune',
  phone: '+91 00000 00000', email: 'hello@example.com', website: 'example.com',
  priceFrom: '₹1.18 Cr*', offer: 'Pre-launch price for the first 50 bookings',
  configs: [
    { type: '2 BHK', size: '780 sq ft', price: '₹1.18 Cr*' },
    { type: '3 BHK', size: '1,120 sq ft', price: '₹1.64 Cr*' },
    { type: '4 BHK', size: '1,560 sq ft', price: '₹2.35 Cr*' },
  ],
  connectivity: [{ place: 'Metro station', time: '6 mins' }, { place: 'IT park', time: '15 mins' }, { place: 'Expressway', time: '10 mins' }, { place: 'International school', time: '5 mins' }],
  amenities: ['Swimming pool', 'Clubhouse', 'Landscaped gardens', 'Jogging track', 'Yoga deck', 'Co-working lounge', 'EV charging', 'Rainwater harvesting'],
  brand: '#E8552D',
  building: { towers: 3, floors: 22, style: 'green', wall: '#EDE7DA', trim: '#6A5140', setting: 'hills', pool: true, podium: true },
  film: { format: '9:16', theme: 'modern', light: 'arc', voice: 'Rishi', music: 'warm', scenes: {} },
});
console.log('Added', p.name, p.id);
