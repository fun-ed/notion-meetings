// Accounts, sessions and meeting permissions. Stored in DATA/auth.json (data/ is gitignored).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const LEVELS = ['none', 'view', 'comment', 'edit', 'owner'];
export const ACCESS = ['private', 'view', 'comment', 'edit']; // what other logged-in users get on a meeting
export const ROLES = ['admin', 'member', 'readonly'];
export const rank = level => LEVELS.indexOf(level);
const uniq = xs => [...new Set(xs)];

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(password), salt, 64).toString('hex') };
}
export function verifyPassword(password, { salt, hash }) {
  const a = scryptSync(String(password), salt, 64), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Admins and owners get everything; others get the meeting's access level or a share grant, whichever is higher.
export function permOf(user, m) {
  if (!user) return 'none';
  if (user.role === 'admin') return 'owner';
  const base = m.ownerId === user.id ? 'owner' : (m.access ?? 'view') === 'private' ? 'none' : m.access ?? 'view';
  const best = [base, ...(m.grants ?? []).filter(g => g.userId === user.id).map(g => g.perm)]
    .reduce((a, b) => (rank(b) > rank(a) ? b : a), 'none');
  return user.role === 'readonly' && rank(best) > rank('view') ? 'view' : best; // readonly accounts never write
}

const names = v => uniq((Array.isArray(v) ? v : String(v ?? '').split(/[,，、\n]/)).map(x => String(x).trim().slice(0, 60)).filter(Boolean)).slice(0, 200);
// Groups arrive as lines "群組名: 成員1, 成員2" or as [{name, members}].
export function cleanProfile(p = {}) {
  const groups = Array.isArray(p.groups) ? p.groups
    : String(p.groups ?? '').split('\n').map(l => { const [name, ...rest] = l.split(/[:：]/); return { name, members: rest.join(',') }; });
  return {
    team: String(p.team ?? '').trim().slice(0, 60), leader: String(p.leader ?? '').trim().slice(0, 60), members: names(p.members),
    groups: groups.slice(0, 50).map(g => ({ name: String(g?.name ?? '').trim().slice(0, 60), members: names(g?.members) })).filter(g => g.name),
  };
}

// One directory: teammates listed in profiles < CSV rows < each user's own profile. Groups attach to the people they list.
export function mergePeople(csvPeople, users) {
  const map = new Map();
  const put = p => {
    const k = p.name.toLowerCase(), prev = map.get(k);
    map.set(k, { name: prev?.name ?? p.name, team: p.team || prev?.team || '', leader: p.leader || prev?.leader || '',
      aliases: uniq([...(prev?.aliases ?? []), ...(p.aliases ?? [])]), groups: prev?.groups ?? [] });
  };
  for (const u of users) for (const n of u.profile?.members ?? []) put({ name: n, team: u.profile.team, leader: u.profile.leader });
  csvPeople.forEach(put);
  for (const u of users) put({ name: u.displayName || u.username, team: u.profile?.team, leader: u.profile?.leader, aliases: [u.username] });
  for (const u of users) for (const g of u.profile?.groups ?? []) for (const n of g.members) {
    if (!map.has(n.toLowerCase())) put({ name: n });
    const p = map.get(n.toLowerCase());
    if (!p.groups.includes(g.name)) p.groups.push(g.name);
  }
  return [...map.values()];
}

export const publicUser = u => u && ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, createdAt: u.createdAt, profile: u.profile, mustChangePassword: !!u.mustChangePassword });

// A JSON file with serialized read-modify-write; `empty()` is the content before the first write.
export function jsonStore(file, empty) {
  const read = () => fsp.readFile(file, 'utf8').then(JSON.parse, e => (e.code === 'ENOENT' ? empty() : Promise.reject(e)));
  let chain = Promise.resolve();
  // Serialize read-modify-write so concurrent requests cannot drop each other's changes.
  const mutate = fn => {
    const run = chain.then(async () => {
      const db = await read();
      const result = await fn(db);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(`${file}.tmp`, JSON.stringify(db, null, 2), { mode: 0o600 });
      await fsp.rename(`${file}.tmp`, file);
      return result;
    });
    chain = run.catch(() => {});
    return run;
  };
  return { read, mutate };
}
export const authStore = dataDir => jsonStore(path.join(dataDir, 'auth.json'), () => ({ settings: { registration: true }, users: [], shares: [] }));

// shortcut: sessions live in memory, so a server restart signs everyone out; persist them if that becomes a nuisance.
const sessions = new Map();
const SESSION_MS = 7 * 24 * 3600 * 1000;
export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { userId, expires: Date.now() + SESSION_MS });
  return token;
}
export function sessionUserId(cookieHeader) {
  const token = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(cookieHeader ?? '')?.[1];
  const s = token && sessions.get(token);
  if (!s || s.expires < Date.now()) return token && sessions.delete(token) && null;
  return s.userId;
}
export const endSession = cookieHeader => sessions.delete(/(?:^|;\s*)sid=([a-f0-9]{64})/.exec(cookieHeader ?? '')?.[1]);
export const endUserSessions = userId => { for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t); };
export const sessionCookie = token => `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? SESSION_MS / 1000 : 0}`;

// Brute-force brake: 5 wrong passwords lock that username for a minute.
const failures = new Map();
export const loginLocked = username => (failures.get(username)?.until ?? 0) > Date.now();
export function loginFailed(username) {
  const f = failures.get(username) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= 5) Object.assign(f, { count: 0, until: Date.now() + 60_000 });
  failures.set(username, f);
}
export const loginOk = username => failures.delete(username);
