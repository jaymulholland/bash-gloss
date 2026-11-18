import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Glosses } from '../types'

const MIN_LEN = 25 // skip trivial commands like `ls`

const glosses = atom({ plugin: 'bash-gloss', key: 'glosses' } as const, {} as Glosses)

const PROMPT = (cmd: string) =>
  `Explain this shell command to a developer in plain English. Reply in exactly two short lines, no markdown:\n` +
  `DOES: <what it does, max 14 words>\nTOUCHES: <files/dirs/things it changes or reads, max 12 words>\n\n` +
  `Command:\n${cmd.slice(0, 3000)}`

export const register: Register = (on, options) => {
  const host = String(options?.host || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const model = String(options?.model || 'nemotron-3-nano:4b')
  const isDialogNotice = options?.dialogNotice === true

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cmd = e.command
    const id = e.tool_use_id
    if (!id || cmd.length < MIN_LEN) return next(e)

    // Fire and forget: the command never waits for the model.
    const gloss: Promise<string | undefined> = $.http
      .fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: PROMPT(cmd),
          stream: false,
          think: false,
          options: { temperature: 0.1, num_predict: 90 },
        }),
      })
      .then(async r => {
        if (!r.ok) return undefined
        const text = String(JSON.parse(r.text).response ?? '').trim()
        if (text) await update($, glosses, g => ({ ...g, [id]: text }))
        return text || undefined
      })
      .catch(() => undefined)

    let isDone = false
    if (isDialogNotice) {
      // The permission dialog opens inside next(e); a notice is refused until
      // it is open, so retry until the call resolves.
      void gloss.then(async text => {
        if (!text) return
        const line = '↳ ' + text.split('\n').map(s => s.trim()).filter(Boolean).join(' | ')
        for (let i = 0; i < 40 && !isDone; i++) {
          try {
            $.ui.notice(id, line)
          } catch {}
          await $.clock.sleep(500)
        }
      })
    }

    try {
      return await next(e)
    } finally {
      isDone = true
    }
  }).catch(($, e, next) => next(e)) // a failure here must never block a command

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'Bash') return next(e)
    const gloss = (await read($, glosses))[e.props.tool_use_id]
    if (!gloss) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        {gloss.split('\n').map((line, i) => (
          <Text key={String(i)} dimColor>
            {i === 0 ? '↳ ' : '  '}
            {line}
          </Text>
        ))}
      </Box>
    )
  })
}
