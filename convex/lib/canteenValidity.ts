import { RATE_PER_DAY } from "./parsers/canteenRecon";

/**
 * Works out which canteen children are valid to eat on a given day.
 *
 * A child pays for N school days. Payments are dated by the day the recon was
 * prepared, and that day counts: pay for 2 days on Monday and you eat Monday
 * and Tuesday. Paying again before the days run out queues the new days after
 * the old ones, so a child is never short-changed by topping up early.
 *
 * School days are Mon–Thu; days are counted by index so Fri–Sun never eat into
 * what a child has paid for.
 */

const DAY_MS = 86_400_000;
/** 1970-01-05 was a Monday. */
const FIRST_MONDAY_DAY = 4;

const daysSinceMonday = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS) - FIRST_MONDAY_DAY;

export function isSchoolDay(iso: string): boolean {
  const n = daysSinceMonday(iso);
  return n - Math.floor(n / 7) * 7 <= 3;
}

/** Position of a date in the run of Mon–Thu school days; a non-school day maps to the next school day. */
export function schoolDayIndex(iso: string): number {
  const n = daysSinceMonday(iso);
  const week = Math.floor(n / 7);
  const dow = n - week * 7;
  return dow <= 3 ? week * 4 + dow : (week + 1) * 4;
}

export function dateOfSchoolDay(index: number): string {
  const week = Math.floor(index / 4);
  const dow = index - week * 4;
  return new Date((week * 7 + dow + FIRST_MONDAY_DAY) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The school day a Canteen Daily Sales or Inventory report is about, from its
 * period label. Those reports are scheduled Tue–Fri, so Monday's report is
 * filed under the Friday label before it: Tue–Thu labels are the day itself,
 * and a Friday label is the following Monday.
 */
export function reportDay(periodLabel: string): string {
  const d = new Date(`${periodLabel}T00:00:00Z`);
  if (d.getUTCDay() === 5) d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

// ── Name matching ────────────────────────────────────────────────────────────

export function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

const normClass = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Cost of treating two name parts as the same word; null when they are not. */
function tokenCost(x: string, y: string): number | null {
  if (x === y) return 0;
  const shortest = Math.min(x.length, y.length);
  if (shortest === 1) return x[0] === y[0] ? 0.5 : null; // an initial
  if (shortest < 4) return null;
  const d = editDistance(x, y);
  return d <= (Math.max(x.length, y.length) >= 8 ? 2 : 1) ? d : null;
}

/**
 * How far apart two names are, or null when they are not the same child.
 * Word order is ignored ("Banda Mary" = "Mary Banda"), a middle name may be
 * missing, and a one- or two-letter slip in a long word is forgiven. A
 * one-word name only ever matches exactly.
 */
export function nameCost(a: string[], b: string[]): number | null {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 0) return null;
  if (short.length === 1) return long.length === 1 && short[0] === long[0] ? 0 : null;

  const free = [...long];
  let cost = 0;
  for (const t of [...short].sort((p, q) => q.length - p.length)) {
    let best = -1;
    let bestCost = Infinity;
    free.forEach((u, i) => {
      const c = tokenCost(t, u);
      if (c !== null && c < bestCost) {
        best = i;
        bestCost = c;
      }
    });
    if (best < 0) return null;
    cost += bestCost;
    free.splice(best, 1);
  }
  return cost + free.length * 0.25;
}

// ── Ledger ───────────────────────────────────────────────────────────────────

export interface Payment {
  /** YYYY-MM-DD the recon was prepared. */
  date: string;
  name: string;
  className: string;
  amount: number;
}

interface Segment {
  paidOn: string;
  amount: number;
  days: number;
  /** The amount was not a whole number of days and was rounded. */
  rounded: boolean;
  /** First and last school-day index this payment covers. */
  start: number;
  end: number;
}

export interface Child {
  name: string;
  className: string;
  /** Other spellings merged into this child. */
  aliases: Set<string>;
  notes: string[];
  segments: Segment[];
}

export function daysForAmount(amount: number): { days: number; rounded: boolean } {
  const exact = amount / RATE_PER_DAY;
  const days = Math.max(1, Math.round(exact));
  return { days, rounded: Math.abs(exact - days) > 0.01 };
}

/** Replays every payment, oldest first, into one ledger per child. */
export function buildChildren(payments: Payment[]): Child[] {
  const children: Child[] = [];
  const classes = new Map<Child, string>();
  const byExactName = new Map<string, Child>();
  const paidThrough = new Map<Child, number>();

  const ordered = payments
    .map((p, i) => ({ p, i }))
    .sort((x, y) => (x.p.date < y.p.date ? -1 : x.p.date > y.p.date ? 1 : x.i - y.i))
    .map((x) => x.p);

  for (const pay of ordered) {
    const tokens = nameTokens(pay.name);
    if (tokens.length === 0) continue;
    const cls = normClass(pay.className);
    const exactKey = [...tokens].sort().join(" ");

    let child = byExactName.get(exactKey);
    let ambiguous: Child[] = [];
    if (!child) {
      let bestCost = Infinity;
      let ties: Child[] = [];
      for (const c of children) {
        const known = classes.get(c) ?? "";
        if (cls && known && cls !== known) continue;
        const cost = nameCost(tokens, nameTokens(c.name));
        if (cost === null) continue;
        if (cost < bestCost) {
          bestCost = cost;
          ties = [c];
        } else if (cost === bestCost) ties.push(c);
      }
      if (ties.length === 1) child = ties[0];
      else ambiguous = ties;
    }

    if (!child) {
      child = { name: pay.name.trim(), className: pay.className.trim(), aliases: new Set(), notes: [], segments: [] };
      for (const other of ambiguous) {
        child.notes.push(`Name is close to "${other.name}" — kept separate; check they are different children.`);
      }
      children.push(child);
      paidThrough.set(child, -1);
    } else if (pay.name.trim() !== child.name) {
      child.aliases.add(pay.name.trim());
    }
    byExactName.set(exactKey, child);
    if (pay.className.trim()) {
      child.className = pay.className.trim();
      classes.set(child, cls);
    }

    const { days, rounded } = daysForAmount(pay.amount);
    const start = Math.max(schoolDayIndex(pay.date), (paidThrough.get(child) ?? -1) + 1);
    const end = start + days - 1;
    child.segments.push({ paidOn: pay.date, amount: pay.amount, days, rounded, start, end });
    paidThrough.set(child, end);
  }
  return children;
}

export interface ValidChild {
  name: string;
  className: string;
  /** School days still to eat after the given day. 0 means it is their last day. */
  daysAfter: number;
  lastValidDay: string;
  paidToday: { amount: number; days: number; rounded: boolean } | null;
  lastPayment: { date: string; amount: number; days: number; rounded: boolean };
  aliases: string[];
  notes: string[];
}

/** Children entitled to eat on `date`, using only payments made on or before it. */
export function validOn(children: Child[], date: string): ValidChild[] {
  if (!isSchoolDay(date)) return [];
  const d = schoolDayIndex(date);
  const out: ValidChild[] = [];
  for (const c of children) {
    const segs = c.segments.filter((s) => s.paidOn <= date);
    if (!segs.some((s) => s.start <= d && d <= s.end)) continue;
    const through = Math.max(...segs.map((s) => s.end));
    const today = segs.filter((s) => s.paidOn === date);
    const last = segs[segs.length - 1];
    out.push({
      name: c.name,
      className: c.className,
      daysAfter: through - d,
      lastValidDay: dateOfSchoolDay(through),
      paidToday: today.length
        ? {
            amount: today.reduce((n, s) => n + s.amount, 0),
            days: today.reduce((n, s) => n + s.days, 0),
            rounded: today.some((s) => s.rounded),
          }
        : null,
      lastPayment: { date: last.paidOn, amount: last.amount, days: last.days, rounded: last.rounded },
      aliases: [...c.aliases],
      notes: c.notes,
    });
  }
  return out.sort(
    (a, b) => a.daysAfter - b.daysAfter || a.className.localeCompare(b.className) || a.name.localeCompare(b.name),
  );
}

/** Children whose last valid day was the school day before `date` and who have not renewed. */
export function justExpiredOn(children: Child[], date: string): Array<{ name: string; className: string; lastValidDay: string; lastPaidOn: string }> {
  const d = schoolDayIndex(date);
  const out = [];
  for (const c of children) {
    const segs = c.segments.filter((s) => s.paidOn <= date);
    if (segs.length === 0) continue;
    const through = Math.max(...segs.map((s) => s.end));
    if (through !== d - 1) continue;
    out.push({
      name: c.name,
      className: c.className,
      lastValidDay: dateOfSchoolDay(through),
      lastPaidOn: segs[segs.length - 1].paidOn,
    });
  }
  return out.sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));
}

/**
 * Which days need a report built: those never reported, and those whose report
 * is older than a recon dated on or before them (a correction or a late recon
 * changes every later day's ledger).
 *
 * @param reconAt    recon date → when that recon was last submitted
 * @param reportedAt report date → when that report was last submitted
 */
export function datesToReport(reconAt: Map<string, number>, reportedAt: Map<string, number>): string[] {
  const out: string[] = [];
  let newest = 0;
  for (const date of [...reconAt.keys()].sort()) {
    newest = Math.max(newest, reconAt.get(date) ?? 0);
    if (!isSchoolDay(date)) continue;
    const at = reportedAt.get(date);
    if (at === undefined || at < newest) out.push(date);
  }
  return out;
}
