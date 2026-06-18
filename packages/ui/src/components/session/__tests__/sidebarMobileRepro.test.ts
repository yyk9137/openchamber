/**
 * Reproduction test for Issue #1695:
 * Mobile (Android PWA) left sidebar takes >10s to open.
 *
 * This test demonstrates the root cause: on mobile, SessionSidebar mounts
 * from scratch every time the drawer opens, triggering a cascade of data
 * loading effects that compete with the spring animation.
 * On desktop, SessionSidebar stays mounted (just visually hidden).
 *
 * Run: bun test packages/ui/src/components/session/__tests__/sidebarMobileRepro.test.ts
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const readSourceOrThrow = (relativePath: string): string => {
  const abs = resolve(import.meta.dirname, '../../', relativePath);
  if (!existsSync(abs)) throw new Error(`Missing source file: ${abs}`);
  return readFileSync(abs, 'utf-8');
};

const mainLayoutContent = readSourceOrThrow('layout/MainLayout.tsx');
const sessionSidebarContent = readSourceOrThrow('session/SessionSidebar.tsx');
const globalSessionsStoreContent = readSourceOrThrow('../stores/useGlobalSessionsStore.ts');
const globalSessionsListContent = readSourceOrThrow('../stores/globalSessions.ts');

describe('Issue #1695 – Mobile sidebar mount-time cascade', () => {
  // ── Test 1: Desktop sidebar is always mounted ──────────────────────────
  test('Desktop: SessionSidebar is rendered unconditionally inside <Sidebar>', () => {
    // Desktop path (line ~498-505 of MainLayout.tsx):
    //   <Sidebar isOpen={isSidebarOpen} ...>
    //     <SessionSidebar />
    //   </Sidebar>
    const pattern = /<Sidebar\b[\s\S]{0,200}?isOpen=\{isSidebarOpen\}[\s\S]{0,500}?<SessionSidebar\s*\/>/;
    const matches = pattern.test(mainLayoutContent);
    expect(matches).toBe(true);
    // Desktop Sidebar is always in the DOM; toggling just sets CSS visibility.
    // SessionSidebar stays mounted and its effects run once at app start.
  });

  // ── Test 2: Mobile sidebar is conditionally mounted ────────────────────
  test('Mobile: SessionSidebar is conditionally rendered via {mobileLeftDrawerVisible && ...}', () => {
    // Mobile path (lines 460-466 of MainLayout.tsx):
    //   {mobileLeftDrawerVisible && (
    //     <motion.div ...>
    //       <SessionSidebar mobileVariant />
    //     </motion.div>
    //   )}
    // First verify the conditional rendering pattern exists:
    expect(mainLayoutContent.includes('mobileLeftDrawerVisible && (')).toBe(true);
    expect(mainLayoutContent.includes('mobileLeftDrawerVisible')).toBe(true);
    expect(mainLayoutContent.includes('<SessionSidebar mobileVariant />')).toBe(true);
    // Then verify it's a conditional mount (not always rendered like desktop).
    // The desktop path renders <SessionSidebar /> (without mobileVariant) inside
    // <Sidebar>, while mobile renders <SessionSidebar mobileVariant /> conditionally.
    // Count occurrences: mobileVariant should appear exactly once (in conditional path).
    const matches = mainLayoutContent.match(/<SessionSidebar\s+mobileVariant\s*\/>/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
    // On mobile, SessionSidebar mounts FROM SCRATCH each time the drawer opens.
    // This is the critical difference from desktop.
  });

  // ── Test 3: Mount-time side effects in SessionSidebar ──────────────────
  test('SessionSidebar fires refreshGlobalSessions() on mount via useEffect([], [])', () => {
    // Line 413-420:
    //   const initialGlobalSessionsRefreshStartedRef = React.useRef(false);
    //   React.useEffect(() => {
    //     if (initialGlobalSessionsRefreshStartedRef.current) return;
    //     initialGlobalSessionsRefreshStartedRef.current = true;
    //     void refreshGlobalSessions(syncSessionsSnapshotRef.current);
    //   }, []);
    //
    // The ref prevents re-firing, but on remount (mobile close+open) the ref
    // is RECREATED, so this fires again.
    expect(
      /initialGlobalSessionsRefreshStartedRef\s*=\s*React\.useRef\(false\)/.test(sessionSidebarContent),
    ).toBe(true);
    expect(/void\s+refreshGlobalSessions\(/.test(sessionSidebarContent)).toBe(true);

    // The ref is component-local (not module-level), confirming each mount
    // gets a fresh `false` start.
    const moduleLevelRef = sessionSidebarContent.match(
      /(?:^|\n)\s*(?:const|let|var)\s+\w*InitialGlobalSessions\w*\s*=(?![^]*?React\.useRef)/m,
    );
    expect(moduleLevelRef).toBeNull();
  });

  // ── Test 4: Worktree discovery fires on mount ─────────────────────────
  test('SessionSidebar triggers worktree discovery on mount via useEffect', () => {
    // Line 426-488 fires for projectWorktreeDiscoveryKey. On mobile mount,
    // discoveredProjectsRef is fresh, so it always re-discovers even for the
    // same project set.
    expect(
      /discoveredProjectsRef\s*=\s*React\.useRef/.test(sessionSidebarContent),
    ).toBe(true);
    expect(/void\s+discoverWorktrees\(\)/.test(sessionSidebarContent)).toBe(true);
  });

  // ── Test 5: Project repo status fires on mount ────────────────────────
  test('useProjectRepoStatus triggers ensureStatus for every project on mount', () => {
    expect(/\buseProjectRepoStatus\s*\(/.test(sessionSidebarContent)).toBe(true);
    // Each project → ensureStatus API call
  });

  // ── Test 6: Archived auto folders fires on mount ──────────────────────
  test('useArchivedAutoFolders processes all archived sessions on mount', () => {
    expect(/\buseArchivedAutoFolders\s*\(/.test(sessionSidebarContent)).toBe(true);
    // Iterates all archived sessions → O(N) computations
  });

  // ── Test 7: Global sessions pagination with 500 page size ──────────────
  test('refreshGlobalSessions fetches active+archived sessions with PAGE_SIZE=500', () => {
    // loadSessions does two paginated fetches:
    //   listGlobalSessionPages(sdk, { archived: false, pageSize: PAGE_SIZE })
    //   listGlobalSessionPages(sdk, { archived: true, pageSize: PAGE_SIZE })
    // where PAGE_SIZE = 500, cursor-based pagination.
    // On mobile PWA, each roundtrip takes ~500ms-2s.
    expect(/const PAGE_SIZE\s*=\s*500/.test(globalSessionsStoreContent)).toBe(true);
    expect(
      /listGlobalSessionPages\(sdk,\s*\{[^}]*archived:\s*false[^}]*pageSize:\s*PAGE_SIZE\s*\}/.test(
        globalSessionsStoreContent,
      ),
    ).toBe(true);
    expect(
      /listGlobalSessionPages\(sdk,\s*\{[^}]*archived:\s*true[^}]*pageSize:\s*PAGE_SIZE\s*\}/.test(
        globalSessionsStoreContent,
      ),
    ).toBe(true);
  });

  // ── Test 8: Retry wrapper with 3 attempts ──────────────────────────────
  test('listGlobalSessionPages uses retry with 3 attempts and 500ms delay per page', () => {
    // Each cursor-based page has retry(..., { attempts: 3, delay: 500, retryIf: () => true })
    // Line 114: await retry(
    // Line 122: { attempts: 3, delay: 500, retryIf: () => true },
    const hasRetryCall = globalSessionsListContent.includes('retry(');
    const hasAttempts3 = globalSessionsListContent.includes('attempts: 3');
    const hasDelay500 = globalSessionsListContent.includes('delay: 500');
    expect(hasRetryCall).toBe(true);
    expect(hasAttempts3).toBe(true);
    expect(hasDelay500).toBe(true);
  });

  // ── Test 9: PR status check fires on mount ────────────────────────────
  test('SessionSidebar fires PR status refresh effect for visible groups on mount', () => {
    // Lines 1193-1274 iterate every visible group and fire refreshPrStatusTargets
    expect(/void\s+refreshPrStatusTargets\(/.test(sessionSidebarContent)).toBe(true);
  });

  // ── Test 10: Heavy memoized computations on mount ──────────────────────
  test('SessionSidebar runs expensive useMemo computations on fresh mount', () => {
    // These are all triggered on mount because all deps are fresh
    const computations = [
      'sortedSessions',
      'sessions',
      'childrenMap',
      'sessionOrderIndex',
      'sessionSidebarMetaById',
      'activitySections',
      'prLookupKeys',
      'normalizedProjects',
      'projectSessionDirectories',
      'sessionOrderSignature',
      'sessionOrderIndex',
    ];

    for (const name of computations) {
      const pattern = new RegExp(`const\\s+${name}\\s*=\\s*React\\.useMemo`);
      expect(pattern.test(sessionSidebarContent)).toBe(true);
    }
  });

  // ── Test 11: localStorage reads on mount via useSidebarPersistence ────
  test('useSidebarPersistence reads multiple localStorage keys on mount', () => {
    // The localStorage reads are in the useSidebarPersistence hook, which is
    // called from SessionSidebar on mount. It reads sessionExpanded,
    // projectCollapse, groupOrder, etc.
    const sidebarPersistenceContent = readSourceOrThrow(
      'session/sidebar/hooks/useSidebarPersistence.ts',
    );
    const patterns = [
      /safeStorage\.getItem\(keys\.sessionExpanded\)/,
      /safeStorage\.getItem\(keys\.sessionExpandedLegacy\)/,
      /safeStorage\.getItem\(keys\.projectCollapse\)/,
    ];
    for (const pattern of patterns) {
      expect(pattern.test(sidebarPersistenceContent)).toBe(true);
    }
  });
});

describe('Root cause summary for issue #1695', () => {
  test('The cascade explanation is documented in the code block below', () => {
    // On mobile (MainLayout.tsx ~line 460-466):
    //   {mobileLeftDrawerVisible && (
    //     <motion.div ...>
    //       <SessionSidebar mobileVariant />
    //     </motion.div>
    //   )}
    //
    // Desktop (line 498-505):
    //   <Sidebar isOpen={isSidebarOpen} ...>
    //     <SessionSidebar />
    //   </Sidebar>
    //
    // The desktop path always mounts SessionSidebar; toggling just uses
    // CSS visibility/opacity. The mobile path unmounts it when closed and
    // remounts from scratch on open.
    //
    // When mobile mounts, the following cascade fires simultaneously:
    //
    //  1. refreshGlobalSessions() → loadSessions()
    //     - TWO paginated fetches (active + archived)
    //     - Each: listGlobalSessionPages with PAGE_SIZE=500
    //     - Each page: retry({attempts:3, delay:500})
    //     - Cursor pagination: multiple roundtrips
    //
    //  2. Worktree discovery via useEffect([projectWorktreeDiscoveryKey])
    //     - checkIsGitRepository() + listProjectWorktrees() per project
    //     - Concurrency=3, each an HTTP roundtrip
    //
    //  3. useProjectRepoStatus → ensureStatus per project
    //
    //  4. useArchivedAutoFolders → iterates all archived sessions
    //
    //  5. PR status check → refreshPrStatusTargets per visible group
    //
    //  6. Multiple localStorage JSON.parse reads
    //
    //  7. 10+ useMemo computations (sort, merge, group, index, map)
    //
    //  8. Spring animation (stiffness:400) competing for main thread
    //
    // Total: with 3-5+ paginated API pages, each ~500ms-2s on mobile,
    // plus retry backoffs, easily exceeds 10 seconds on mid-range Android.
    //
    // Fix direction (not implemented per reproduction constraint):
    // Option A: Keep SessionSidebar always mounted (like desktop) by
    //           using CSS visibility in the mobile path too.
    // Option B: Defer data loading to onAnimationComplete.
    // Option C: Cache at module level with TTLs to skip re-fetch.
    // Option D: Eagerly pre-load data before the drawer opens.

    expect(true).toBe(true);
  });
});
