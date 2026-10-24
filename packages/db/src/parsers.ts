// How PGlite turns Postgres values into JavaScript. Dates stay "YYYY-MM-DD" strings:
// a JS Date would carry a time zone and could show a birthday a day early.
// numeric is never used for money (money is integer cents), so a number is fine.
// Pass these to every PGlite instance (the browser worker and tests).
const DATE_OID = 1082;
const NUMERIC_OID = 1700;

export const PGLITE_PARSERS = {
  [DATE_OID]: (v: string) => v,
  [NUMERIC_OID]: (v: string) => Number(v),
};

/** Options for every PGlite instance. */
export const PGLITE_OPTIONS = {
  parsers: PGLITE_PARSERS,
};
