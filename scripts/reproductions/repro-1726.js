/**
 * Reproduction script for issue #1726
 * 
 * Tests: Session loading performance, normalizePath overhead, 
 * event routing scan performance - all areas that could contribute
 * to "dialogue content loads slowly" and "initiated dialogue shows no response"
 * on Windows.
 */

// Simulate normalizePath from useGlobalSessionsStore.ts
const normalizePath = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const replaced = trimmed.replace(/\\/g, '/');
  if (replaced === '/') return '/';
  return replaced.length > 1 ? replaced.replace(/\/+$/, '') : replaced;
};

// Simulate normalizeEventDirectory from sync-context.tsx
const normalizeEventDirectory = (rawDirectory) => {
  if (!rawDirectory || rawDirectory === "global") return rawDirectory;
  const normalized = rawDirectory.replace(/\\/g, "/").replace(/^([a-z]):/, (_, l) => l.toUpperCase() + ":");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
};

// Simulate resolveGlobalSessionDirectory
const resolveGlobalSessionDirectory = (session) => {
  return normalizePath(session.directory ?? null)
    ?? normalizePath(session.project?.worktree ?? null);
};

// Simulate getSessionSignature
const getSessionSignature = (session) => {
  return [
    session.id,
    session.title ?? '',
    session.time?.created ?? 0,
    session.time?.updated ?? 0,
    session.time?.archived ?? 0,
    session.share?.url ?? '',
    JSON.stringify(session.metadata ?? null),
    resolveGlobalSessionDirectory(session) ?? '',
  ].join(':');
};

// Simulate sameSessionList
const sameSessionList = (prev, next) => {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let index = 0; index < prev.length; index += 1) {
    if (getSessionSignature(prev[index]) !== getSessionSignature(next[index])) return false;
  }
  return true;
};

// Simulate findSessionInChildStores
const findSessionInChildStores = (sessionID, childStores) => {
  for (const [dir, store] of childStores) {
    const state = store();
    if (
      state.session.some((s) => s.id === sessionID)
      || Object.prototype.hasOwnProperty.call(state.message, sessionID)
      || Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionID)
    ) {
      return dir;
    }
  }
  return null;
};

// Generate mock sessions with Windows-style paths
function generateMockSessions(count, dirCount) {
  const sessions = [];
  for (let i = 0; i < count; i++) {
    const dirIndex = i % dirCount;
    const session = {
      id: `ses_${String(i).padStart(8, '0')}`,
      title: `Session ${i}`,
      directory: `C:\\Users\\testuser\\projects\\project${dirIndex}\\${i % 10 > 5 ? 'subdir' : ''}`,
      time: { created: Date.now() - i * 1000, updated: Date.now() - i * 500 },
      metadata: { test: true },
      share: { url: '' },
    };
    sessions.push(session);
  }
  return sessions;
}

// Benchmark: normalizePath on 500 sessions
console.log('=== Benchmark 1: normalizePath on 500 sessions ===');
const sessions500 = generateMockSessions(500, 10);
const iterations = 1000;
let t1 = performance.now();
for (let iter = 0; iter < iterations; iter++) {
  for (const session of sessions500) {
    resolveGlobalSessionDirectory(session);
  }
}
let t2 = performance.now();
console.log(`  ${iterations * sessions500.length} calls in ${(t2 - t1).toFixed(2)}ms`);
console.log(`  Avg: ${((t2 - t1) / (iterations * sessions500.length) * 1e6).toFixed(2)}ns per call`);

// Benchmark: getSessionSignature on 500 sessions
console.log('\n=== Benchmark 2: getSessionSignature on 500 sessions ===');
t1 = performance.now();
for (let iter = 0; iter < iterations; iter++) {
  for (const session of sessions500) {
    getSessionSignature(session);
  }
}
t2 = performance.now();
console.log(`  ${iterations * sessions500.length} calls in ${(t2 - t1).toFixed(2)}ms`);
console.log(`  Avg: ${((t2 - t1) / (iterations * sessions500.length) * 1e6).toFixed(2)}ns per call`);

// Benchmark: sameSessionList comparison
console.log('\n=== Benchmark 3: sameSessionList on 500 sessions ===');
t1 = performance.now();
for (let iter = 0; iter < 100; iter++) {
  sameSessionList(sessions500, sessions500);
}
t2 = performance.now();
console.log(`  100 comparisons in ${(t2 - t1).toFixed(2)}ms`);

