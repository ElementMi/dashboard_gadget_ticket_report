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
  aber wenn dann weil also schon jetzt heute gestern immer leider dort hier damit sowie sollte soll würde wäre
  haben hatte hatten gibt gab geht ging kommt kommen sehen sieht wollen wollte müssen musste folgende folgender
  alle alles allen gerne vielen freundlichen grüßen viele liebe habe hätte können könnten dürfen mein meine unser unsere
  with from that this have been cannot when after before into does will please there their what which`
    .split(/\s+/)
    .filter(Boolean)
);

// Fixed groups. The first rule that matches the title wins; everything else is grouped automatically (below).
const FIXED_GROUPS = [
  { label: 'Workflow / Camunda', test: /camunda|user\s?task|workflow/i },
  { label: 'Fehler / -meldung intern / Kategorie', test: /kategorie\s*1|\bkat\.?\s*1\b/i },
  { label: 'Lager / Kasto', test: /kasto|hochregal|\bhrl\b/i },
  { label: 'Reservierung', blue: true, test: /reservier|reservation/i },
  { label: 'Verladung / Versand', blue: true, test: /verlad|\btour|umtour|ladungsplanung|versandbeleg/i },
  { label: 'Packen / Verpacken', blue: true, test: /packplatz|packzettel|verdicht|umpack|verpack/i },
  { label: 'Kommissionierung', blue: true, test: /\bs(ä|ae)ge/i },
  { label: 'Schnittstelle / Zabbix / Gevis', test: /^(?!.*packzettel).*(schnittstelle|übergabe|übertrag|übermittl|rückmeldung|zabbix|interface|handover)/i },
  { label: 'Belege / Etiketten / Drucker', test: /etikett|drucker|druck|beleg(e|en)?\b/i },
  { label: 'Hardware / Systemtechnik', test: /\bmde\b|\berp\b|update|wartung|netzwerk|\bnetz\b|vpn|w-?lan|performance|stillstand|verbindung|\bserver|festplatte|system (hängt|funktioniert nicht)/i },
  { label: 'Stammdaten', test: /sachnummernstamm|stammdat|migration|konfig|neue[nrs]?\s+lagerpl/i },
  { label: 'Datenbereinigung / Removal / Tätigkeiten', test: /datenbereinigung|removal|t[äa]tigkeit|fehlerhaft\w*\s+(datens|le\b)|l[äa]ss\w*\s+sich\s+nicht\s+l[öo]schen/i },
  { label: 'Sprachnachricht / Einspielung / Bugfix / Patchday', test: /sprachnachricht|patchday|\bpatch|einspiel|bugfix/i },
  { label: 'Inventur', blue: true, test: /inventur|nulldurchgang|restmengenkorrektur|l[äa]ngen in is\b|\bis gekennzeichnete/i },
  { label: 'Nachschub / Umlagerung', blue: true, test: /nachschub|naschub|umlager|puffern/i },
  { label: 'Kommissionierung', blue: true, test: /kommissionier|kommisionier|entnahme|entnommen|überliefer/i },
  { label: 'Einlagerung', blue: true, test: /einlager|lagerplatz|versandpuffer|ablegen/i },
  { label: 'Wareneingang', blue: true, test: /wareneingang|lagerzug[aä]ng|bestellung|voranmeld|\bwe\b/i },
  { label: 'Lagerbestand', blue: true, test: /bestand|sperrkennz|ausbuch/i },
  { label: 'Kommissionierung', blue: true, test: /l[äa]ngen?\b/i },
  { label: 'Auftrag / Disposition / PZ - Nummer', blue: true, test: /\bpz\s*-?\s*\d|\bauftrag|\baufträge|status\s*50|dispo|bedarfsmenge/i },
];

// A pastel color of its own for every predefined group (beyond the palette the hue steps by the golden angle, so neighbours never look
// alike). Groups that are not predefined get no color here: the chart paints them gray.
const FIXED_LABELS = [...new Set(FIXED_GROUPS.map((rule) => rule.label))];
// The pastel palette: light pink, light orange, peach, light blue, olive, lime and yellow, plus more pastel colors.
// Ordered so that groups next to each other in the list get colors that are easy to tell apart.
const PASTEL_PALETTE = [
  '#FFC8DD', // light pink
  '#B5EAD7', // mint
  '#FFBF80', // light orange
  '#BFE0FF', // light blue
  '#CFF5A0', // lime
  '#D4C1EC', // lavender
  '#FFF2A1', // yellow
  '#FFDAB9', // peach
  '#A0E7E5', // aqua
  '#C8CF8A', // olive
  '#FFB3B3', // coral
  '#B5B9FF', // periwinkle
  '#E6D5B8', // sand
  '#E8C5F0', // lilac
  '#9FD8CF', // teal
  '#CFE3C0', // sage
  '#C9B1E3', // grape
  '#F4A7C3', // rose
  '#A5D8FF', // sky
  '#F7D6E0', // blush
  '#D8E2A8', // pistachio
  '#FFE0B5', // apricot
];

export function groupColorFor(label) {
  const index = FIXED_LABELS.indexOf(label);
  if (index < 0) return null;
  if (index < PASTEL_PALETTE.length) return PASTEL_PALETTE[index];
  const hue = Math.round((index * 137.508 + 20) % 360);
  return `hsl(${hue}, 62%, 80%)`;
}

// Automatic word groups that are taken into one of the groups above instead of getting a bubble of their own.
// The key is the first 8 letters of the word (so every spelling of it counts).
const MERGE_INTO = {
  kommissi: 'Kommissionierung', // Kommissioniert
  auftrag: 'Auftrag / Disposition / PZ - Nummer', // Auftrag
  bestands: 'Lagerbestand', // Bestandsveränderung
  gevis: 'Schnittstelle / Zabbix / Gevis', // Gevis
  löschen: 'Datenbereinigung / Removal / Tätigkeiten', // Löschen
  fehlerme: 'Fehler / -meldung intern / Kategorie', // Fehlermeldung
  interner: 'Fehler / -meldung intern / Kategorie', // Interner
  anlegen: 'Stammdaten', // Anlegen
};

// Words that are not a topic: they never get a bubble. Each of their tickets goes to the group its description points
// to (when exactly one group matches the description); otherwise it stays in "Other".
const DISSOLVE = new Set(['angezeig', 'ticket']); // Angezeigt, Ticket

// Words that say nothing about the topic. They are never used as a group name.
const EMPTY_WORDS = new Set(
  `fehler fehlerhafte fehlerhafter funktioniert möglich status supcis problem bearbeiten daten menge bocholt voerde
  elsinghorst`.split(/\s+/)
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
  return (cleaned.match(/[a-zäöüßæøå]{4,}/g) ?? []).filter((word) => !STOP_WORDS.has(word) && !EMPTY_WORDS.has(word));
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
  // The group label of every ticket, in the same order as `tickets` ("Other" for the leftovers).
  const labelOf = new Array(total).fill(OTHER_LABEL);

  // Fixed groups first: each ticket joins the first rule that matches its title.
  const fixedCounts = new Map();
  const blueLabels = new Set();
  tickets.forEach((ticket, index) => {
    // The [TAGS] in square brackets are ours, not the customer's wording: match the title without them.
    const title = (ticket.summary ?? '').replace(/\[[^\]]*\]/g, ' ');
    const rule = FIXED_GROUPS.find((candidate) => candidate.test.test(title));
    if (!rule) return;
    grouped[index] = true;
    labelOf[index] = rule.label;
    fixedCounts.set(rule.label, (fixedCounts.get(rule.label) ?? 0) + 1);
    if (rule.blue) blueLabels.add(rule.label);
  });
  for (const [label, count] of fixedCounts) groups.push({ label, count, other: false, fixed: true, blue: blueLabels.has(label) });
  const usedStems = new Set();

  // Repeatedly takes the word that covers the most still-ungrouped tickets and makes it a group.
  function takeGroups(index, forms) {
    for (;;) {
      let bestStem = null;
      let bestCount = 0;
      for (const [stem, members] of index) {
        if (usedStems.has(stem)) continue;
        let count = 0;
        for (const member of members) if (!grouped[member]) count += 1;
        if (count > bestCount) {
          bestStem = stem;
          bestCount = count;
        }
      }
      if (!bestStem || bestCount < threshold) break;

      usedStems.add(bestStem);
      if (DISSOLVE.has(bestStem)) {
        for (const member of index.get(bestStem)) {
          if (grouped[member]) continue;
          const description = (tickets[member].description ?? '').replace(/\[[^\]]*\]/g, ' ');
          const hits = [...new Set(FIXED_GROUPS.filter((rule) => rule.test.test(description)).map((rule) => rule.label))];
          if (hits.length !== 1) continue;
          grouped[member] = true;
          labelOf[member] = hits[0];
          let target = groups.find((group) => group.label === hits[0]);
          if (!target) {
            target = { label: hits[0], count: 0, other: false, fixed: true, blue: Boolean(FIXED_GROUPS.find((rule) => rule.label === hits[0])?.blue) };
            groups.push(target);
          }
          target.count += 1;
        }
        continue;
      }

      const ownLabel = capitalise([...forms.get(bestStem).entries()].sort((a, b) => b[1] - a[1])[0][0]);
      const mergeTarget = MERGE_INTO[bestStem];
      const label = mergeTarget ?? ownLabel;
      for (const member of index.get(bestStem)) {
        if (!grouped[member]) labelOf[member] = label;
        grouped[member] = true;
      }
      if (mergeTarget) {
        // Taken into one of the fixed groups (the group exists already, or is created here).
        let target = groups.find((group) => group.label === mergeTarget);
        if (!target) {
          target = { label: mergeTarget, count: 0, other: false, fixed: true, blue: Boolean(FIXED_GROUPS.find((rule) => rule.label === mergeTarget)?.blue) };
          groups.push(target);
        }
        target.count += bestCount;
      } else {
        groups.push({ label, count: bestCount, other: false });
      }
    }
  }

  // Pass 1: the words of the titles.
  takeGroups(ticketsByStem, spellings);

  // Pass 2: only the tickets that are still ungrouped, now with the words of the description as well.
  // A description word may only name a group if it also appears in ticket titles, so names from signatures never do.
  const titleStems = new Set(tickets.flatMap((ticket) => wordsOf(ticket.summary).map((word) => word.slice(0, STEM_LENGTH))));
  const index2 = new Map();
  const forms2 = new Map();
  tickets.forEach((ticket, position) => {
    if (grouped[position]) return;
    const words = [
      ...wordsOf(ticket.summary),
      ...wordsOf(ticket.description).filter((word) => titleStems.has(word.slice(0, STEM_LENGTH))),
    ];
    const seen = new Set();
    for (const word of words) {
      const stem = word.slice(0, STEM_LENGTH);
      if (!seen.has(stem)) {
        seen.add(stem);
        if (!index2.has(stem)) index2.set(stem, []);
        index2.get(stem).push(position);
      }
      if (!forms2.has(stem)) forms2.set(stem, new Map());
      forms2.get(stem).set(word, (forms2.get(stem).get(word) ?? 0) + 1);
    }
  });
  takeGroups(index2, forms2);

  const leftover = grouped.filter((flag) => !flag).length;
  if (leftover) groups.push({ label: OTHER_LABEL, count: leftover, other: true });

  const sorted = groups.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  sorted.labelOf = labelOf;
  return sorted;
}
