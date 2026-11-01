#!/usr/bin/env node
// Validates registry.json. No dependencies (Node 18 or newer). The same rules are in registry.schema.json (for editors) and are
// what the Rigbay host enforces when it reads the file (the host is stricter in one way: any error makes it ignore the whole file).
//
//   node scripts/validate.mjs [registry.json] [--base <older registry.json>]
//
// With --base (the pull request workflow passes the file from the target branch) a release that was already published may not be
// changed. It may be removed (a warning is printed), because yanking a bad release is allowed; changing one is not: the hash of a
// release is what users were shown.
// Exit code: 0 valid, 1 problems found, 2 bad usage.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_ZIP_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const RESERVED_IDS = ['rigbay', 'host', 'help', 'list', 'version'];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const COMPARATOR = /^(>=|<=|>|<|=)?\d+\.\d+(\.\d+)?$/;
const NAME_PART = /^[A-Za-z0-9._-]{1,100}$/;

const TOP_KEYS = ['$schema', 'schemaVersion', 'modules'];
const MODULE_KEYS = ['id', 'name', 'description', 'repo', 'icon', 'versions'];
const VERSION_KEYS = ['version', 'hostApi', 'zip', 'sha256', 'size', 'released', 'declares'];
const DECLARES_KEYS = ['admin', 'network', 'registry', 'services', 'outsideFiles'];

/** Semantic version ordering (build metadata ignored). Returns -1, 0 or 1. */
export function compareSemver(a, b) {
  const pa = SEMVER.exec(a), pb = SEMVER.exec(b);
  for (let i = 1; i <= 3; i++) {
    const x = BigInt(pa[i]), y = BigInt(pb[i]);
    if (x !== y) return x < y ? -1 : 1;
  }
  const ra = pa[4] ? pa[4].split('.') : [], rb = pb[4] ? pb[4].split('.') : [];
  if (!ra.length && !rb.length) return 0;
  if (!ra.length) return 1;
  if (!rb.length) return -1;
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    const x = ra[i], y = rb[i];
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    let c;
    if (xn && yn) c = x.length !== y.length ? (x.length < y.length ? -1 : 1) : (x < y ? -1 : x > y ? 1 : 0);
    else if (xn) c = -1;
    else if (yn) c = 1;
    else c = x < y ? -1 : x > y ? 1 : 0;
    if (c !== 0) return c;
  }
  return ra.length === rb.length ? 0 : ra.length < rb.length ? -1 : 1;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasControl = (s) => /[\u0000-\u001f\u007f]/.test(s);

function text(obj, key, path, errors, min, max) {
  const v = obj[key];
  if (typeof v !== 'string') { errors.push(`${path}.${key}: a string is required`); return null; }
  if (v.length < min || v.length > max || v !== v.trim() || hasControl(v)) {
    errors.push(`${path}.${key}: ${min} to ${max} characters, no control characters, no surrounding spaces`);
    return null;
  }
  return v;
}

