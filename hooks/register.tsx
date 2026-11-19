import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Glosses } from '../types'

const MIN_SHELL_LEN = 25 // skip trivial commands like `ls`
const DEFAULT_TOOLS = 'Bash,PowerShell,Agent,mcp'
const READ_TOOLS = ['Read', 'Grep', 'Glob'] // added by the includeReads option
const SCRIPT_BYTES = 3000

const glosses = atom({ plugin: 'bash-gloss', key: 'glosses' } as const, {} as Glosses)

type Input = Record<string, unknown>
type Described = { kind: string; body: string; facts?: string; tags?: string[] }

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

// `./deploy.sh`, `bash build.sh`, `python tools/gen.py`, `node scripts/x.mjs`, `pwsh a.ps1` ...
const SCRIPT_RE =
  /(?:^|[;&|]\s*|\s)(?:(?:bash|sh|zsh|python3?|node|ruby|perl|pwsh|powershell|bun|deno)\s+(?:-File\s+)?)?((?:\.{1,2}[\\/]|[\w.-]+[\\/])?[\w./\\-]+\.(?:sh|py|js|mjs|cjs|ts|rb|pl|ps1|bat|cmd))\b/

/**
 * Facts about a shell command worked out from its text, never left to the
 * model: whether it only reads, whether it writes, whether it uses the
 * network. Naive on purpose (no quote parsing); when unsure it claims nothing.
 */
