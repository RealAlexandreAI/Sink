import { createMcpHandler } from '@modelcontextprotocol/server'
import { buildMcpServer } from '#server/utils/mcp-tools'

export default eventHandler(async (event) => {
  const request = new Request(getRequestURL(event), {
    method: event.method,
    headers: new Headers(
      Object.entries(getRequestHeaders(event))
        .filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  })

  const handler = createMcpHandler(() => buildMcpServer(event))
  const response = await handler.fetch(request)

  setResponseStatus(event, response.status, response.statusText)
  for (const [key, value] of response.headers)
    setHeader(event, key, value)

  return response
})
