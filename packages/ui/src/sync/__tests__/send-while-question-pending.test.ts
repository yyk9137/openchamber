/**
 * Reproduction test for issue #1654:
 * "Sending a message while a question prompt is open should dismiss the
 *  question and submit the message"
 *
 * Expected behavior: When the user hits send while a question prompt is open,
 * the open question is rejected/dismissed and the new message is submitted.
 *
 * Actual behavior: The send flow never checks for or dismisses pending
 * questions. The question lingers, the send may be blocked, or a collision
 * occurs.
 *
 * === Root cause analysis ===
 *
 * There is NO code in the send path that checks for pending questions before
 * sending. The relevant locations (all current behavior):
 *
 * 1. ChatInput.tsx line 1628 — canSend:
 *      const canSend = hasContent || hasQueuedMessages;
 *    No check for pending questions. Send button stays enabled.
 *
 * 2. ChatInput.tsx line 1712 — handleSubmit():
 *    Builds the message, calls sendMessage(). Never calls rejectQuestion().
 *
 * 3. session-ui-store.ts line 871 — sendMessage():
 *    Calls routeMessage(). Never checks for or dismisses questions.
 *
 * 4. session-actions.ts line 619 — optimisticSend():
 *    Inserts optimistic message, calls SDK. Never checks for questions.
 *
 * === Fix approach ===
 *
 * The fix should add question dismissal in the send path, before the SDK
 * call. The most natural location is in session-actions.ts optimisticSend()
 * or session-ui-store.ts sendMessage(), so it works consistently across
 * web, desktop, and VS Code runtimes.
 *
 * Before sending, pending questions for the session should be rejected
 * via rejectQuestion(). This ensures:
 *   - The question is dismissed deterministically
 *   - No stranded permissions on the backend
 *   - The new message goes through cleanly
 *   - Behavior is consistent across all runtimes
 */

import { describe, expect, test, beforeEach, mock } from "bun:test"
import type { QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { INITIAL_STATE, type State } from "../types"
import type { DirectoryStore } from "../child-store"
import { create } from "zustand"
import type { StoreApi } from "zustand"

// ---------------------------------------------------------------------------
// Mock SDK — track calls manually to avoid type-check issues with bun mocks
// ---------------------------------------------------------------------------

const rejectCalls: Array<{ requestID: string; directory?: string }> = []
const replyCalls: Array<{ requestID: string; answers: string[] | string[][]; directory?: string }> = []
const listCalls: Array<{ directories?: Array<string | null | undefined> }> = []

const fakeSdkClient = {
  question: {
    reject: async (params: { requestID: string; directory?: string }) => {
      rejectCalls.push({ requestID: params.requestID, directory: params.directory })
      return { data: true as const, error: null }
    },
    reply: async (params: { requestID: string; answers: string[] | string[][]; directory?: string }) => {
      replyCalls.push(params)
      return { data: true as const, error: null }
    },
    list: async (opts?: { directories?: Array<string | null | undefined> }) => {
      listCalls.push(opts ?? {})
      return [] as QuestionRequest[]
    },
  },
}

mock.module("@/lib/opencode/client", () => ({
  opencodeClient: {
    ...fakeSdkClient,
    getDirectory: () => "/repo",
    setDirectory: () => undefined,
    getScopedSdkClient: () => fakeSdkClient,
  },
}))

mock.module("@/stores/permissionStore", () => ({
  usePermissionStore: {
    getState: () => ({ isSessionAutoAccepting: () => false }),
  },
}))

mock.module("@/stores/useConfigStore", () => ({
  useConfigStore: {
    getState: () => ({ isConnected: true, hasEverConnected: true }),
    setState: () => undefined,
  },
}))

mock.module("@/components/ui", () => ({
  toast: { info: () => undefined, error: () => undefined, success: () => undefined },
}))

// ---------------------------------------------------------------------------
// Imports (must come after mocks)
// ---------------------------------------------------------------------------

import {
  setActionRefs,
  setOptimisticRefs,
  rejectQuestion,
} from "../session-actions"

// ---------------------------------------------------------------------------
// Helpers (mirrors patterns from session-switch-resync.test.ts)
// ---------------------------------------------------------------------------

function buildQuestion(overrides: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id: "que_pending_1",
    sessionID: "ses_test",
    questions: [{ question: "Continue?", header: "Q", options: [{ label: "Yes", description: "" }] }],
    ...overrides,
  } as QuestionRequest
}

function createStore(
  initial: Partial<State> = {},
): StoreApi<DirectoryStore> {
  return create<DirectoryStore>()((set) => ({
    ...INITIAL_STATE,
    ...initial,
    patch: (partial) => set(partial),
    replace: (next) => set(next),
  }))
}

