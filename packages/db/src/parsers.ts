// How PGlite turns Postgres values into JavaScript. Dates stay "YYYY-MM-DD" strings:
// a JS Date would carry a time zone and could show a birthday a day early.
// numeric is only used for non-money values (pet weight), so a number is fine.
// Pass these to every PGlite instance (the browser worker and tests).
const DATE_OID = 1082;
const NUMERIC_OID = 1700;

export const PGLITE_PARSERS = {
  [DATE_OID]: (v: string) => v,
  [NUMERIC_OID]: (v: string) => Number(v),
};
