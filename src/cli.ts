#!/usr/bin/env node
/**
 * CLI entry-point for `@orboto/mail-mcp` (OMS-11).
 *
 * Boots the MCP server over stdio so an MCP client (Claude Code,
 * Cursor, etc.) can spawn it as a child process and communicate via
 * JSON-RPC over stdin/stdout.
 *
 * Auth resolution order:
 *   1. `--api-key <value>` flag (highest priority — overrides env)
 *   2. `OMS_API_KEY` environment variable
 *
 * Base URL resolution order:
 *   1. `--base-url <value>` flag
 *   2. `OMS_BASE_URL` environment variable
 *   3. Production default: https://mail.orboto.io/api
 *
 * Boot diagnostics go to stderr (stdout is reserved for the MCP
 * JSON-RPC protocol stream).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './index.js';

interface ParsedArgs {
  apiKey?: string;
  baseUrl?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api-key' && argv[i + 1]) {
      out.apiKey = argv[i + 1];
      i++;
    } else if (a.startsWith('--api-key=')) {
      out.apiKey = a.slice('--api-key='.length);
    } else if (a === '--base-url' && argv[i + 1]) {
      out.baseUrl = argv[i + 1];
      i++;
    } else if (a.startsWith('--base-url=')) {
      out.baseUrl = a.slice('--base-url='.length);
    } else if (a === '--help' || a === '-h') {
      process.stderr.write(
        [
          '@orboto/mail-mcp — MCP server for the Orboto Mail Service',
          '',
          'Usage:',
          '  orboto-mail-mcp [--api-key <key>] [--base-url <url>]',
          '',
          'Auth (or set OMS_API_KEY env):',
          '  --api-key <oms_live_… | oms_test_…>',
          '',
          'Base URL (or set OMS_BASE_URL env, default https://mail.orboto.io/api):',
          '  --base-url https://mail.orboto.io/api',
          '',
          'Boots an MCP server over stdio. Register it with your MCP client',
          '(Claude Code, Cursor, …) per the client\'s mcp-server-config syntax.',
        ].join('\n') + '\n',
      );
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const apiKey = flags.apiKey ?? process.env.OMS_API_KEY;
  const baseUrl = flags.baseUrl ?? process.env.OMS_BASE_URL;

  if (!apiKey) {
    process.stderr.write(
      '@orboto/mail-mcp: OMS_API_KEY is required. Set the env var or pass --api-key.\n',
    );
    process.exit(2);
  }

  const server = createServer({ apiKey, baseUrl });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // No console.log here — stdout is the JSON-RPC stream.
}

main().catch((err) => {
  process.stderr.write(
    `@orboto/mail-mcp: fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
