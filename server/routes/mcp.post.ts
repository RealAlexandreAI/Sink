import type { H3Event } from 'h3'
import { z } from 'zod'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { CreateLinkSchema } from '#shared/schemas/link'

/**
 * MCP endpoint for Sink (Streamable HTTP subset used by WebMCP).
 *
 * Auth is inherited from `server/middleware/2.auth.ts`: site-token (root)
 * or Cloudflare Access identity (CF_Authorization cookie / JWT header).
 * Every request to /api/* is authenticated before reaching here.
 *
 * Protocol: JSON-RPC 2.0 over POST, supporting initialize / ping /
 * tools/list / tools/call. Notifications (no `id`) are acknowledged
 * with 202 and no body, matching the MCP streamable-HTTP spec.
 */

const protocolVersion = '2025-06-18'

// ---------------------------------------------------------------------------
// Tool definitions (descriptions are what agents read — keep them precise)
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: 'shorten_url',
    description:
      'Create a new short link. Returns the created link with its short URL, slug, title, and metadata. Fails with 409-equivalent error if the slug already exists (omit slug to auto-generate).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', format: 'uri', description: 'The destination URL (required)' },
        slug: { type: 'string', description: 'Custom slug; auto-generated if omitted' },
        comment: { type: 'string', description: 'Optional comment' },
        title: { type: 'string', description: 'Custom title for link preview' },
        description: { type: 'string', description: 'Custom description for link preview' },
        expiration: { type: 'integer', description: 'Expiration timestamp in unix seconds' },
        password: { type: 'string', description: 'Password protection for the link' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 10 normalized tags, each 1-32 characters',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'search_links',
    description:
      'Search existing short links by keyword (matches slug, URL, comment, or tag), exact URL, tag, or status. At least one of q/url is required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string', description: 'Case-insensitive substring to match against slug, URL, comment, or tag' },
        url: { type: 'string', format: 'uri', description: 'Exact normalized destination URL' },
        tag: { type: 'string', description: 'Exact normalized tag filter' },
        status: { type: 'string', enum: ['active', 'expired', 'all'], description: 'Expiration status filter' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'list_links',
    description:
      'List short links with pagination. Returns { links, cursor, list_complete }. Pass cursor from a previous response to page further.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Max results (default 20)' },
        cursor: { type: 'string', description: 'Pagination cursor from previous response' },
        sort: { type: 'string', enum: ['az', 'za', 'newest', 'oldest'], description: 'Sort order' },
        tag: { type: 'string', description: 'Exact normalized tag filter' },
        status: { type: 'string', enum: ['active', 'expired', 'all'], description: 'Expiration status filter' },
      },
    },
  },
  {
    name: 'get_link',
    description: 'Fetch a single short link by its slug. Returns the link record including its destination URL and metadata.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        slug: { type: 'string', description: 'The short link slug (required)' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'get_link_count',
    description: 'Count short links matching optional keyword, tag, and status filters.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string', description: 'Case-insensitive substring to match against slug, URL, comment, or tag' },
        tag: { type: 'string', description: 'Exact normalized tag filter' },
        status: { type: 'string', enum: ['active', 'expired', 'all'], description: 'Expiration status filter' },
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Argument validation (per-tool, before touching storage)
// ---------------------------------------------------------------------------

const SearchArgsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  url: z.string().trim().url().max(2048).optional(),
  tag: z.string().trim().toLowerCase().min(1).max(32).optional(),
  status: z.enum(['active', 'expired', 'all']).default('active'),
  limit: z.number().int().min(1).max(1000).optional(),
})

const ListArgsSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().trim().max(1024).optional(),
  sort: z.enum(['az', 'za', 'newest', 'oldest']).optional(),
  tag: z.string().trim().toLowerCase().min(1).max(32).optional(),
  status: z.enum(['active', 'expired', 'all']).optional(),
})

const GetLinkArgsSchema = z.object({
  slug: z.string().trim().min(1).max(1024),
})

const CountArgsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  tag: z.string().trim().toLowerCase().min(1).max(32).optional(),
  status: z.enum(['active', 'expired', 'all']).default('active'),
})

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

async function callTool(name: string, args: unknown, event: H3Event): Promise<CallToolResult> {
  switch (name) {
    case 'shorten_url': {
      // CreateLinkSchema fills id/slug/createdAt/updatedAt and validates url.
      const link = CreateLinkSchema.parse(args)
      await prepareIncomingLink(event, link)
      await hashLinkPasswordForCreate(link)
      if (!await createLink(event, link)) {
        throw new McpError(ErrorCode.InvalidRequest, 'Link already exists (slug in use)')
      }
      return textResult(buildLinkResponse(event, link))
    }
    case 'search_links': {
      const query = SearchArgsSchema.parse(args)
      if (!query.q && !query.url)
        return textResult([])
      // LinkSearchItem never carries a password; no sanitization needed.
      return textResult(await searchLinks(event, { ...query, limit: query.limit ?? 20 }))
    }
    case 'list_links': {
      const query = ListArgsSchema.parse(args)
      const list = await listLinks(event, { ...query, limit: query.limit ?? 20 })
      return textResult({ ...list, links: sanitizeLinksPassword(list.links) })
    }
    case 'get_link': {
      const { slug } = GetLinkArgsSchema.parse(args)
      const link = await getLink(event, slug)
      if (!link)
        throw new McpError(ErrorCode.InvalidRequest, `Link not found: ${slug}`)
      return textResult(sanitizeLinksPassword([link])[0])
    }
    case 'get_link_count': {
      const query = CountArgsSchema.parse(args)
      return textResult({ count: await countLinks(event, query) })
    }
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC dispatch
// ---------------------------------------------------------------------------

function jsonError(error: unknown): { error: { code: number, message: string } } {
  if (error instanceof McpError)
    return { error: { code: error.code, message: error.message } }
  if (error instanceof z.ZodError)
    return { error: { code: ErrorCode.InvalidParams, message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') } }
  const message = error instanceof Error ? error.message : String(error)
  return { error: { code: ErrorCode.InternalError, message } }
}

export default eventHandler(async (event) => {
  const raw = await readRawBody(event)
  let body: Record<string, unknown>
  try {
    body = raw ? JSON.parse(raw) : {}
  }
  catch {
    throw createError({ status: 400, statusText: 'Invalid JSON body' })
  }

  const { id, method, params } = body as { id?: unknown, method?: string, params?: unknown }

  // Notifications (no id) are fire-and-forget: ack with 202, no body.
  if (id === undefined) {
    setResponseStatus(event, 202)
    return
  }

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'sink', version: '1.0.0' },
        },
      }
    }

    if (method === 'ping')
      return { jsonrpc: '2.0', id, result: {} }

    if (method === 'tools/list') {
      ListToolsRequestSchema.parse({ method, params: params ?? {} })
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
    }

    if (method === 'tools/call') {
      const request = CallToolRequestSchema.parse({ method, params: params ?? {} })
      const result = await callTool(request.params.name, request.params.arguments ?? {}, event)
      return { jsonrpc: '2.0', id, result }
    }

    const err = new McpError(ErrorCode.MethodNotFound, `Unknown method: ${method ?? '(missing)'}`)
    return { jsonrpc: '2.0', id, ...jsonError(err) }
  }
  catch (error) {
    return { jsonrpc: '2.0', id, ...jsonError(error) }
  }
})
