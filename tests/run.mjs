#!/usr/bin/env node
/**
 * bash-gloss summary test suite.
 *
 * Sends every case in cases.json to Ollama using the SAME prompt, options and
 * program-derived facts as hooks/register.tsx, logs each result as JSONL, runs
 * automatic quality checks, and writes a markdown review sheet for human grading.
 *
 *   node tests/run.mjs --model open-field:latest
 *   node tests/run.mjs --model nemo:latest --runs 3 --only '^net-'
 *   node tests/run.mjs --model open-field:latest --judge nemotron-nano-64k:latest
 *
 * Options: --model (required) --host --runs N (default 1) --only REGEX --cat NAME
 *          --judge MODEL (advisory LLM grading) --out DIR (default tests/logs)
 *
 * The prompt, facts and tidy-up code are loaded straight from hooks/register.tsx (<gloss-core> region).
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 ? process.argv[i + 1] : d
}
const flag = n => process.argv.includes(`--${n}`)

// ---------------------------------------------------------------- the real code under test
// Extract the pure <gloss-core> region from hooks/register.tsx and import it, so the
// tests exercise exactly what ships (no copy to drift). Needs Node >= 22.18 (type stripping).
import { pathToFileURL } from 'node:url'
const regSrc = readFileSync(join(here, '..', 'hooks', 'register.tsx'), 'utf8')
const start = regSrc.indexOf('// <gloss-core>')
const end = regSrc.indexOf('// </gloss-core>')
if (start < 0 || end < 0) throw new Error('register.tsx has no <gloss-core> region')
const coreSrc = regSrc.slice(start, end)
mkdirSync(join(here, 'logs'), { recursive: true })
const corePath = join(here, 'logs', '.gloss-core.mts')
writeFileSync(corePath, coreSrc + '\nexport { MIN_SHELL_LEN, SCRIPT_RE, scriptNote, shellFacts, describe, PROMPT, finishGloss }\n')
const { MIN_SHELL_LEN, SCRIPT_RE, scriptNote, describe, PROMPT, finishGloss } = await import(pathToFileURL(corePath).href)
const REQUEST_OPTIONS = { temperature: 0.1, num_predict: 90 } // keep equal to the fetch in register.tsx
if (!regSrc.includes('temperature: 0.1, num_predict: 90')) throw new Error('request options in register.tsx changed: update REQUEST_OPTIONS')
// ----------------------------------------------------------------------------------------------

const model = arg('model')
if (!model) {
  console.error('usage: node tests/run.mjs --model <ollama model> [--runs N] [--only REGEX] [--cat NAME] [--judge MODEL]')
  process.exit(2)
}
const host = arg('host', 'http://127.0.0.1:11434').replace(/\/+$/, '')
const runs = Number(arg('runs', '1'))
const only = arg('only') ? new RegExp(arg('only')) : null
const catFilter = arg('cat')
const judgeModel = arg('judge')

const allCases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'))
const cases = allCases.filter(c => (!only || only.test(c.id)) && (!catFilter || c.cat === catFilter))

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = arg('out', join(here, 'logs'))
mkdirSync(outDir, { recursive: true })
const base = join(outDir, `${stamp}_${model.replace(/[^\w.-]/g, '_')}`)
const jsonl = `${base}.jsonl`

async function generate(m, prompt, options) {
  const t0 = Date.now()
  const r = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: m, prompt, stream: false, think: false, options }),
  })
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  return { text: String(j.response ?? '').trim(), ms: Date.now() - t0 }
}

// ---------------------------------------------------------------- automatic checks
const FACT_TAGS = { 'read-only': 'read-only', 'changes files': 'changes files or state', network: 'uses the network' }
const VAGUE = [
  /\b(runs?|executes?|performs?) (a|the|some) (shell )?(command|operation|task|action)s?\b/i,
  /\bvarious (files|operations|tasks|things)\b/i,
  /\bsome (files|things|operations)\b/i,
  /\bas (specified|needed|required)\b/i,
  /\bthe (specified|given|provided) (file|path|command|url)s?\b/i,
  /^DOES:\s*(runs|executes|performs)\b/im,
]
const MUTATING = /\b(delet\w*|remov\w*|writ\w*|modif\w*|overwrit\w*|creat\w*|install\w*|renam\w*|appends?\w*)\b/i
const NETWORKY = /\b(download\w*|upload\w*|fetch\w*|http request|sends? (a )?request|connect\w* to)\b/i
const words = s => s.trim().split(/\s+/).filter(Boolean).length
const tokens = s => new Set(s.toLowerCase().match(/[a-z0-9_.\/-]{3,}/g) ?? [])

function check(c, d, text) {
  const res = {}
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean)
  const does = lines.find(l => /^DOES:/i.test(l)) ?? ''
  const touches = lines.find(l => /^TOUCHES:/i.test(l)) ?? ''
  const noFact = lines.filter(l => !/^(FACT|WARNING):/i.test(l))

  res.format = noFact.length === 2 && !!does && !!touches && !/[*#`]/.test(text)
  res.lengthOk = words(does.replace(/^DOES:/i, '')) <= 18 && words(touches.replace(/^TOUCHES:/i, '')) <= 15

  const miss = (c.mustMention ?? []).filter(p => !new RegExp(p, 'i').test(text))
  res.specific = miss.length === 0
  if (miss.length) res.missing = miss
  const tmiss = (c.touches ?? []).filter(p => !new RegExp(p, 'i').test(does + ' ' + touches))
  res.touchesRight = tmiss.length === 0
  if (tmiss.length) res.touchesMissing = tmiss

  res.notVague = !VAGUE.some(re => re.test(text))

  const subject = c.command ?? JSON.stringify(c.input ?? {})
  const a = tokens(does.replace(/^DOES:/i, '')), b = tokens(subject)
  const overlap = a.size ? [...a].filter(t => b.has(t)).length / a.size : 0
  res.overlap = Number(overlap.toFixed(2))
  res.notRestatement = overlap < 0.8 || a.size < 4

  if (c.mustNotMention) res.noBadClaims = !c.mustNotMention.some(p => new RegExp(p, 'im').test(text))

  // program facts: computed by shellFacts vs what the case author expects (tests the classifier)
  const tags = d.tags ?? []
  if (c.facts) {
    const bad = c.facts.filter(f => !tags.includes(FACT_TAGS[f]))
    res.factsClassified = bad.length === 0
    if (bad.length) res.factsMissing = bad
  }
  // the model contradicting those facts
  let contradiction = ''
  if (tags.includes('read-only') && MUTATING.test(does)) contradiction = 'claims a change but command is read-only'
  if (tags.length && !tags.includes('uses the network') && NETWORKY.test(does)) contradiction = 'claims network use but facts say none'
  res.noContradiction = !contradiction
  if (contradiction) res.contradiction = contradiction

  const core = ['format', 'specific', 'notVague', 'noContradiction', 'touchesRight', 'notRestatement']
  if ('noBadClaims' in res) core.push('noBadClaims')
  res.score = Number((core.filter(k => res[k]).length / core.length).toFixed(2))
  return res
}

async function judge(c, text) {
  const subject = c.command ?? `${c.tool} ${JSON.stringify(c.input)}`
  const p =
    `You grade one-line summaries of tool calls shown to a developer. Be strict.\n` +
    `CALL: ${subject}\nSUMMARY:\n${text}\n\n` +
    `Score 1-5 each: accuracy (true to the call, nothing invented), specificity (names the real files/values/hosts instead of generic words), ` +
    `usefulness (would help someone decide whether to approve the call; mentions risk when destructive).\n` +
    `Reply with JSON only: {"accuracy":n,"specificity":n,"usefulness":n,"issue":"<max 15 words or empty>"}`
  try {
    const { text: out } = await generate(judgeModel, p, { temperature: 0, num_predict: 120 })
    return JSON.parse(out.match(/\{[^]*\}/)?.[0] ?? '{}')
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------- run
console.log(`model=${model} cases=${cases.length} runs=${runs} -> ${jsonl}\n`)
const rows = []
for (const c of cases) {
  const input = c.input ?? { command: c.command }
  const d = describe(c.tool, input)
  if (d && /^(Bash|PowerShell)$/.test(c.tool)) {
    // same as scriptOf in register.tsx: a script path in the command is read, or flagged unknown
    const m = SCRIPT_RE.exec(c.command ?? '')
    if (m) d.body += scriptNote(m[1], c.script ? c.script.content.slice(0, 3000) : undefined)
  }
  if (!d) {
    const row = { id: c.id, cat: c.cat, skipped: true, ok: !!c.expectSkip }
    appendFileSync(jsonl, JSON.stringify({ ...row, command: c.command, model, ts: new Date().toISOString() }) + '\n')
    rows.push(row)
    console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${c.id.padEnd(18)} skipped (under ${MIN_SHELL_LEN} chars)`)
    continue
  }
  if (c.expectSkip) {
    console.log(`FAIL ${c.id} expected skip but described`)
  }
  for (let n = 1; n <= runs; n++) {
    let rec
    try {
      const prompt = PROMPT(d)
      const { text: raw, ms } = await generate(model, prompt, REQUEST_OPTIONS)
      // the program's own facts are appended verbatim by the hook
      const shown = finishGloss(raw, d) // what the user sees: tidied model text + program WARNING/FACT lines
      const checks = check(c, d, shown)
      checks.rawFormat = /^DOES:/im.test(raw) && /^TOUCHES:/im.test(raw) && raw.split('\n').filter(l => l.trim()).length === 2
      const j = judgeModel ? await judge(c, shown) : undefined
      rec = { id: c.id, cat: c.cat, run: n, model, ts: new Date().toISOString(), ms, tool: c.tool, subject: c.command ?? c.input, notes: c.notes, tags: d.tags, raw, shown, checks, judge: j }
    } catch (e) {
      rec = { id: c.id, cat: c.cat, run: n, model, error: String(e.message ?? e), checks: { score: 0 } }
    }
    appendFileSync(jsonl, JSON.stringify(rec) + '\n')
    rows.push(rec)
    const failed = Object.entries(rec.checks).filter(([k, v]) => v === false).map(([k]) => k)
    console.log(`${rec.checks.score >= 1 ? 'ok  ' : 'WARN'} ${c.id.padEnd(18)} ${String(rec.checks.score).padEnd(4)} ${rec.ms ?? '-'}ms ${failed.join(',')}`)
    if (rec.raw) console.log('     ' + rec.raw.replace(/\n/g, '\n     '))
  }
}

// ---------------------------------------------------------------- summary + review sheet
const scored = rows.filter(r => !r.skipped && !r.error)
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const byCat = {}
for (const r of scored) (byCat[r.cat] ??= []).push(r.checks.score)
const checkNames = ['format', 'specific', 'notVague', 'noContradiction', 'touchesRight', 'notRestatement', 'noBadClaims', 'factsClassified']
const rate = k => {
  const rs = scored.filter(r => k in r.checks)
  return rs.length ? `${Math.round((100 * rs.filter(r => r.checks[k]).length) / rs.length)}% (${rs.length})` : 'n/a'
}

let md = `# bash-gloss summary review\n\nModel: \`${model}\`  \nRuns: ${runs}  \nLog: \`${jsonl}\`  \nMean auto score: **${avg(scored.map(r => r.checks.score)).toFixed(2)}**  \nMedian latency: ${[...scored.map(r => r.ms)].sort((a, b) => a - b)[Math.floor(scored.length / 2)] ?? '-'} ms\n\n`
md += `## Automatic checks (pass rate)\n\n| check | pass |\n|---|---|\n${checkNames.map(k => `| ${k} | ${rate(k)} |`).join('\n')}\n\n`
md += `## By category (mean score)\n\n| category | n | score |\n|---|---|---|\n${Object.entries(byCat).map(([k, v]) => `| ${k} | ${v.length} | ${avg(v).toFixed(2)} |`).join('\n')}\n\n`
md += `## Human grading\n\nFor each item mark **A**ccurate / **S**pecific / **U**seful as 1 (bad) to 3 (good). Auto checks are a floor, not a verdict: they can't tell a correct summary from a plausible wrong one. Target: no accuracy 1s, mean specificity and usefulness >= 2.5.\n\n`
for (const r of rows.filter(r => !r.skipped)) {
  md += `### ${r.id} (${r.cat}${r.run > 1 ? `, run ${r.run}` : ''})\n\n`
  if (r.error) { md += `ERROR: ${r.error}\n\n`; continue }
  const subj = typeof r.subject === 'string' ? r.subject : JSON.stringify(r.subject)
  md += `\`\`\`\n${subj.slice(0, 400)}\n\`\`\`\n\n> ${r.shown.replace(/\n/g, '\n> ')}\n\n`
  const bad = Object.entries(r.checks).filter(([k, v]) => v === false).map(([k]) => k)
  md += `auto: ${r.checks.score}${bad.length ? ` — failed: ${bad.join(', ')}` : ''}${r.checks.missing ? ` — missing ${JSON.stringify(r.checks.missing)}` : ''}${r.checks.contradiction ? ` — ${r.checks.contradiction}` : ''}  \n`
  if (r.notes) md += `note: ${r.notes}  \n`
  if (r.judge) md += `judge (advisory): ${JSON.stringify(r.judge)}  \n`
  md += `grade: A=_ S=_ U=_\n\n`
}
writeFileSync(`${base}.md`, md)
console.log(`\nmean score ${avg(scored.map(r => r.checks.score)).toFixed(2)} over ${scored.length} results`)
console.log(`review sheet: ${base}.md`)
