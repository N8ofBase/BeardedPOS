// The CloudFront Function in front of the store site (cloudfront-js-2.0, so plain ES5-style code).

/**
 * With a canonical host (the shop's own domain, once it's live), every other name (www, the
 * prismcortex.net one) gets a 301 to the same page there. Old Squarespace addresses get a 301 to
 * their new pages; any other path without a file extension
 * loads the single-page app: the register's under /register, the store's everywhere else. Runs in
 * CloudFront for the site only, so /api 404s stay JSON.
 */
export function viewerRequestCode(redirects: Record<string, string>, canonicalHost?: string): string {
  return `
var REDIRECTS = ${JSON.stringify(redirects)};
var CANONICAL = ${JSON.stringify(canonicalHost ?? "")};
function query(qs) {
  var parts = [];
  for (var k in qs) {
    var v = qs[k];
    var all = v.multiValue ? v.multiValue : [v];
    for (var i = 0; i < all.length; i++) parts.push(k + (all[i].value === "" ? "" : "=" + all[i].value));
  }
  return parts.length ? "?" + parts.join("&") : "";
}
function handler(event) {
  var req = event.request;
  var host = req.headers && req.headers.host ? req.headers.host.value.toLowerCase() : "";
  if (CANONICAL && host && host !== CANONICAL) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: "https://" + CANONICAL + req.uri + query(req.querystring || {}) } },
    };
  }
  var path = req.uri.toLowerCase().replace(/\\/+$/, "");
  var to = REDIRECTS[path];
  if (to) {
    return { statusCode: 301, statusDescription: "Moved Permanently", headers: { location: { value: to } } };
  }
  var last = req.uri.split("/").pop();
  if (last.indexOf(".") === -1)
    req.uri = path === "/register" || path.indexOf("/register/") === 0 ? "/register/index.html" : "/index.html";
  return req;
}`;
}