// Benchmark: Session sorting
console.log('\n=== Benchmark 4: sortSessionsByUpdated on 500 sessions ===');
const sortSessionsByUpdated = (sessions) => {
  return [...sessions].sort((left, right) => {
    const timeDelta = (right.time?.updated ?? right.time?.created ?? 0) - (left.time?.updated ?? left.time?.created ?? 0);
    if (timeDelta !== 0) return timeDelta;
    return right.id.localeCompare(left.id);
  });
};
t1 = performance.now();
for (let iter = 0; iter < 100; iter++) {
  sortSessionsByUpdated(sessions500);
}
t2 = performance.now();
console.log(`  100 sorts in ${(t2 - t1).toFixed(2)}ms`);

// Benchmark: UPSERT session into list of 500
console.log('\n=== Benchmark 5: upsertSessionIntoList on 500 sessions ===');
const upsertSessionIntoList = (sessions, session) => {
  const index = sessions.findIndex((candidate) => candidate.id === session.id);
  if (index === -1) {
    return [session, ...sessions];
  }
  const next = [...sessions];
  next[index] = session;
  return next;
};
const newSession = generateMockSessions(1, 1)[0];
newSession.id = 'ses_new_one';
t1 = performance.now();
for (let iter = 0; iter < 1000; iter++) {
  upsertSessionIntoList(sessions500, newSession);
}
t2 = performance.now();
console.log(`  1000 inserts in ${(t2 - t1).toFixed(2)}ms`);

// Benchmark: findSessionInChildStores with various store counts
console.log('\n=== Benchmark 6: findSessionInChildStores scan ===');
for (const storeCount of [1, 5, 10, 20, 50]) {
  const stores = new Map();
  for (let d = 0; d < storeCount; d++) {
    const dir = `C:\\Users\\testuser\\projects\\dir${d}`;
    const sessions = generateMockSessions(30, 1).map(s => ({...s, directory: dir}));
    stores.set(normalizePath(dir), () => ({
      session: sessions,
      message: {},
      session_status: {},
    }));
  }
  
  // Target is in the LAST store
  const targetDir = [...stores.keys()][storeCount - 1];
  const targetSessionID = stores.get(targetDir)().session[5].id;
  
  t1 = performance.now();
  for (let iter = 0; iter < 100; iter++) {
    findSessionInChildStores(targetSessionID, stores);
  }
  t2 = performance.now();
  console.log(`  ${storeCount} stores x 30 sessions: ${(t2 - t1).toFixed(2)}ms for 100 scans`);
}

// Benchmark: normalizing 500 Windows paths
console.log('\n=== Benchmark 7: normalizeEventDirectory with Windows paths ===');
const windowsPaths = [];
for (let i = 0; i < 500; i++) {
  windowsPaths.push(`C:\\Users\\testuser\\projects\\project${i % 20}\\subdir\\deep\\path\\file${i}.ts`);
}
t1 = performance.now();
for (let iter = 0; iter < 100; iter++) {
  for (const path of windowsPaths) {
    normalizeEventDirectory(path);
  }
}
t2 = performance.now();
console.log(`  ${100 * 500} normalizations in ${(t2 - t1).toFixed(2)}ms`);

// Simulate loading sessions via listGlobalSessionPages with multiple pages
console.log('\n=== Benchmark 8: Simulated paginated session loading ===');
const simulatePaginatedLoad = async (totalSessions, pageSize) => {
  const allSessions = generateMockSessions(totalSessions, 10);
  const loaded = [];
  let cursor = 0;
  let pages = 0;
  
  while (cursor < totalSessions) {
    pages++;
    const page = allSessions.slice(cursor, cursor + pageSize);
    for (const session of page) {
      if (!loaded.find(s => s.id === session.id)) {
        loaded.push(session);
      }
    }
    cursor += pageSize;
    // Simulate async delay of local API call
    await new Promise(r => setTimeout(r, 1));
  }
  return { loaded, pages };
};

const results = await Promise.all([
  simulatePaginatedLoad(100, 50),
  simulatePaginatedLoad(500, 50),
  simulatePaginatedLoad(500, 500),
  simulatePaginatedLoad(1000, 500),
]);

console.log(`  100 sessions, pageSize 50: ${results[0].pages} pages`);
console.log(`  500 sessions, pageSize 50: ${results[1].pages} pages`);
console.log(`  500 sessions, pageSize 500: ${results[2].pages} pages (1 page)`);
console.log(`  1000 sessions, pageSize 500: ${results[3].pages} pages`);

// Summary benchmarks (run inside Node.js to show actual wall clock)
console.log('\n=== Summary ===');
console.log('All measurements are in milliseconds for the desktop runtime on this machine.');
console.log('On Windows, these operations may be 2-5x slower due to:');
console.log('  - Antivirus scanning of file/sync operations');
console.log('  - Power-saving features interrupting network/sse streams');
console.log('  - Slower disk I/O for cached state reads');
console.log('  - Frameless window rendering overhead (frame: false on Windows)');
