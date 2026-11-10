import { rmSync, mkdirSync, cpSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { computeVersion, versionHtml, versionJs } from "./cache-bust.mjs";

const SRC = "src";
const DOCS = "docs";

function getPageAssetBasePath(sourceFilePath) {
  const docsRoot = path.resolve(DOCS);
  const sourceDocsPath = path.resolve(path.join(DOCS, path.relative(SRC, sourceFilePath)));
  const relativePath = path.relative(path.dirname(sourceDocsPath), docsRoot).replace(/\\/g, "/");

  if (!relativePath || relativePath === ".") {
    return "./";
  }

  return `${relativePath}/`;
}

function injectPageBase(html, sourceFilePath) {
  const basePath = getPageAssetBasePath(sourceFilePath);

  const withBodyDataset = html.includes("<body")
    ? html.replace(
        /<body([^>]*)>/i,
        (_match, attributes) => `<body${attributes} data-asset-base-path="${basePath}">`
      )
    : html;

  const headMatch = withBodyDataset.match(/<head\s*>/i);

  if (!headMatch) {
    return withBodyDataset;
  }

  const baseTag = `<base href="${basePath}">`;

  if (withBodyDataset.includes("<base ")) {
    return withBodyDataset.replace(/<base\s+[^>]*>/i, baseTag);
  }

  return withBodyDataset.replace(headMatch[0], `${headMatch[0]}\n    ${baseTag}`);
}

function renderHtmlWithPartials(entryFilePath, seen = new Set()) {
  const resolvedEntry = path.resolve(entryFilePath);

  if (seen.has(resolvedEntry)) {
    throw new Error(`Circular partial include detected: ${resolvedEntry}`);
  }

  seen.add(resolvedEntry);

  const html = readFileSync(resolvedEntry, "utf8");
  const includePattern = /<!--\s*@include\s+([^\s]+)\s*-->/g;

  const rendered = html.replace(includePattern, (_match, includePath) => {
    const partialPath = path.resolve(path.dirname(resolvedEntry), includePath);

    if (!existsSync(partialPath)) {
      throw new Error(`Partial not found: ${includePath} in ${entryFilePath}`);
    }

    return renderHtmlWithPartials(partialPath, new Set(seen));
  });

  return rendered;
}

function clean() {
  if (existsSync(DOCS)) rmSync(DOCS, { recursive: true, force: true });
  mkdirSync(`${DOCS}/css`, { recursive: true });
  mkdirSync(`${DOCS}/js`, { recursive: true });
  mkdirSync(`${DOCS}/assets`, { recursive: true });
}

function copyStatic() {
  const version = computeVersion(SRC);

  // kopieer alle .html bestanden in src root
  for (const file of readdirSync(SRC)) {
    if (file.endsWith(".html")) {
      const fromPath = path.join(SRC, file);
      const toPath = path.join(DOCS, file);
      const renderedHtml = versionHtml(injectPageBase(renderHtmlWithPartials(fromPath), fromPath), version);

      writeFileSync(toPath, renderedHtml, "utf8");
    }
  }

  cpSync(`${SRC}/js`, `${DOCS}/js`, { recursive: true, force: true });

  for (const file of readdirSync(`${DOCS}/js`)) {
    if (file.endsWith(".js")) {
      const filePath = path.join(DOCS, "js", file);
      writeFileSync(filePath, versionJs(readFileSync(filePath, "utf8"), version), "utf8");
    }
  }
  cpSync(`${SRC}/assets`, `${DOCS}/assets`, { recursive: true, force: true });

  // kopieer root-bestanden die direct in docs moeten staan
  for (const file of ["sitemap.xml", "robots.txt", "site.webmanifest"]) {
    if (existsSync(`${SRC}/${file}`)) {
      copyFileSync(`${SRC}/${file}`, `${DOCS}/${file}`);
    }
  }
}

function buildCss() {
  execSync(
    "npx tailwindcss -i ./src/css/main.css -o ./docs/css/main.css --postcss --minify",
    { stdio: "inherit" }
  );
}

clean();
copyStatic();
buildCss();