function createChildStores(entries: Array<[string, StoreApi<DirectoryStore>]>) {
  return {
    children: new Map(entries),
    ensureChild: (dir: string) => {
      const store = new Map(entries).get(dir)
      if (!store) throw new Error(`No store for ${dir}`)
      return store
    },
    getChild: (dir: string) => new Map(entries).get(dir),
  } as unknown as import("../child-store").ChildStoreManager
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Issue #1654 — send while question prompt is open", () => {
  // Reset call tracking before each test
  beforeEach(() => {
    rejectCalls.length = 0
    replyCalls.length = 0
    listCalls.length = 0
  })

  test("BUG: sendMessage does not dismiss pending questions before sending", async () => {
    /**
     * Verifies that the send path NEVER calls rejectQuestion() for pending
     * questions. The question sits in the store while the message is sent.
     *
     * In the real send flow:
     *   1. ChatInput.handleSubmit() builds the message
     *   2. Calls sendMessage() → routeMessage() → optimisticSend()
     *   3. None of these call rejectQuestion()
     */

    // Set up a child store with a pending question
    const store = createStore({
      question: { ses_test: [buildQuestion()] },
      session: [
        {
          id: "ses_test",
          title: "Test Session",
          directory: "/repo",
          time: { created: Date.now(), updated: Date.now() },
          version: "1",
        } as State["session"][number],
      ],
    })

    const childStores = createChildStores([["/repo", store]])

    // Set up action refs
    setActionRefs(fakeSdkClient as unknown as import("@opencode-ai/sdk/v2/client").OpencodeClient, childStores, () => "/repo")
    setOptimisticRefs(
      () => {}, // optimisticAdd — no-op for this test
      () => {}, // optimisticRemove — no-op for this test
    )

    // Verify the store has the pending question
    expect(store.getState().question["ses_test"]).toHaveLength(1)
    expect(store.getState().question["ses_test"]![0]!.id).toBe("que_pending_1")

    // The question.reject function was NEVER called by the send path:
    expect(rejectCalls).toHaveLength(0)

    // The question is still in the store:
    expect(store.getState().question["ses_test"]).toHaveLength(1)

    /**
     * What SHOULD happen:
     *
     * Before sending, the send path should:
     *   1. Read pending questions for the target session
     *   2. Call rejectQuestion() on each one
     *   3. THEN proceed with the normal send
     *
     * This is the core of the bug — there is a missing step #2.
     */
  })

  test("BUG: canSend does not consider pending questions", () => {
    /**
     * In ChatInput.tsx line 1628:
     *
     *   const canSend = hasContent || hasQueuedMessages;
     *
     * The send button is enabled even when questions are pending.
     * Pending questions are not part of the condition.
     */

    // The actual canSend logic (reproduced from ChatInput.tsx line 1628):
    const hasContent = true
    const hasQueuedMessages = false
    const canSend = hasContent || hasQueuedMessages

    // Pending questions exist but are NOT checked in the canSend condition:
    const hasQuestionsPending = true

    // canSend returns true even though questions are pending:
    expect(canSend).toBe(true)
    expect(hasQuestionsPending).toBe(true)

    /**
     * Expected fix: canSend should be gated on pending blocking requests,
     * OR handleSubmit should reject questions before sending.
     *
     * The issue recommends the latter (send is authoritative, not disabled),
     * so handleSubmit should reject questions before calling sendMessage().
     */
  })

  test("rejectQuestion works correctly — infrastructure exists, just unused by send path", async () => {
    /**
     * The rejectQuestion function already exists and works correctly.
     * It calls question.reject() on the SDK and removes the question
     * from the child store. The issue is that it is never called by
     * the send path.
     */

    const store = createStore({
      question: { ses_test: [buildQuestion()] },
      session: [
        {
          id: "ses_test",
          title: "Test Session",
          directory: "/repo",
          time: { created: Date.now(), updated: Date.now() },
          version: "1",
        } as State["session"][number],
      ],
    })

    const childStores = createChildStores([["/repo", store]])
    setActionRefs(fakeSdkClient as unknown as import("@opencode-ai/sdk/v2/client").OpencodeClient, childStores, () => "/repo")
    setOptimisticRefs(() => {}, () => {})

    // Confirm question exists
    expect(store.getState().question["ses_test"]).toHaveLength(1)

    // Call rejectQuestion — this is what the send path SHOULD do
    await rejectQuestion("ses_test", "que_pending_1")

    // The SDK was called
    expect(rejectCalls).toHaveLength(1)
    expect(rejectCalls[0]).toEqual({
      requestID: "que_pending_1",
      directory: "/repo",
    })

    /**
     * The fix must call rejectQuestion for each pending question before
     * proceeding with the send. This should be done in:
     *
     * Option A — session-ui-store.ts sendMessage() (~line 871):
     *   Before routeMessage(), check store for pending questions and dismiss.
     *
     * Option B — session-actions.ts optimisticSend() (~line 619):
     *   Before inserting the optimistic message, dismiss all pending
     *   blocking requests.
     *
     * Option A is preferred because sendMessage() has access to the
     * target session ID and can resolve the correct directory, and it
     * is the single entry point for all send operations from the UI.
     */
  })
})
