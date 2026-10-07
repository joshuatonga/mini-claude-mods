export type Combo = { model: string; effort: string }

export type Current = { model: string; effort: string | null } | null

declare module 'claude-code' {
  interface PluginState {
    'model-pick': {
      query: string
      assign: string | null
      notice: string | null
      favorites: string[]
      recents: Combo[]
      aliases: Record<string, string>
      current: Current
    }
  }
}
