// Automatic cloud backup into a secret GitHub gist of the user's own account.
// Needs a GitHub token with only the "gist" permission; it is stored on this phone only.

const CONFIG_KEY = 'carpool-cloud';
const API = 'https://api.github.com';
const FILE = 'carpool-backup.json';
const DESCRIPTION = 'Carpool app backup – do not delete';

export const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Carpool%20app%20backup';

export function cloudConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY));
  } catch {
    return null;
  }
}

function saveConfig(c) {
  if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  else localStorage.removeItem(CONFIG_KEY);
}

export const disconnect = () => saveConfig(null);

async function gh(token, path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new Error('GitHub does not accept the token (wrong or expired)');
  if (res.status === 403 || res.status === 404) throw new Error('the token has no "gist" permission, or the backup was deleted');
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  return res.json();
}

// Stores the token and looks for an existing backup (e.g. when setting up a new phone).
export async function connect(token) {
  const gists = await gh(token, '/gists?per_page=100');
  const found = gists.find((g) => g.files?.[FILE]);
  saveConfig({ token, gistId: found?.id ?? null, lastSync: null, error: null });
  return found ? { updatedAt: found.updated_at } : null;
}

export async function download() {
  const c = cloudConfig();
  const g = await gh(c.token, `/gists/${c.gistId}`);
  const f = g.files[FILE];
  if (!f) throw new Error('the backup file is missing in the gist');
  return f.truncated ? (await fetch(f.raw_url)).text() : f.content;
}

export async function upload(state) {
  const c = cloudConfig();
  if (!c) return;
  const files = { [FILE]: { content: JSON.stringify(state) } };
  try {
    if (c.gistId) {
      await gh(c.token, `/gists/${c.gistId}`, { method: 'PATCH', body: JSON.stringify({ description: DESCRIPTION, files }) });
    } else {
      const g = await gh(c.token, '/gists', { method: 'POST', body: JSON.stringify({ description: DESCRIPTION, public: false, files }) });
      c.gistId = g.id;
    }
    Object.assign(c, { lastSync: new Date().toISOString(), pending: false, error: null });
  } catch (err) {
    Object.assign(c, { pending: true, error: err.message });
    throw err;
  } finally {
    saveConfig(c);
  }
}

export function markPending() {
  const c = cloudConfig();
  if (c) saveConfig({ ...c, pending: true });
}
