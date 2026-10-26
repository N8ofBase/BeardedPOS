// The CloudFront Function in front of the store site (cloudfront-js-2.0, so plain ES5-style code).

/**
 * Old Squarespace addresses get a 301 to their new pages; any other path without a file extension
 * loads the single-page app. Runs in CloudFront for the site only, so /api 404s stay JSON.
 */
export function viewerRequestCode(redirects: Record<string, string>): string {
  return `
var REDIRECTS = ${JSON.stringify(redirects)};
function handler(event) {
  var req = event.request;
  var path = req.uri.toLowerCase().replace(/\\/+$/, "");
  var to = REDIRECTS[path];
  if (to) {
    return { statusCode: 301, statusDescription: "Moved Permanently", headers: { location: { value: to } } };
  }
  var last = req.uri.split("/").pop();
  if (last.indexOf(".") === -1) req.uri = "/index.html";
  return req;
}`;
}
