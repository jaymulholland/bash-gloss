export type Glosses = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'bash-gloss': { glosses: Glosses }
  }
}
