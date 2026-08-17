import type { H3Event } from 'h3'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/server'
import { CreateLinkSchema } from '#shared/schemas/link'

/**
 * MCP 2.0 (2026-07-28) server factory for Sink.
 *
 * Auth is inherited from `server/middleware/2.auth.ts`: site-token (root)
 * or Cloudflare Access identity. Every request to /api/* and /mcp is
 * authenticated before reaching here.
 *
 * One McpServer is built per request (closure over the H3Event) so tool
 * handlers can reuse the existing link-store helpers, which need
 * `event.context` for identity and runtime config.
 */

const textResult = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
})

const toolError = (err: unknown): { content: { type: 'text', text: string }[], isError: true } => {
  const message = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
}

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

function safe<T>(fn: () => T | Promise<T>): Promise<{ content: { type: 'text', text: string }[], isError?: boolean }> {
  return Promise.resolve().then(fn).then(textResult, toolError)
}

export function buildMcpServer(event: H3Event): McpServer {
  const server = new McpServer({ name: 'sink', version: '2.0.0' }, {
    capabilities: { tools: {} },
  })

  server.registerTool('shorten_url', {
    description:
      'Create a new short link. Returns the created link with its short URL, slug, title, and metadata. Fails if the slug already exists (omit slug to auto-generate).',
    inputSchema: CreateLinkSchema,
  }, async (args) => {
    try {
      await prepareIncomingLink(event, args)
      await hashLinkPasswordForCreate(args)
      if (!await createLink(event, args))
        throw new Error('Link already exists (slug in use)')
      return textResult(buildLinkResponse(event, args))
    }
    catch (error) {
      return toolError(error)
    }
  })

  server.registerTool('search_links', {
    description:
      'Search existing short links by keyword (matches slug, URL, comment, or tag), exact URL, tag, or status. At least one of q/url is required.',
    inputSchema: SearchArgsSchema,
  }, (args) => safe(async () => {
    if (!args.q && !args.url)
      return []
    return searchLinks(event, { ...args, limit: args.limit ?? 20 })
  }))

  server.registerTool('list_links', {
    description:
      'List short links with pagination. Returns { links, cursor, list_complete }. Pass cursor from a previous response to page further.',
    inputSchema: ListArgsSchema,
  }, (args) => safe(async () => {
    const list = await listLinks(event, { ...args, limit: args.limit ?? 20 })
    return { ...list, links: sanitizeLinksPassword(list.links) }
  }))

  server.registerTool('get_link', {
    description: 'Fetch a single short link by its slug. Returns the link record including its destination URL and metadata.',
    inputSchema: GetLinkArgsSchema,
  }, (args) => safe(async () => {
    const link = await getLink(event, args.slug)
    if (!link)
      throw new Error(`Link not found: ${args.slug}`)
    return sanitizeLinksPassword([link])[0]
  }))

  server.registerTool('get_link_count', {
    description: 'Count short links matching optional keyword, tag, and status filters.',
    inputSchema: CountArgsSchema,
  }, (args) => safe(async () => {
    return { count: await countLinks(event, args) }
  }))

  return server
}
