// Calendar dates as "YYYY-MM-DD" strings. Math is done in UTC on the calendar
// day, so daylight-saving changes never shift a birthday or an expiry.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today on this device's calendar. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isIsoDate(s: string | null | undefined): boolean {
  const m = s ? ISO.exec(s) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from a to b (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** "Mar 3" (or "Mar 3, 2027" when the year differs from today's). */
export function formatDate(iso: string, today: string = todayIso()): string {
  const [y, m, d] = parts(iso);
  const sameYear = y === parts(today)[0];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  });
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days until the next birthday (0 = today). A Feb 29 birthday counts as Feb 28 in other years. */
export function daysUntilBirthday(birthday: string, today: string = todayIso()): number | null {
  if (!isIsoDate(birthday)) return null;
  const [, bm, bd] = parts(birthday);
  const [ty] = parts(today);
  const on = (year: number) => {
    const day = bm === 2 && bd === 29 && !isLeap(year) ? 28 : bd;
    return `${year}-${pad(bm)}-${pad(day)}`;
  };
  let next = on(ty);
  if (daysBetween(today, next) < 0) next = on(ty + 1);
  return daysBetween(today, next);
}

/** "birthday today", "birthday tomorrow", "birthday in 5 days"; null when more than a week away. */
export function birthdayTag(birthday: string | null, today: string = todayIso()): string | null {
  if (!birthday) return null;
  const n = daysUntilBirthday(birthday, today);
  if (n === null || n > 7) return null;
  return n === 0 ? "birthday today" : n === 1 ? "birthday tomorrow" : `birthday in ${n} days`;
}

/** "8 mo", "1 yr", "3 yrs"; empty for a future or missing date. */
export function ageText(birthday: string | null, today: string = todayIso()): string {
  if (!birthday || !isIsoDate(birthday)) return "";
  const [by, bm, bd] = parts(birthday);
  const [ty, tm, td] = parts(today);
  const months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 0) return "";
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  return `${years} yr${years === 1 ? "" : "s"}`;
}

function parts(iso: string): [number, number, number] {
  const m = ISO.exec(iso);
  if (!m) throw new TypeError(`Not a YYYY-MM-DD date: ${iso}`);
  return [+m[1]!, +m[2]!, +m[3]!];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
