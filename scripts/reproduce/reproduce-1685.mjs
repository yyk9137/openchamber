#!/usr/bin/env node
/**
 * Reproduction script for issue #1685
 *
 * Bug: OpenChamber hard-codes "opencode" as the username in Basic auth headers
 *      when connecting to an OpenCode server, ignoring the OPENCODE_SERVER_USERNAME
 *      environment variable.
 *
 * Files affected:
 *   - packages/web/server/lib/opencode/auth-state-runtime.js (line 54)
 *   - packages/vscode/src/opencode.ts (line 76)
 */

// Simulate what auth-state-runtime.js does
function getOpenCodeAuthHeaders_bug(password) {
  // BUG: hard-codes 'opencode' as username, ignoring OPENCODE_SERVER_USERNAME
  const credentials = Buffer.from(`opencode:${password}`).toString('base64');
  return { Authorization: `Basic ${credentials}` };
}

// Simulate the expected/fixed behavior
function getOpenCodeAuthHeaders_fixed(password, username) {
  const user = username || 'opencode'; // fallback for backwards compat
  const credentials = Buffer.from(`${user}:${password}`).toString('base64');
  return { Authorization: `Basic ${credentials}` };
}

// Test
const CUSTOM_USERNAME = 'myadmin';
const PASSWORD = 'supersecret123';

console.log('=== Reproduction: Issue #1685 ===');
console.log();

console.log('Scenario: OPENCODE_SERVER_USERNAME=myadmin, OPENCODE_SERVER_PASSWORD=supersecret123');
console.log();

// Current behavior
const bugHeaders = getOpenCodeAuthHeaders_bug(PASSWORD);
const bugDecoded = Buffer.from(bugHeaders.Authorization.replace('Basic ', ''), 'base64').toString('utf8');
console.log('CURRENT (buggy) behavior:');
console.log(`  Auth header: ${bugHeaders.Authorization}`);
console.log(`  Decoded: ${bugDecoded}`);
console.log(`  Username used: "${bugDecoded.split(':')[0]}" (hard-coded, ignoring OPENCODE_SERVER_USERNAME)`);
console.log(`  Expected username: "${CUSTOM_USERNAME}"`);
const bugMatch = bugDecoded === `opencode:${PASSWORD}`;
console.log(`  Bug confirmed: ${bugMatch ? 'YES' : 'NO'} - username is always "opencode"`);
console.log();

// Expected behavior
const fixedHeaders = getOpenCodeAuthHeaders_fixed(PASSWORD, CUSTOM_USERNAME);
const fixedDecoded = Buffer.from(fixedHeaders.Authorization.replace('Basic ', ''), 'base64').toString('utf8');
console.log('EXPECTED (fixed) behavior:');
console.log(`  Auth header: ${fixedHeaders.Authorization}`);
console.log(`  Decoded: ${fixedDecoded}`);
console.log(`  Username used: "${fixedDecoded.split(':')[0]}" (from OPENCODE_SERVER_USERNAME)`);
const fixedMatch = fixedDecoded === `${CUSTOM_USERNAME}:${PASSWORD}`;
console.log(`  Fix confirmed: ${fixedMatch ? 'YES' : 'NO'} - username matches OPENCODE_SERVER_USERNAME`);
console.log();

console.log('---');
console.log('Root cause:');
console.log('  packages/web/server/lib/opencode/auth-state-runtime.js line 54:');
console.log('    const credentials = Buffer.from(`opencode:${password}`).toString(\'base64\');');
console.log('  packages/vscode/src/opencode.ts line 76:');
console.log('    return `Basic ${Buffer.from(`opencode:${password}`, \'utf8\').toString(\'base64\')}`;');
console.log();
console.log('Both locations hard-code "opencode" as the username instead of');
console.log('reading OPENCODE_SERVER_USERNAME from the environment.');
