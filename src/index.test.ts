/**
 * Placeholder MCP package — smoke test only. Real MCP-protocol tests
 * land in OMS-11 when the server is implemented.
 */
import { describe, expect, it } from 'vitest';

import { PLACEHOLDER } from './index.js';

describe('@orboto/mail-mcp placeholder', () => {
  it('exports the placeholder marker so the package builds + ships', () => {
    expect(PLACEHOLDER).toBe(true);
  });
});