const READ_ONLY_CMDS = new Set([
  'cd', 'ls', 'dir', 'cat', 'head', 'tail', 'grep', 'rg', 'wc', 'pwd', 'echo', 'sort', 'uniq', 'stat', 'file',
  'which', 'date', 'ps', 'tree', 'diff', 'du', 'df', 'type', 'get-content', 'get-childitem', 'sed', 'find',
])
const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'branch', 'ls-files', 'rev-parse', 'remote', 'blame'])
const PKG = '(?:npm|pnpm|yarn|pip3?|cargo|brew|apt(?:-get)?)'
const WRITE_RE = new RegExp(
  '(?:^|[\\s;&|])(?:rm|mv|cp|mkdir|rmdir|touch|chmod|chown|ln|tee|truncate|dd|del|erase|ren|move|copy|set-content|add-content|remove-item|out-file)(?=\\s|$)' +
    '|\\bsed\\s+(?:-[a-zA-Z]*i|--in-place)' +
    '|\\|\\s*(?:ba|z)?sh\\b' +
    '|\\bgit\\s+(?:add|commit|push|pull|merge|rebase|reset|checkout|switch|stash|clean|rm|mv|restore|tag|cherry-pick)\\b' +
    `|\\b${PKG}\\s+(?:install|i|add|remove|uninstall|update|upgrade)\\b`,
  'i',
)
const NET_RE = new RegExp(
  '\\b(?:curl|wget|ssh|scp|rsync|ftp|nc|ncat|invoke-webrequest|invoke-restmethod|iwr|irm)\\b' +
    '|\\bgit\\s+(?:clone|fetch|pull|push)\\b' +
    `|\\b${PKG}\\s+(?:install|i|add|update|upgrade)\\b`,
  'i',
)
const UNSURE_RE = /\$\(|`|\s-[ce]\s|\bfind\b.*(?:-delete|-exec)|\bawk\b|<<|\bxargs\b|\beval\b/

function shellFacts(cmd: string): { tags: string[]; note: string } {
  // `2>/dev/null` and `2>&1` are not writes.
  const c = cmd.replace(/\d?>\s*\/dev\/null/g, '').replace(/\d>&\d/g, '')
  const hasRedirect = /(?:^|[^>\d&=-])>{1,2}(?![>&=])/.test(c)
  const writes = hasRedirect || WRITE_RE.test(c)
  const network = NET_RE.test(c)
  const tags: string[] = []
  if (writes) tags.push('changes files or state')
  if (network) tags.push('uses the network')
  if (!writes && !network && !UNSURE_RE.test(c)) {
    // Read-only only when every segment starts with a known reader.
    const segs = c.split(/&&|\|\||;|\|/).map(x => x.trim()).filter(Boolean)
    const isSure =
      segs.length > 0 &&
      segs.every(seg => {
        const [w = '', sub = ''] = seg.split(/\s+/)
        const name = w.toLowerCase()
        return name === 'git' ? READ_ONLY_GIT.has(sub) : READ_ONLY_CMDS.has(name)
      })
    if (isSure) tags.push('read-only')
  }
  const note = tags.length
    ? `Known facts about this command, worked out by a program (do not contradict them): ${tags.join('; ')}. ` +
      (network ? '' : 'It does not download or upload anything. ')
    : ''
  return { tags, note }
}

/**
 * What the model is shown for a call, or undefined to skip it. `kind` frames
 * the call; `body` is the relevant input. The prompts ask for what the code
 * does, not for a restatement of what the call already shows.
 */
function describe(tool: string, i: Input): Described | undefined {
  switch (tool) {
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(i.command, 3000)
      if (cmd.length < MIN_SHELL_LEN) return undefined
      const f = shellFacts(cmd)
      return { kind: 'shell command', body: cmd, facts: f.note, tags: f.tags }
    }
    case 'Edit':
      return {
        kind: 'code change; explain its effect on behaviour, not which text was swapped',
        body: `File: ${str(i.file_path, 300)}\nOLD:\n${str(i.old_string, 1000)}\nNEW:\n${str(i.new_string, 1000)}`,
      }
    case 'Write':
      return {
        kind: 'new or overwritten file; explain what the code is for and how it works',
        body: `File: ${str(i.file_path, 300)}\nContent (start):\n${str(i.content, 2000)}`,
      }
    case 'Read':
      return { kind: 'file read', body: `File: ${str(i.file_path, 300)}` }
    case 'Grep':
      return { kind: 'code search', body: `Pattern: ${str(i.pattern, 300)}\nIn: ${str(i.path, 300) || '.'}` }
    case 'Glob':
      return { kind: 'file search', body: `Pattern: ${str(i.pattern, 300)}\nIn: ${str(i.path, 300) || '.'}` }
    case 'WebFetch':
      return { kind: 'web page fetch', body: `URL: ${str(i.url, 500)}\nAsk: ${str(i.prompt, 500)}` }
    case 'WebSearch':
      return { kind: 'web search', body: `Query: ${str(i.query, 500)}` }
    case 'Agent':
      return { kind: 'subagent task', body: `Task: ${str(i.description, 200)}\nPrompt: ${str(i.prompt, 1500)}` }
    default: {
      let body = ''
      try {
        body = JSON.stringify(i).slice(0, 1500)
      } catch {}
      return { kind: `call to the tool ${tool}; say what its arguments ask it to do`, body }
    }
  }
}

const PROMPT = (d: Described) =>
  `Explain this ${d.kind} to a developer in plain English. Say what it achieves, not a word-for-word restatement. ` +
  `${d.facts ?? ''}Describe only what the text shows; do not guess. ` +
  `Reply in exactly two short lines, no markdown:\n` +
  `DOES: <what it does, max 14 words>\nTOUCHES: <files/dirs/hosts/things it changes or reads, max 12 words>\n\n` +
  `${d.body}`

export const register: Register = (on, options) => {
  const host = String(options?.host || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const model = String(options?.model || '').trim()
  const isDialogNotice = options?.dialogNotice !== false

  const names = String(options?.tools || DEFAULT_TOOLS)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (options?.includeReads === true) names.push(...READ_TOOLS)
  const isMcp = names.some(n => n.toLowerCase() === 'mcp')
  const exact = [...new Set(names.filter(n => n.toLowerCase() !== 'mcp'))]
  // Explicit matchers: the hook only runs for the tools the user chose.
  const matcher = [...exact, ...(isMcp ? [/^mcp__/] : [])]


  /** For a shell call that runs a script file, the start of that file. */
  const scriptOf = async ($: any, cmd: string): Promise<string> => {
    const m = SCRIPT_RE.exec(cmd)
    if (!m) return ''
    try {
      const text = String(await $.fs.read(m[1], { length: SCRIPT_BYTES }))
      return text ? `\n\nScript ${m[1]} (start):\n${text}` : ''
    } catch {
      return '' // missing, a directory, outside reach: gloss the command alone
    }
  }

  if (matcher.length === 0) return

  // Resolved once. A configured model is checked against Ollama; with none set
  // (an upgrade from 0.1.0, or a skipped prompt) the first installed
  // non-embedding model is used, so the mod never goes silently inert.
  let modelPromise: Promise<string | undefined> | undefined
  const resolveModel = ($: any): Promise<string | undefined> =>
    (modelPromise ??= $.http
      .fetch(`${host}/api/tags`, { method: 'GET' })
      .then((r: { ok: boolean; status: number; text: string }) => {
        if (!r.ok) {
          $.ui.toast(`bash-gloss: Ollama at ${host} answered ${r.status}.`, { timeoutMs: 10000 })
          return undefined
        }
        const have: string[] = (JSON.parse(r.text).models ?? []).map((m: { name: string }) => m.name)
        if (model) {
          if (!have.some(n => n === model || n === `${model}:latest`))
            $.ui.toast(`bash-gloss: model "${model}" is not in Ollama. Run \`ollama list\`, then set it in /config.`, {
              timeoutMs: 10000,
            })
          return model
        }
        const pick = have.find(n => !/embed/i.test(n))
        $.ui.toast(
          pick
            ? `bash-gloss: no model set, using "${pick}". Set Ollama model in /config to choose another.`
            : 'bash-gloss: no model set and Ollama has none. Run `ollama pull <model>` and set it in /config.',
          { timeoutMs: 10000 },
        )
        return pick
      })
      .catch(() => {
        $.ui.toast(`bash-gloss: cannot reach Ollama at ${host}. Is it running?`, { timeoutMs: 10000 })
        modelPromise = undefined // try again on the next call
        return undefined
      }))

  on('tool.call', { tool: matcher } as any, async ($: any, e: any, next: any) => {
    const tool = String(e.tool)
    const id = e.tool_use_id
    if (!id) return next(e)
    const d = describe(tool, e as Input)
    if (!d) return next(e)
    if (tool === 'Bash' || tool === 'PowerShell') d.body += await scriptOf($, str(e.command, 3000))

    // Fire and forget: the call never waits for the model.
    const gloss: Promise<string | undefined> = resolveModel($)
      .then(async (m: string | undefined) => {
        if (!m) return undefined
        const r = await $.http.fetch(`${host}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: m,
            prompt: PROMPT(d),
            stream: false,
            think: false,
            options: { temperature: 0.1, num_predict: 90 },
          }),
        })
        if (!r.ok) return undefined
        const text = String(JSON.parse(r.text).response ?? '').trim()
        // The program's own facts are appended verbatim, so they hold even if the model errs.
        const out = text && d.tags?.length ? `${text}\nFACT: ${d.tags.join('; ')}` : text
        if (out) await update($, glosses, (g: Glosses) => ({ ...g, [id]: out }))
        return out || undefined
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
  }).catch(($: any, e: any, next: any) => next(e)) // a failure here must never block a tool call

  // Any tool row that has a gloss gets it; rows without one render untouched.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
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
