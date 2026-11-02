// Automatic grouping of tickets by the words in their titles. Nothing is hard-coded per customer:
// every organization gets the groups that its own tickets produce.
//
// How it works:
// 1. Every title is split into words (4+ letters, no numbers, no [TAGS], no filler words).
// 2. Words are compared by their first 8 letters, so "Reservierung" and "Reservierungen" count as one word.
// 3. The word that appears in the most still-ungrouped tickets becomes the next group. Each ticket joins
//    only one group, so the bubbles add up to the total.
// 4. This repeats until a word would cover fewer than MIN_GROUP tickets. The rest form the "Other" group.
export const OTHER_LABEL = 'Other';

const STEM_LENGTH = 8;

// Filler words that say nothing about the topic (German and English).
const STOP_WORDS = new Set(
  `nicht kann können konnte werden wird wurde sind ist für eine einen einer eines dem den der die das und oder
  mit von auf aus bei nach zum zur über unter noch auch wieder keine kein dass wir sie nur bitte danke ohne mehr
  bereits wurden worden zwischen beim vom ins dieser dieses diese hallo guten sich lässt trotz
  with from that this have been cannot when after before into does will please there their what which`
    .split(/\s+/)
    .filter(Boolean)
);

// Smaller organizations need a smaller threshold, so they still get groups.
export function minGroupSize(total) {
  return Math.max(3, Math.ceil(total / 250));
}

function wordsOf(title) {
  const cleaned = (title ?? '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\S*\d\S*/g, ' ');
  return (cleaned.match(/[a-zäöüßæøå]{4,}/g) ?? []).filter((word) => !STOP_WORDS.has(word));
}

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function groupTickets(tickets) {
  const total = tickets.length;
  const threshold = minGroupSize(total);

  // Inverted index: word stem -> tickets that contain it.
  const ticketsByStem = new Map();
  const spellings = new Map();
  tickets.forEach((ticket, index) => {
    const seen = new Set();
    for (const word of wordsOf(ticket.summary)) {
      const stem = word.slice(0, STEM_LENGTH);
      if (!seen.has(stem)) {
        seen.add(stem);
        if (!ticketsByStem.has(stem)) ticketsByStem.set(stem, []);
        ticketsByStem.get(stem).push(index);
      }
      if (!spellings.has(stem)) spellings.set(stem, new Map());
      const forms = spellings.get(stem);
      forms.set(word, (forms.get(word) ?? 0) + 1);
    }
  });

  const grouped = new Array(total).fill(false);
  const groups = [];
  const usedStems = new Set();

  for (;;) {
    let bestStem = null;
    let bestCount = 0;
    for (const [stem, members] of ticketsByStem) {
      if (usedStems.has(stem)) continue;
      let count = 0;
      for (const index of members) if (!grouped[index]) count += 1;
      if (count > bestCount) {
        bestStem = stem;
        bestCount = count;
      }
    }
    if (!bestStem || bestCount < threshold) break;

    usedStems.add(bestStem);
    for (const index of ticketsByStem.get(bestStem)) grouped[index] = true;
    const label = [...spellings.get(bestStem).entries()].sort((a, b) => b[1] - a[1])[0][0];
    groups.push({ label: capitalise(label), count: bestCount, other: false });
  }

  const leftover = grouped.filter((flag) => !flag).length;
  if (leftover) groups.push({ label: OTHER_LABEL, count: leftover, other: true });

  return groups.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