function unknownKeys(obj, allowed, path, errors) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${path}.${k}: unknown field (allowed: ${allowed.join(', ')})`);
}

/** https://github.com/<owner>/<repo> exactly. Returns { owner, name } or null. */
export function parseRepo(repo) {
  let u;
  try { u = new URL(repo); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'github.com' || u.username || u.password || u.port || u.search || u.hash) return null;
  if (repo.endsWith('/') || repo.includes('//', 'https://'.length)) return null;
  const parts = u.pathname.split('/').filter((p, i) => i > 0);
  if (parts.length !== 2 || !NAME_PART.test(parts[0]) || !NAME_PART.test(parts[1]) || parts.some((p) => p === '.' || p === '..')) return null;
  return { owner: parts[0], name: parts[1] };
}

/** https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip of the same repo. */
export function isZipOfRepo(zip, repo) {
  const r = parseRepo(repo);
  if (!r || typeof zip !== 'string' || zip.length > 400 || zip.includes('\\') || /%2e|%2f/i.test(zip)) return false;
  let u;
  try { u = new URL(zip); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'github.com' || u.username || u.password || u.port || u.search || u.hash) return false;
  const parts = u.pathname.split('/');
  if (parts.length !== 7 || parts[0] !== '') return false;
  if (parts[1].toLowerCase() !== r.owner.toLowerCase() || parts[2].toLowerCase() !== r.name.toLowerCase()) return false;
  if (parts[3] !== 'releases' || parts[4] !== 'download') return false;
  if (!parts[5] || parts[5] === '.' || parts[5] === '..' || !parts[6] || parts[6] === '.' || parts[6] === '..') return false;
  return parts[6].toLowerCase().endsWith('.zip');
}

function isIconUrl(icon) {
  if (typeof icon !== 'string' || icon.length > 300) return false;
  let u;
  try { u = new URL(icon); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false;
  if (!['raw.githubusercontent.com', 'github.com'].includes(u.hostname.toLowerCase())) return false;
  return /\.(svg|png)$/i.test(u.pathname);
}

function validateDeclares(d, path, errors) {
  if (!isObject(d)) { errors.push(`${path}.declares: an object is required`); return; }
  unknownKeys(d, DECLARES_KEYS, `${path}.declares`, errors);
  if (typeof d.admin !== 'boolean') errors.push(`${path}.declares.admin: true or false is required`);
  for (const key of ['network', 'registry', 'services', 'outsideFiles']) {
    if (!(key in d)) continue;
    const arr = d[key];
    if (!Array.isArray(arr) || arr.length > 32) { errors.push(`${path}.declares.${key}: an array of at most 32 strings`); continue; }
    for (const s of arr) {
      if (typeof s !== 'string' || s.trim().length === 0 || s.length > 260 || hasControl(s)) errors.push(`${path}.declares.${key}: entries are strings of 1 to 260 characters`);
    }
  }
}

function validateVersion(v, path, repo, errors) {
  if (!isObject(v)) { errors.push(`${path}: must be an object`); return null; }
  unknownKeys(v, VERSION_KEYS, path, errors);
  const before = errors.length;
  const version = text(v, 'version', path, errors, 1, 64);
  if (version !== null && !SEMVER.test(version)) { errors.push(`${path}.version: not a semantic version ("${version}")`); }
  const hostApi = text(v, 'hostApi', path, errors, 1, 100);
  if (hostApi !== null) {
    const tokens = hostApi.split(' ').filter(Boolean);
    if (tokens.length === 0 || !tokens.every((t) => COMPARATOR.test(t))) errors.push(`${path}.hostApi: not a range like ">=0.1 <0.2" ("${hostApi}")`);
  }
  const zip = text(v, 'zip', path, errors, 1, 400);
  if (zip !== null && repo !== null && !isZipOfRepo(zip, repo)) errors.push(`${path}.zip: must be https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip of the repo above`);
  const sha = text(v, 'sha256', path, errors, 64, 64);
  if (sha !== null && !SHA256.test(sha)) errors.push(`${path}.sha256: 64 lowercase hex digits`);
  if (!Number.isInteger(v.size) || v.size < 1 || v.size > MAX_ZIP_BYTES) errors.push(`${path}.size: an integer from 1 to ${MAX_ZIP_BYTES} (bytes of the zip)`);
  const released = text(v, 'released', path, errors, 10, 10);
  if (released !== null) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(released);
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) errors.push(`${path}.released: a real date like 2026-11-01`);
  }
  validateDeclares(v.declares, path, errors);
  return errors.length === before && version !== null ? version : null;
}

/** Returns the list of problems (empty when the registry is valid). */
export function validateRegistry(doc) {
  const errors = [];
  if (!isObject(doc)) return ['the top level must be an object'];
  unknownKeys(doc, TOP_KEYS, '$', errors);
  if (doc.schemaVersion !== 1) errors.push(Number.isInteger(doc.schemaVersion) ? `schemaVersion ${doc.schemaVersion} is not supported (this validator reads 1)` : 'schemaVersion: the integer 1 is required');
  if (!Array.isArray(doc.modules)) { errors.push('modules: an array is required'); return errors; }
  if (doc.modules.length > 500) errors.push('modules: more than 500 entries');
  const seen = new Set();
  doc.modules.forEach((m, i) => {
    const path = `modules[${i}]`;
    if (!isObject(m)) { errors.push(`${path}: must be an object`); return; }
    unknownKeys(m, MODULE_KEYS, path, errors);
    const id = text(m, 'id', path, errors, 2, 40);
    if (id !== null) {
      if (!ID.test(id)) errors.push(`${path}.id: lowercase words joined by '-'`);
      else if (RESERVED_IDS.includes(id)) errors.push(`${path}.id: '${id}' is reserved`);
      if (seen.has(id)) errors.push(`${path}.id: '${id}' appears more than once`);
      seen.add(id);
    }
    text(m, 'name', path, errors, 1, 60);
    text(m, 'description', path, errors, 1, 200);
    const repo = text(m, 'repo', path, errors, 1, 200);
    if (repo !== null && !parseRepo(repo)) errors.push(`${path}.repo: must be https://github.com/<owner>/<repo>`);
    if ('icon' in m && !isIconUrl(m.icon)) errors.push(`${path}.icon: must be an https URL on raw.githubusercontent.com or github.com ending in .svg or .png`);
    if (!Array.isArray(m.versions) || m.versions.length === 0) { errors.push(`${path}.versions: a non-empty array is required`); return; }
    if (m.versions.length > 200) { errors.push(`${path}.versions: more than 200 entries`); return; }
    let previous = null;
    m.versions.forEach((v, j) => {
      const version = validateVersion(v, `${path}.versions[${j}]`, repo, errors);
      if (version === null || !SEMVER.test(version)) return;
      if (previous !== null && compareSemver(version, previous) <= 0) errors.push(`${path}.versions[${j}].version: versions must be strictly ascending ('${version}' after '${previous}')`);
      previous = version;
    });
  });
  return errors;
}

