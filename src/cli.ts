#!/usr/bin/env node
/**
 * CLI entry-point for the `orboto-mail-mcp` MCP server.
 *
 * Placeholder — OMS-11 implements the real MCP-protocol server. For
 * now, calling this binary exits with a clear "not yet implemented"
 * message + a pointer to the ticket. The npm package + binary alias
 * exist now so that the npm-registry slot is reserved and downstream
 * tooling (Claude Code MCP-server registration) can stub against the
 * future entry point without breaking when it lands.
 */

// eslint-disable-next-line no-console
console.error(
  '@orboto/mail-mcp: this package is a placeholder. The MCP server lands in OMS-11.\n' +
    'For now, use the @orboto/mail SDK directly:\n' +
    '  https://github.com/orboto/orboto-mail-service/tree/develop/packages/sdk',
);
process.exit(1);
