// Хранилище переноса. Не подключено к рабочей программе до проверки всего пути записи.
'use strict';
const { webcrypto } = require('node:crypto');
const crypto = webcrypto;
const FORMAT = 'sverka.github.v1';
const KEY_FORMAT = 'sverka.github.key.v1';
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const MAX_BYTES = 64 * 1024 * 1024;
const fail = (code) => Object.assign(new Error(code), { code });
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw fail('INVALID_NUMBER'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw fail('INVALID_VALUE');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
function bytes64(s, size) {
  if (typeof s !== 'string' || s.length > MAX_BYTES * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw fail('INVALID_ENVELOPE');
  const b = Buffer.from(s, 'base64');
  if ((size && b.length !== size) || b.length > MAX_BYTES) throw fail('INVALID_ENVELOPE');
  return b;
}
const b64 = b => Buffer.from(b).toString('base64');
async function digest(value) { return b64(await crypto.subtle.digest('SHA-256', enc.encode(canonical(value)))); }
async function derive(password, salt, iterations) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw fail('PASSWORD_LENGTH');
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function context(store, audience, revision) {
  if (![store, audience].every(s => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s)) || !Number.isSafeInteger(revision) || revision < 1) throw fail('INVALID_CONTEXT');
  return { format: FORMAT, store, audience, revision };
}
async function seal(value, password, meta) {
  const c = context(meta.store, meta.audience, meta.revision);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, 600000);
  const bytes = enc.encode(canonical(value)); if (bytes.length > MAX_BYTES - 16) throw fail('TOO_LARGE');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(canonical(c)) }, key, bytes);
  return { ...c, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 600000, salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) };
}
async function open(envelope, password, expected) {
  const c = context(expected.store, expected.audience, expected.revision);
  if (!envelope || envelope.format !== FORMAT || envelope.alg !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256'
      || envelope.iterations !== 600000 || envelope.store !== c.store || envelope.audience !== c.audience || envelope.revision !== c.revision) throw fail('INVALID_ENVELOPE');
  const key = await derive(password, bytes64(envelope.salt, 16), envelope.iterations);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes64(envelope.iv, 12), additionalData: enc.encode(canonical(c)) }, key, bytes64(envelope.ciphertext));
    return JSON.parse(dec.decode(plaintext));
  } catch { throw fail('DECRYPT_FAILED'); }
}
// Ключ обработчика уже случайный 256-битный: повторный PBKDF2 здесь не нужен.
async function sealKey(value, key, meta) {
  const c = { ...context(meta.store, meta.audience, meta.revision), format: KEY_FORMAT };
  const p = await require('./protocol.js').sealKey(value, key, c);
  return { ...c, alg: 'AES-256-GCM', iv: p.iv, ciphertext: p.data };
}
async function openKey(envelope, key, meta) {
  const c = { ...context(meta.store, meta.audience, meta.revision), format: KEY_FORMAT };
  if (!envelope || Object.keys(c).some(k => envelope[k] !== c[k]) || envelope.alg !== 'AES-256-GCM') throw fail('INVALID_ENVELOPE');
  return require('./protocol.js').openKey({ v: 1, iv: envelope.iv, data: envelope.ciphertext }, key, c);
}
function repositoryName(s) { if (typeof s !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) throw fail('INVALID_REPOSITORY'); return s; }
function filePath(s) { if (typeof s !== 'string' || !/^data\/v1\/[a-zA-Z0-9_/-]+\.enc$/.test(s) || s.includes('..') || s.includes('//')) throw fail('INVALID_PATH'); return s; }
// Все файлы одного состояния публикуются одним git-коммитом. Повтор на новой базе запрещён.
class Repository {
  constructor({ repo, branch = 'github-data', request }) {
    this.repo = repositoryName(repo);
    if (typeof branch !== 'string' || !/^[A-Za-z0-9_-]+$/.test(branch)) throw fail('INVALID_BRANCH');
    if (typeof request !== 'function') throw fail('INVALID_TRANSPORT');
    this.branch = branch; this.request = request;
  }
  async api(path, method = 'GET', body) {
    const r = await this.request('/repos/' + this.repo + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status === 409 || r.status === 422) throw fail('CONFLICT');
    if (!r.ok) throw fail('GITHUB_' + r.status);
    return r.json();
  }
  async head() { return (await this.api('/git/ref/heads/' + this.branch)).object.sha; }
  async commit(expectedHead, files, operationId) {
    if (!/^[a-f0-9]{40}$/.test(expectedHead) || !/^[a-zA-Z0-9_-]{16,80}$/.test(operationId) || !Array.isArray(files) || !files.length || files.length > 1000) throw fail('INVALID_COMMIT');
    const seen = new Set();
    // На GitHub уходят только конверты шифрования, никогда исходные строки таблиц.
    for (const f of files) {
      filePath(f.path); if (seen.has(f.path)) throw fail('DUPLICATE_PATH'); seen.add(f.path);
      context(f.envelope.store, f.envelope.audience, f.envelope.revision);
      const raw = f.envelope.format === KEY_FORMAT;
      if ((!raw && (f.envelope.format !== FORMAT || f.envelope.kdf !== 'PBKDF2-SHA256' || f.envelope.iterations !== 600000)) || f.envelope.alg !== 'AES-256-GCM') throw fail('INVALID_ENVELOPE');
      if (!raw) bytes64(f.envelope.salt, 16);
      bytes64(f.envelope.iv, 12); if (bytes64(f.envelope.ciphertext).length < 16) throw fail('INVALID_ENVELOPE');
      const fields = raw ? ['format','store','audience','revision','alg','iv','ciphertext'] : ['format','store','audience','revision','alg','kdf','iterations','salt','iv','ciphertext'];
      if (Object.keys(f.envelope).some(k => !fields.includes(k))) throw fail('UNEXPECTED_FIELD');
    }
    if (await this.head() !== expectedHead) throw fail('CONFLICT');
    const base = await this.api('/git/commits/' + expectedHead), entries = [];
    for (const f of files) {
      const blob = await this.api('/git/blobs', 'POST', { content: canonical(f.envelope), encoding: 'utf-8' });
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const tree = await this.api('/git/trees', 'POST', { base_tree: base.tree.sha, tree: entries });
    const commit = await this.api('/git/commits', 'POST', { message: 'sverka-operation:' + operationId, tree: tree.sha, parents: [expectedHead] });
    // CAS: если другой коммит уже принят, GitHub отклонит не-fast-forward.
    try { await this.api('/git/refs/heads/' + this.branch, 'PATCH', { sha: commit.sha, force: false }); }
    catch (e) { if (e.code === 'CONFLICT') throw e; throw fail('COMMIT_UNKNOWN'); }
    // Не считать успешный HTTP достаточным: прочитать фактическую вершину.
    if (await this.head() !== commit.sha) throw fail('COMMIT_UNKNOWN');
    return { sha: commit.sha, operationId };
  }
}
module.exports = { FORMAT, KEY_FORMAT, canonical, digest, seal, open, sealKey, openKey, Repository };
