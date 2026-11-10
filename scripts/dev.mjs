import chokidar from "chokidar";
import { mkdirSync, cpSync, copyFileSync, existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { computeVersion, versionHtml, versionJs } from "./cache-bust.mjs";

function writeFileWithRetry(filePath, content, encoding = "utf8") {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      writeFileSync(filePath, content, encoding);
      return;
    } catch (error) {
      if (attempt === maxAttempts || error.code !== "EBUSY") {
        throw error;
      }

      const waitMs = attempt * 150;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
}

const SRC = "src";
const DOCS = "docs";

function getPageAssetBasePath(sourceFilePath) {
  const docsRoot = path.resolve(DOCS);
  const sourceDocsPath = path.resolve(toDocsPath(sourceFilePath));
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

  return html.replace(includePattern, (_match, includePath) => {
    const fromCurrentDir = path.resolve(path.dirname(resolvedEntry), includePath);
    const fromSrcRoot = path.resolve(SRC, includePath.replace(/^[/\\]+/, ""));
    const partialPath = existsSync(fromCurrentDir) ? fromCurrentDir : fromSrcRoot;

    if (!existsSync(partialPath)) {
      throw new Error(`Partial not found: ${includePath} in ${entryFilePath}`);
    }

    return renderHtmlWithPartials(partialPath, new Set(seen));
  });
}

function ensureDirs() {
  mkdirSync(path.join(DOCS, "css"), { recursive: true });
  mkdirSync(path.join(DOCS, "js"), { recursive: true });
  mkdirSync(path.join(DOCS, "assets"), { recursive: true });
}

function copyFile(from, to) {
  ensureDirs();
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function copyDir(from, to) {
  ensureDirs();
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
}

function removePath(p) {
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

let version = computeVersion(SRC);

function renderHtmlFile(source) {
  const dest = toDocsPath(source);
  const html = versionHtml(injectPageBase(renderHtmlWithPartials(source), source), version);

  ensureDirs();
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileWithRetry(dest, html, "utf8");
}

function isJsFile(p) {
  return path.extname(p) === ".js";
}

function copyJsFile(source) {
  const dest = toDocsPath(source);

  ensureDirs();
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileWithRetry(dest, versionJs(readFileSync(source, "utf8"), version), "utf8");
}

function copySourceFile(source) {
  if (isJsFile(source)) {
    copyJsFile(source);
    return;
  }

  copyFile(source, toDocsPath(source));
}

// A code change gives a new version, so every page and module must point at the new URLs.
function refreshVersion() {
  const nextVersion = computeVersion(SRC);

  if (nextVersion === version) return false;

  version = nextVersion;
  renderAllHtmlFiles();

  for (const file of walkFiles(SRC)) {
    if (isJsFile(file) && !isInPartials(file)) copyJsFile(file);
  }

  return true;
}

function isCodeFile(p) {
  return [".html", ".js", ".css"].includes(path.extname(p)) && !p.startsWith(path.join(SRC, "assets") + path.sep);
}

function walkFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function isHtmlFile(p) {
  return path.extname(p) === ".html";
}

function renderAllHtmlFiles() {
  for (const file of walkFiles(SRC)) {
    if (isHtmlFile(file) && !isPartialsHtmlFile(file)) {
      renderHtmlFile(file);
    }
  }
}

function isPartialsHtmlFile(p) {
  return p.startsWith(path.join(SRC, "partials") + path.sep) && path.extname(p) === ".html";
}

function isInPartials(p) {
  return p.startsWith(path.join(SRC, "partials") + path.sep);
}

function initialSync() {
  ensureDirs();
  renderAllHtmlFiles();

  for (const file of walkFiles(SRC)) {
    if (isInPartials(file) || isHtmlFile(file)) {
      continue;
    }

    copySourceFile(file);
  }
}

function toDocsPath(srcPath) {
  // src/xyz -> docs/xyz
  return path.join(DOCS, path.relative(SRC, srcPath));
}

ensureDirs();
initialSync();

// Tailwind watcher (dev: geen minify)
const tw = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "exec",
    "--",
    "tailwindcss",
    "-i",
    "./src/css/main.css",
    "-o",
    "./docs/css/main.css",
    "--postcss",
    "--watch",
  ],
  {
    stdio: "inherit",
    shell: process.platform === "win32", // belangrijk voor Windows + spaties in paden
    env: {
      ...process.env,
      NODE_OPTIONS: "--max-old-space-size=2048",
    },
  }
);

const watcher = chokidar.watch(
  [
    SRC,
    `${SRC}/js/**`,
    `${SRC}/assets/**`,
  ],
  { ignoreInitial: true }
);

function handleAddOrChange(p) {
  // A new version re-renders every page and module, this one included.
  if (isCodeFile(p) && refreshVersion()) {
    if (!isHtmlFile(p) && !isJsFile(p) && !isInPartials(p)) copyFile(p, toDocsPath(p));
    return;
  }

  if (isInPartials(p)) {
    if (isHtmlFile(p)) {
      renderAllHtmlFiles();
    }
    return;
  }

  if (isHtmlFile(p)) {
    renderHtmlFile(p);
    return;
  }

  copySourceFile(p);
}

watcher
  .on("add", handleAddOrChange)
  .on("change", handleAddOrChange)
  .on("unlink", (p) => {
    if (isCodeFile(p)) refreshVersion();

    if (isInPartials(p)) {
      if (isHtmlFile(p)) {
        renderAllHtmlFiles();
      }
      return;
    }

    const dest = toDocsPath(p);
    removePath(dest);
  })
  .on("addDir", (p) => {
    const dest = toDocsPath(p);
    mkdirSync(dest, { recursive: true });
  })
  .on("unlinkDir", (p) => {
    const dest = toDocsPath(p);
    removePath(dest);
  });

// Netjes afsluiten
function shutdown(code = 0) {
  try {
    watcher.close();
  } catch { }
  try {
    tw.kill("SIGINT");
  } catch { }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