/** Problems when <head> changes a release that <base> already had; and the releases removed (warnings). */
export function compareWithBase(head, base) {
  const errors = [], warnings = [];
  const headModules = new Map((head.modules ?? []).map((m) => [m.id, m]));
  for (const bm of base.modules ?? []) {
    const hm = headModules.get(bm.id);
    if (!hm) { warnings.push(`module '${bm.id}' was removed from the registry`); continue; }
    if (hm.repo !== bm.repo) errors.push(`modules '${bm.id}': the repo of a published module may not change ('${bm.repo}' -> '${hm.repo}')`);
    const headVersions = new Map((hm.versions ?? []).map((v) => [v.version, v]));
    for (const bv of bm.versions ?? []) {
      const hv = headVersions.get(bv.version);
      if (!hv) { warnings.push(`'${bm.id}' ${bv.version} was removed (yanked)`); continue; }
      if (JSON.stringify(sortKeys(hv)) !== JSON.stringify(sortKeys(bv))) errors.push(`'${bm.id}' ${bv.version}: a published release may not be changed (publish a new version instead)`);
    }
  }
  return { errors, warnings };
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

function readJson(file) {
  if (!existsSync(file)) throw new Error(`${file}: no such file`);
  if (statSync(file).size > MAX_FILE_BYTES) throw new Error(`${file}: larger than ${MAX_FILE_BYTES} bytes`);
  const raw = readFileSync(file, 'utf8');
  try { return JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { throw new Error(`${file}: not valid JSON: ${e.message}`); }
}

function main(argv) {
  let file = 'registry.json', base = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') base = argv[++i];
    else if (argv[i].startsWith('--')) { console.error(`unknown option ${argv[i]}`); return 2; }
    else file = argv[i];
  }
  let doc;
  try { doc = readJson(file); } catch (e) { console.error(`::error::${e.message}`); return 1; }
  const errors = validateRegistry(doc);
  if (base && errors.length === 0) {
    const result = compareWithBase(doc, readJson(base));
    for (const w of result.warnings) console.log(`::warning::${w}`);
    errors.push(...result.errors);
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`::error file=${file}::${e}`);
    console.error(`${errors.length} problem(s) in ${file}`);
    return 1;
  }
  const count = doc.modules.length;
  console.log(`${file}: valid (${count} module${count === 1 ? '' : 's'}, ${doc.modules.reduce((n, m) => n + m.versions.length, 0)} release${doc.modules.reduce((n, m) => n + m.versions.length, 0) === 1 ? '' : 's'})`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)));
