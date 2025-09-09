const fetch = require('node-fetch');

const OWNER = process.env.GITHUB_OWNER || 'sidarthus89';
const REPO = process.env.GITHUB_REPO || 'EVE-Data-Site';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN;
const API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com';
const GLOBAL_DATA_PREFIX = (process.env.GITHUB_DATA_PREFIX || '').replace(/\/$/, '');

if (!TOKEN) {
  // Not throwing by default; callers should handle missing token gracefully
  // console.warn('GITHUB_TOKEN is not set; GitHub commits will be skipped.');
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function getFileSha(path, { owner = OWNER, repo = REPO, branch = BRANCH } = {}) {
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'EVE-Data-Site-AzureFunction'
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFileSha failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json.sha || null;
}

async function getFileWithContent(path, { owner = OWNER, repo = REPO, branch = BRANCH } = {}) {
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'EVE-Data-Site-AzureFunction'
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFileWithContent failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json; // includes sha, content (base64 with newlines), encoding
}

async function upsertFile(path, content, message, { owner = OWNER, repo = REPO, branch = BRANCH } = {}) {
  if (!TOKEN) return { skipped: true, reason: 'missing-token' };
  const sha = await getFileSha(path, { owner, repo, branch }).catch(() => null);
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
  const body = {
    message: message || `Update ${path}`,
    content: Buffer.from(content).toString('base64'),
    branch,
    sha: sha || undefined
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'EVE-Data-Site-AzureFunction',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub upsertFile failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

async function upsertFileIfChanged(path, content, message, { owner = OWNER, repo = REPO, branch = BRANCH } = {}) {
  if (!TOKEN) return { skipped: true, reason: 'missing-token' };
  const existing = await getFileWithContent(path, { owner, repo, branch }).catch(() => null);
  const newB64 = Buffer.from(content).toString('base64');
  if (existing && typeof existing.content === 'string') {
    const existingB64 = existing.content.replace(/\s+/g, ''); // API returns with newlines
    if (existingB64 === newB64) {
      return { skipped: true, reason: 'unchanged', path, owner, repo, branch };
    }
  }
  return upsertFile(path, content, message, { owner, repo, branch });
}

function parseTargets() {
  const list = (process.env.GITHUB_REPOS || '').split(',').map(s => s.trim()).filter(Boolean);
  const branches = (process.env.GITHUB_BRANCHES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) {
    return [{ owner: OWNER, repo: REPO, branch: BRANCH }];
  }
  return list.map((entry, idx) => {
    let owner = OWNER;
    let repo = entry;
    if (entry.includes('/')) {
      const [o, r] = entry.split('/');
      owner = o || OWNER;
      repo = r;
    }
    const branch = branches[idx] || BRANCH;
    return { owner, repo, branch };
  });
}

async function upsertToAll(path, content, message) {
  const targets = parseTargets();
  const results = [];
  for (const t of targets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await upsertFile(path, content, message, t);
      results.push({ ...t, ok: true, res });
    } catch (e) {
      results.push({ ...t, ok: false, error: e.message });
    }
  }
  return results;
}

function dataPrefixForTarget(t) {
  if (GLOBAL_DATA_PREFIX) return GLOBAL_DATA_PREFIX; // explicit override
  // Default: gh-pages serves from repo root, use 'data'; others assume repo src with public/data
  return t.branch === 'gh-pages' ? 'data' : 'public/data';
}

async function upsertDataToAll(relativePath, content, message) {
  const targets = parseTargets();
  const results = [];
  for (const t of targets) {
    const prefix = dataPrefixForTarget(t);
    const fullPath = `${prefix}/${relativePath}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await upsertFileIfChanged(fullPath, content, message, t);
      results.push({ ...t, ok: true, res, path: fullPath });
    } catch (e) {
      results.push({ ...t, ok: false, error: e.message, path: fullPath });
    }
  }
  return results;
}

module.exports = { upsertFile, upsertToAll, upsertDataToAll };
