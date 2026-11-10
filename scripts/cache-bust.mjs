// Cache busting: adds ?v=<version> to local .js/.css references in HTML and to relative module imports in JS.
// GitHub Pages doesn't allow custom Cache-Control headers, so a changed URL is the only way to force fresh files.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const VERSIONED_SOURCE_EXTENSIONS = new Set([".html", ".js", ".css"]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (fullPath !== path.join("src", "assets")) walk(fullPath, files);
      continue;
    }

    if (VERSIONED_SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(fullPath);
  }

  return files;
}

// Content hash of everything that ends up in the HTML/JS/CSS output, so the version only changes when the code does
// (keeps docs/ diffs quiet when nothing changed).
export function computeVersion(srcDir = "src") {
  const hash = createHash("sha1");
  const files = walk(srcDir).sort();

  if (existsSync("tailwind.config.js")) files.push("tailwind.config.js");

  for (const file of files) {
    hash.update(file.replace(/\\/g, "/"));
    hash.update(readFileSync(file));
  }

  return hash.digest("hex").slice(0, 10);
}

// <script src="./js/x.js"> and <link href="./css/x.css"> (local only; external URLs and existing queries are left alone).
const HTML_ASSET_PATTERN = /(\s(?:src|href)=)(["'])(?![a-z][a-z0-9+.-]*:|\/\/)([^"'?#]+\.(?:js|css))\2/gi;

export function versionHtml(html, version) {
  return html.replace(HTML_ASSET_PATTERN, (_match, attribute, quote, url) => `${attribute}${quote}${url}?v=${version}${quote}`);
}

// import x from './a.js', export * from '../b.js', import './c.js', import('./d.js')
const JS_IMPORT_PATTERN = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"'?#]+\.js)\2/g;

export function versionJs(code, version) {
  return code.replace(JS_IMPORT_PATTERN, (_match, prefix, quote, specifier) => `${prefix}${quote}${specifier}?v=${version}${quote}`);
}
