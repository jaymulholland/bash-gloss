export type Glosses = Record<string, string>
/** Calls waiting on the model (by tool_use_id) and the spinner's current frame. */
export type Busy = { ids: Record<string, true>; frame: number }

declare module 'claude-code' {
  interface PluginState {
    'bash-gloss': { glosses: Glosses; busy: Busy }
  }
}
