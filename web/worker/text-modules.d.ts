// wrangler.jsonc imports .md files as text (rules: Text).
declare module '*.md' {
  const text: string
  export default text
}

// The part of the Workers runtime module this worker uses.
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: {
      storage: {
        get<T>(key: string): Promise<T | undefined>
        put(key: string, value: unknown): Promise<void>
        delete(key: string): Promise<boolean>
        list(): Promise<Map<string, unknown>>
      }
    }
    protected env: Env
    constructor(ctx: unknown, env: Env)
  }
}
