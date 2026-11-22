// Which sound effects a reel needs, read off its plan.
export function cues(plan) {
  const ev = [{ t: 0.02, type: 'impact', v: 0.8 }];
  plan.scenes.forEach((s, i) => {
    if (i) ev.push({ t: s.start, type: 'whoosh', v: 0.75, dir: i % 2 ? 1 : -1 });
    if (s.key === 'intro') ev.push({ t: s.start, type: 'riser', d: Math.min(1.5, s.start), v: 0.8 }, { t: s.start, type: 'impact', v: 0.9 });
    if (s.key === 'end') ev.push({ t: s.start, type: 'riser', d: 1.2, v: 0.6 }, { t: s.start, type: 'impact', v: 0.9 }, { t: s.start + 0.9, type: 'chime', v: 0.8 });
    s.cuts.slice(1).forEach((c) => ev.push({ t: s.start + c.start, type: 'whoosh', v: 0.32, dir: c.seq % 2 ? 1 : -1 }));
    s.cards.forEach((c) => {
      const gold = c.lines.find((l) => l.kind === 'gold');
      if (!gold) return;
      const at = s.start + c.start + 0.3;
      if (/₹|\bCR\b|LAKH/i.test(gold.text)) ev.push({ t: at, type: 'chime', v: 1 });
      else if (/^\d[\d,]{2,}/.test(gold.text)) ev.push({ t: at, type: 'count' });
      else ev.push({ t: at, type: 'pop', v: 0.5 });
    });
  });
  return ev;
}
