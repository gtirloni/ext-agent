/** Exact registered agent names; no wildcard can accidentally route a planner. */
export type Route = { runtime: 'pi' | 'opencode'; model?: string; instructionsFile: string }
export type Routes = Record<string, Route>

export function parseRoutes(value: unknown): Routes {
  const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value ?? {}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('agentRoutes must be a JSON object')
  const routes: Routes = Object.create(null)
  for (const [name, route] of Object.entries(parsed)) {
    if (!/^[\w:-]+$/.test(name) || name === 'fork' || name === 'ext-agent:worker') throw new Error(`Unsupported route name: ${name}`)
    if (!route || typeof route !== 'object' || Array.isArray(route)) throw new Error(`Invalid route for ${name}`)
    const r = route as Record<string, unknown>
    if (Object.keys(r).some(k => !['runtime', 'model', 'instructionsFile'].includes(k))) throw new Error(`Unknown route field for ${name}`)
    if (r.runtime !== 'pi' && r.runtime !== 'opencode') throw new Error(`Invalid runtime for ${name}`)
    if (r.model !== undefined && (typeof r.model !== 'string' || !r.model.trim() || /\s/.test(r.model))) throw new Error(`Invalid model for ${name}`)
    if (typeof r.instructionsFile !== 'string' || !r.instructionsFile.trim()) throw new Error(`instructionsFile is required for ${name}`)
    routes[name] = { runtime: r.runtime, model: r.model as string | undefined, instructionsFile: r.instructionsFile }
  }
  return routes
}

export const routeModel = (route: Route) => route.runtime + (route.model ? `:${route.model}` : '')

/** Only the role body is handed over; frontmatter config belongs to Claude. */
export function instructionsBody(text: string): string {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return normalized.trim()
  const end = normalized.indexOf('\n---', 4)
  if (end < 0 || !/^\n---(?:\n|$)/.test(normalized.slice(end))) throw new Error('Unterminated agent frontmatter')
  return normalized.slice(end + 4).trim()
}

export function rolePrompt(type: string, instructions: string, task: string): string {
  return `Agent role: ${type}\n\n${instructions}\n\n---\nTask:\n${task}`
}
