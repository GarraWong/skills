#!/usr/bin/env node
// coverage-check.mjs — checks the coverage ledger for a functional-spec domain.
//
//   node coverage-check.mjs [<change>] [options]
//
//   --root <dir>       repo root (default: cwd)
//   --index <path>     business rules index
//                      (default: functional-spec/appendix/business-rules-index.md)
//   --coverage <dir>   coverage ledgers (default: openspec/coverage)
//   --tc <regex>       TC-ID grammar (default: shape-only, see TC below)
//   --json             machine-readable output
//
// Exit: 0 clean · 1 bookkeeping broken · 2 gate blocked for <change>
//
// ONE file per source document holds the atomization AND its coverage. There is
// no per-change report and no ownership column: an atom's `Covered by` path
// starts with the change that covers it, so attribution is read off the evidence
// rather than asserted in advance. Coverage is a property of the DOMAIN; a
// change is gated only on defects attributable to its own specs.

import fs from 'node:fs'
import path from 'node:path'

const ATOM = /^BR-[A-Z0-9]+-\d{3}(?:\.(?:D|E|P)?\d+)?$/
const RULE = /^BR-[A-Z0-9]+-\d{3}/
// TC-{CAP}-{NNN}-{KIND}-{ST}. The KIND and ST vocabularies are a property of the
// host project's test-spec convention, not of this check — so the default only
// asserts the SHAPE (five segments, a 3-digit ordinal, two uppercase tokens) and
// a project that wants its own vocabulary enforced passes `--tc <regex>`.
let TC = /^TC-[A-Z0-9-]+-\d{3}-[A-Z]{2,5}-[A-Z]{2,5}$/
const FIELDS = new Set(['Rule', 'Exceptions', 'Denial behavior', 'Preconditions'])
const DISPOSITIONS = ['write new br upstream', 'delete from spec']
const EMPTY = new Set(['', '-', '—', 'n/a', 'none', 'tbd'])
const QUOTED = /["“”`]/

const STATUS = {
  '✅ covered': 'covered',
  '⚠️ partial': 'partial',
  '❌ uncovered': 'uncovered',
  '⛔ contradiction': 'contradiction',
  '⏸️ deferred': 'deferred',
  '➖ out-of-scope': 'out-of-scope',
  '🚫 retired': 'retired',
  '⬜ pending': 'pending'
}
const RENDER = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v, k]))
// Statuses that must be written up in §4. `pending` is "not looked at yet" and
// `retired` is an upstream fact, so neither is a finding.
const NEEDS_FINDING = new Set(['partial', 'uncovered', 'contradiction', 'deferred', 'out-of-scope'])

// ── args ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const opt = {
  root: process.cwd(),
  index: 'functional-spec/appendix/business-rules-index.md',
  coverage: 'openspec/coverage',
  json: false
}
let change = null
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--root') opt.root = argv[++i]
  else if (a === '--index') opt.index = argv[++i]
  else if (a === '--coverage') opt.coverage = argv[++i]
  else if (a === '--tc') { try { TC = new RegExp(argv[++i]) } catch { die(`--tc is not a valid regex: ${argv[i]}`) } }
  else if (a === '--json') opt.json = true
  else if (a === '-h' || a === '--help') { usage(); process.exit(0) }
  else if (a.startsWith('-')) die(`unknown option: ${a}`)
  else change = a
}
function usage () {
  console.log('usage: coverage-check.mjs [<change>] [--root <dir>] [--index <path>] [--coverage <dir>] [--tc <regex>] [--json]')
  console.log('  <change> optional — without it, only domain-level checks run (no gate)')
}
function die (msg) { console.error(`coverage-check: ${msg}`); process.exit(1) }

// ── issues ────────────────────────────────────────────────────────────────────

const issues = []
const ledger = (code, msg) => issues.push({ level: 'error', kind: 'ledger', code, msg })
const gate = (code, msg) => issues.push({ level: 'error', kind: 'gate', code, msg })
const warn = (code, msg) => issues.push({ level: 'warn', kind: null, code, msg })

// console.log + process.exit truncates piped stdout: the exit races the flush.
// It only shows once output outgrows the pipe buffer, so buffer and write
// synchronously. Declared here because report() is called before its own
// position in the file, so these must already be initialized.
const outBuf = []
const say = s => outBuf.push(s)
function flushAndExit (code) {
  try { fs.writeSync(1, outBuf.join('\n') + '\n') } catch { /* EPIPE */ }
  process.exit(code)
}

// ── helpers ───────────────────────────────────────────────────────────────────

const abs = p => path.resolve(opt.root, p)
const read = p => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
const clean = v => (v ?? '').replace(/[`*]/g, '').trim()
const blank = v => EMPTY.has(clean(v).toLowerCase())
const linkTarget = v => { const m = /\(([^)]+)\)/.exec(v); return m ? m[1] : v.replace(/[[\]]/g, '') }
const baseRule = a => a.split('.')[0]
// Compare version strings numerically, not as text: a two- and a three-part
// spelling of the same version (0.7 / 0.7.0) is the same baseline, and string
// equality would report every such pair as a stale pin.
const sameVersion = (a, b) => {
  const p = v => { const n = String(v).split('.').map(Number); while (n.length < 3) n.push(0); return n.slice(0, 3) }
  const [x, y] = [p(a), p(b)]
  return x.every((n, i) => n === y[i])
}
const seg = p => p.split('›').map(x => clean(x)).filter(Boolean)
// Compare quotes on content, not punctuation. Three things differ between an
// Evidence cell and the spec line it came from: inner quotes get swapped to
// avoid breaking the cell's own delimiters, whitespace gets reflowed, and
// markdown emphasis survives in the spec but is stripped from table cells.
const norm = s => (s ?? '').replace(/[“”"'`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

function sections (md) {
  const out = new Map()
  let cur = null, buf = []
  for (const line of (md || '').split('\n')) {
    const m = /^##\s+§\s*(\d+)/.exec(line)
    if (m) { if (cur !== null) out.set(cur, buf.join('\n')); cur = Number(m[1]); buf = [] }
    else if (/^##\s+/.test(line)) { if (cur !== null) out.set(cur, buf.join('\n')); cur = null; buf = [] }
    else if (cur !== null) buf.push(line)
  }
  if (cur !== null) out.set(cur, buf.join('\n'))
  return out
}

function tableRows (text) {
  const out = []
  for (const line of (text || '').split('\n')) {
    const t = line.trim()
    if (!t.startsWith('|')) continue
    const c = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
    if (c.every(x => /^:?-{2,}:?$/.test(x))) continue
    out.push(c)
  }
  return out
}

function walk (dir, name, hits = []) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return hits }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, name, hits)
    else if (e.name === name) hits.push(p)
  }
  return hits
}

// A test spec is either one `test-spec.md` at the change root or a `test_spec/`
// package of several files — both conventions are in use, and which one a
// project picked is not this check's business. Resolve to the FILE LIST so
// "does a test spec exist yet" and "does this TC-ID appear in it" work either
// way; a package's TC-IDs routinely live in a child file, not the index.
function testSpecFiles (changeDir) {
  const hits = []
  const single = path.join(changeDir, 'test-spec.md')
  if (fs.existsSync(single)) hits.push(single)
  for (const d of ['test_spec', 'test-spec']) {
    const dir = path.join(changeDir, d)
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) hits.push(path.join(dir, f))
    }
  }
  return hits
}

// ── upstream index ────────────────────────────────────────────────────────────

const indexPath = abs(opt.index)
const indexMd = read(indexPath)
const ruleDoc = new Map()
if (indexMd === null) {
  const upstreamRoot = opt.index.split(path.sep)[0]
  if (!upstreamRoot || !fs.existsSync(abs(upstreamRoot))) {
    report({ na: `no ${upstreamRoot || 'upstream rules'}/ tree in this project — trace gate is a no-op` })
  }
  ledger('L00', `business rules index not found: ${opt.index}`)
} else {
  const dir = path.dirname(indexPath)
  for (const r of tableRows(indexMd)) {
    const id = clean(r[0])
    if (!RULE.test(id) || id !== baseRule(id)) continue
    const link = r.slice(1).map(linkTarget).find(v => /\.md$/.test(v))
    ruleDoc.set(id, link ? path.resolve(dir, link) : null)
  }
  if (!ruleDoc.size) ledger('L00', `no BR-xxx rows parsed from ${opt.index}`)
}

// ── downstream requirements, across every active change ──────────────────────

// Anchors live on the Scenario, because that is the granularity an atom is
// covered at — a Covered-by path ends at a Scenario. A requirement-level anchor
// cannot say which of its Scenarios serves which rule, and it keeps claiming a
// rule after that rule's only Scenario is deleted.
function parseSpec (file, changeName, cap) {
  const out = []
  let op = null, cur = null, sc = null
  for (const line of (read(file) || '').split('\n')) {
    const o = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\b/i.exec(line)
    if (o) { op = o[1].toUpperCase(); cur = null; sc = null; continue }
    const m = /^###\s+Requirement:\s*(.+?)\s*$/.exec(line)
    if (m) {
      cur = { name: m[1], change: changeName, capability: cap, op: op ?? 'ADDED', source: new Set(), scenarios: [], body: [] }
      out.push(cur); sc = null; continue
    }
    if (!cur) continue
    const v = /^####\s+Scenario:\s*(.+?)\s*$/.exec(line)
    if (v) { sc = { name: v[1], source: new Set(), body: [] }; cur.scenarios.push(sc); cur.body.push(line); continue }
    const s = /^\*\*Source:\*\*\s*(.*)$/.exec(line.trim())
    if (s) {
      const target = sc ?? cur
      if (s[1].includes('<!--')) target.placeholder = true
      else for (const id of s[1].match(/BR-[A-Z0-9]+-\d{3}/g) || []) target.source.add(id)
    }
    if (sc) sc.body.push(line)
    cur.body.push(line)
  }
  return out
}

// A change keeps its identity after archiving, but the directory gains a
// YYYY-MM-DD- prefix. Resolve that at read time rather than rewriting every
// Covered-by path on archive — rewriting edits a historical record and needs a
// hook in the archive flow; reading tolerantly cannot corrupt anything.
const stripDate = n => n.replace(/^\d{4}-\d{2}-\d{2}-/, '')
const changesDir = abs('openspec/changes')
const changeDirs = []
if (fs.existsSync(changesDir)) {
  for (const e of fs.readdirSync(changesDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    if (e.name === 'archive') {
      const ad = path.join(changesDir, 'archive')
      for (const a of fs.readdirSync(ad, { withFileTypes: true })) {
        if (a.isDirectory()) changeDirs.push({ name: stripDate(a.name), dir: path.join(ad, a.name), archived: true })
      }
    } else changeDirs.push({ name: e.name, dir: path.join(changesDir, e.name), archived: false })
  }
}
const activeChanges = changeDirs.filter(c => !c.archived).map(c => c.name)
const knownChanges = new Map(changeDirs.map(c => [c.name, c]))

const requirements = []
for (const c of changeDirs) {
  for (const f of walk(path.join(c.dir, 'specs'), 'spec.md')) {
    requirements.push(...parseSpec(f, c.name, path.basename(path.dirname(f))))
  }
}
const live = requirements.filter(r => r.op === 'ADDED' || r.op === 'MODIFIED')

// Attribution reads the change off the Covered-by path, but a duplicate
// Requirement name across changes makes any lookup ambiguous — and two changes
// both declaring MODIFIED on the same living requirement produce exactly that.
// Active changes only. An archived change and an active one sharing a
// requirement name is normal — MODIFIED reuses the living spec's header.
{
  const byName = new Map()
  for (const r of live.filter(x => activeChanges.includes(x.change))) {
    if (!byName.has(r.name)) byName.set(r.name, new Set())
    byName.get(r.name).add(r.change)
  }
  for (const [name, chs] of byName) {
    if (chs.size > 1) ledger('S23', `Requirement "${name}" is declared by ${chs.size} changes (${[...chs].join(', ')}) — attribution is ambiguous`)
  }
}

// Requirement and Scenario names carry markdown (`Date \`is\` covers a whole
// day`). A Covered-by cell has it stripped by clean(); the spec heading does
// not. Key both sides through the same normalizer or the lookup misses.
const nameKey = s => clean(s).toLowerCase()
const reqIndex = new Map(live.map(r => [`${r.change}|${nameKey(r.name)}`, r]))

// ── coverage ledgers ──────────────────────────────────────────────────────────

const atoms = new Map()
const covFiles = fs.existsSync(abs(opt.coverage))
  ? fs.readdirSync(abs(opt.coverage)).filter(f => f.endsWith('.md')).sort().map(f => path.join(abs(opt.coverage), f))
  : []
if (!covFiles.length) ledger('C01', `${opt.coverage}/ holds no coverage ledger — seed one before reconciling`)

const tracedReq = new Set()
const untested = []
const noTestSpec = []
const orphanSections = []
const declaredDocs = []
const noAnchor = new Map()
const missingRule = new Map()
// C17: atoms whose rule the index now maps to a different document than the one
// their ledger declares. Aggregated per (ledger, target document) — a stranded
// ledger strands every atom in it, and saying so once per atom buries it.
const stranded = new Map()

for (const f of covFiles) {
  const md = read(f)
  const s = sections(md)
  const rel = path.relative(opt.root, f)
  const docRows = tableRows(s.get(1)).filter(r => /\.md/.test(r[0] ?? ''))

  if (!docRows.length) { ledger('C02', `${rel} §1 declares no source document`); continue }
  if (docRows.length > 1) warn('C02b', `${rel} §1 declares ${docRows.length} source documents — one file per document keeps the version pin unambiguous`)

  const docPath = abs(linkTarget(docRows[0][0]))
  const pinned = clean(docRows[0][1]).replace(/^v/, '')
  if (!fs.existsSync(docPath)) ledger('C03', `${rel} §1 source document not on disk: ${docRows[0][0]}`)
  // Two-part pins are accepted: a document that holds released behavior rather
  // than one release carries a rolling revision number (1.4), not a semantic
  // version. Demanding three parts here would silently disable C15 for exactly
  // those documents — the pin fails C04, and C15 then finds nothing to compare.
  if (!/\d+\.\d+(\.\d+)?/.test(pinned)) ledger('C04', `${rel} §1 pins no version — the baseline these verdicts rest on is unrecorded`)

  // C15: the ledger's pin vs the source document's actual Document Control.
  // Without this, an upstream bump leaves every verdict describing superseded
  // text while the whole file still reads green. `Version` and `Revision` are
  // both read, since the field name differs between a release-scoped document
  // and one that states current behavior.
  const chapter = read(docPath)
  if (chapter && /\d/.test(pinned)) {
    const m = /^\|\s*(?:Version|Revision)\s*\|\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)\s*\|/m.exec(chapter)
    if (m && !sameVersion(m[1], pinned)) {
      ledger('C15', `${rel} pins v${pinned} but ${path.relative(opt.root, docPath)} is now v${m[1]} — re-atomize; every verdict below may describe superseded rule text`)
    }
  }

  // §2 is parsed by header name so an optional TC-ID(s) column can be added
  // without shifting anything.
  const rows2 = tableRows(s.get(2))
  const hdr = rows2.find(r => /^atom$/i.test(r[0] ?? ''))
  if (!hdr) { ledger('C05', `${rel} §2 has no "| Atom | ..." header row`); continue }
  const col = {}
  hdr.forEach((h, i) => { col[clean(h).toLowerCase()] = i })
  for (const need of ['field', 'statement', 'status', 'covered by']) {
    if (col[need] === undefined) ledger('C05', `${rel} §2 header is missing a "${need}" column`)
  }

  const hasTC = col['tc-id(s)'] !== undefined
  const s4 = s.get(4) || ''
  const s4Atoms = new Set(tableRows(s4).map(r => clean(r[0])).filter(x => ATOM.test(x)))
  // Full §4 row text per atom. A row excuses a missing TEST only if it names the
  // test that will cover it — the row itself is about coverage, and merely
  // existing says nothing about whether anything exercises the Scenario.
  const s4Text = new Map()
  for (const r of tableRows(s4)) {
    const id = clean(r[0])
    if (ATOM.test(id)) s4Text.set(id, r.join(' '))
  }
  const namesATest = id => /TC-[A-Z0-9-]+-\d{3}|\b\w+(?:Test|Tests|IT|Spec)\b/.test(s4Text.get(id) ?? '')
  const dataRows = rows2.filter(r => ATOM.test(clean(r[0])) || /^BR-/.test(clean(r[0])))
  if (!dataRows.length) ledger('C05', `${rel} §2 has no atom rows`)

  for (const r of dataRows) {
    const id = clean(r[0])
    if (!ATOM.test(id)) { ledger('C06', `${rel}: malformed atom id "${id}"`); continue }
    if (atoms.has(id)) { ledger('C07', `${id} appears twice (${atoms.get(id).file}, ${rel})`); continue }

    const field = clean(r[col.field])
    const stmt = clean(r[col.statement])
    const rawStatus = clean(r[col.status])
    const by = clean(r[col['covered by']])
    const ev = col.evidence !== undefined ? clean(r[col.evidence]) : ''
    const tcs = col['tc-id(s)'] !== undefined ? clean(r[col['tc-id(s)']]) : ''

    if (field && !FIELDS.has(field)) warn('C10', `${id}: unrecognized source field "${field}"`)
    if (ruleDoc.size && !ruleDoc.has(baseRule(id))) ledger('C08', `${id}: rule ${baseRule(id)} is not in the rules index (stale or invented id)`)
    // C17: the index moved this rule to another document, but its atom is still
    // here. That is an upstream merge whose ledger half was not done — and left
    // alone, C16 reports the target document as unledgered and invites seeding a
    // fresh ledger, which duplicates every atom instead of moving it.
    else if (ruleDoc.size && ruleDoc.get(baseRule(id)) !== docPath) {
      const target = ruleDoc.get(baseRule(id))
      const key = `${rel} -> ${target}`
      if (!stranded.has(key)) stranded.set(key, { ledgerRel: rel, target, ids: [] })
      stranded.get(key).ids.push(id)
    }
    if (blank(stmt)) ledger('C11', `${id}: empty Statement`)

    const status = STATUS[rawStatus]
    if (!status) { ledger('S05', `${id}: status "${rawStatus}" is not in the vocabulary (expected e.g. ${RENDER.covered})`); continue }

    const a = { field, stmt, status, by, ev, tcs, file: rel, docPath }
    atoms.set(id, a)

    // ── coverage path
    if (['covered', 'partial', 'contradiction'].includes(status)) {
      if (blank(by)) { ledger('S06', `${id}: status ${status} with no "Covered by" path`); continue }
      const parts = seg(by)
      if (parts.length < 4) {
        warn('S06c', `${id}: "Covered by" should be <change> › <capability> › <Requirement> › <Scenario>`)
      }
      const [chg, , reqName, scName] = parts.length >= 4 ? parts : [null, null, parts[1], parts[2]]
      a.change = chg
      a.scenario = scName
      if (chg && !knownChanges.has(chg)) {
        ledger('S06b', `${id}: "Covered by" names change "${chg}", which exists neither under openspec/changes/ nor archived`)
      } else if (chg && reqName && !reqIndex.has(`${chg}|${nameKey(reqName)}`)) {
        ledger('S06b', `${id}: "Covered by" cites Requirement "${reqName}", which ${chg} does not declare`)
      } else if (reqName) {
        tracedReq.add(`${chg}|${nameKey(reqName)}`)
      }

      // ── evidence must be quotable AND still present in the cited spec
      if (status === 'covered' && (blank(ev) || !QUOTED.test(ev) || ev.length < 10)) {
        ledger('S07', `${id}: covered without a verbatim quote in Evidence — downgrade it or paste the text`)
      }
      const rq = reqName ? reqIndex.get(`${chg}|${nameKey(reqName)}`) : null
      const scen = rq && scName ? rq.scenarios.find(x => nameKey(x.name) === nameKey(scName)) : null
      if (rq && scName && !scen) {
        ledger('S06d', `${id}: "Covered by" cites Scenario "${scName}", which ${reqName} does not declare`)
      }

      // Prefer the named Scenario, but fall back to the whole requirement: a
      // `partial` is often carried by requirement prose that sits outside any
      // Scenario, and that is still a real quote.
      const hays = [scen && scen.body.join('\n'), rq && rq.body.join('\n')].filter(Boolean)
      if (hays.length && ev && QUOTED.test(ev)) {
        const q = /["“”]([^"“”]{10,})["“”]/.exec(ev)
        if (q && !hays.some(h => norm(h).includes(norm(q[1])))) {
          ledger('S22', `${id}: the Evidence quote is not in ${chg} › ${reqName}${scName ? ` › ${scName}` : ''} — the spec changed under this verdict, or the quote was never there`)
        }
      }

      // Anchor check, keyed per Scenario.
      if (scen) {
        if (!scen.source.size) noAnchor.set(`${chg}|${reqName}|${scName}`, { rq, scen })
        else if (!scen.source.has(baseRule(id))) missingRule.set(`${chg}|${reqName}|${scName}|${baseRule(id)}`, { rq, scen, rule: baseRule(id) })
      }
    }

    // ── findings write-up
    if (NEEDS_FINDING.has(status) && !s4Atoms.has(id)) {
      ledger('S08', `${id}: status ${status} is not written up in §4`)
    }
    if (status === 'covered' && s4Atoms.has(id)) {
      warn('S08b', `${id}: covered, but still has a stale §4 row — remove it`)
    }

    // ── optional TC column (stage 2)
    //
    // Only demanded once the column exists. Without it stage 2 has not run, and
    // requiring a TC everywhere would bury the file in findings for work not yet
    // started — same reasoning as the S09d orphan deferral.
    // A missing TC only means something once the owning change HAS a test-spec.
    // Before that, stage 2 has not run for it and every atom would report as
    // untested — the same premature-finding trap as the S09d orphan deferral.
    if (hasTC && ['covered', 'partial'].includes(status) && blank(tcs) && !namesATest(id)) {
      const owner = seg(by)[0]
      const hasSpec = owner && knownChanges.has(owner) &&
        testSpecFiles(knownChanges.get(owner).dir).length > 0
      if (hasSpec) untested.push(id)
      else noTestSpec.push(id)
    }
    for (const tc of tcs.split(/[,\s]+/).filter(x => x && !blank(x))) {
      if (!TC.test(tc)) { ledger('T05', `${id}: malformed TC-ID "${tc}"`); continue }
      const files = a.change && knownChanges.has(a.change)
        ? testSpecFiles(knownChanges.get(a.change).dir) : []
      if (files.length && !files.some(f => (read(f) ?? '').includes(tc))) {
        ledger('T06', `${id}: ${tc} does not appear in ${a.change}'s test spec`)
      }
    }
  }

  orphanSections.push(s.get(3) || '')
  declaredDocs.push({ rel, docPath })
}

// Cross-cutting checks run AFTER every ledger is parsed — inside the loop they
// would see a half-built picture as soon as a second domain file exists.

// ── un-atomized rules, in documents a ledger declares
{
  const atomized = new Set([...atoms.keys()].map(baseRule))
  for (const { rel, docPath } of declaredDocs) {
    for (const [id, doc] of ruleDoc) {
      if (doc === docPath && !atomized.has(id)) {
        ledger('C09', `${id} belongs to ${path.relative(opt.root, docPath)} but has no atom in ${rel} — whole rule missing from the ledger`)
      }
    }
  }
}

// ── documents with no ledger at all
//
// C09 only reaches rules whose document some ledger declares. A brand-new
// chapter is therefore invisible: no ledger names it, so none of its rules are
// ever asked about. This is the check that notices a functional spec grew.
// C17 first: it names the same target documents C16 would, but prescribes the
// opposite remedy. Moving the atoms is right; seeding a second ledger duplicates
// every one of them, and C07 would then report the collisions as the defect.
const strandedTargets = new Set()
for (const { ledgerRel, target, ids } of stranded.values()) {
  strandedTargets.add(target)
  const t = path.relative(opt.root, target)
  ledger('C17', `${ledgerRel} still holds ${ids.length} atom(s) (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''}) whose rules the index now maps to ${t} — MOVE those §2 rows into ${t}'s ledger, do not re-atomize them there`)
}

{
  const declared = new Set(declaredDocs.map(d => d.docPath))
  const missing = new Map()
  for (const [id, doc] of ruleDoc) {
    if (!doc || declared.has(doc) || strandedTargets.has(doc)) continue
    if (!missing.has(doc)) missing.set(doc, [])
    missing.get(doc).push(id)
  }
  for (const [doc, ids] of missing) {
    const rel = path.relative(opt.root, doc)
    ledger('C16', `${rel} holds ${ids.length} rule(s) (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ', …' : ''}) but no ledger in ${opt.coverage}/ declares it — seed openspec/coverage/${path.basename(doc)}`)
  }
}

// ── §3 orphans
//
// "No atom traces to this requirement" only means orphan once every atom has
// been looked at. While any atom is ⬜ pending, an untraced requirement is
// indistinguishable from one whose atom simply has not been reconciled yet, so
// computing orphans on partial data would flag every requirement of every
// unreconciled change. Defer rather than guess.
{
  const pending = [...atoms.values()].filter(a => a.status === 'pending').length
  if (!atoms.size) {
    // No atomization at all — every requirement would report as an orphan, which
    // is C01/C16's finding stated 68 more times. Same premature-finding trap as
    // the pending deferral below, just with the ledger missing entirely.
    warn('S09e', 'orphan detection skipped — no atoms parsed, so every requirement would read as untraced')
  } else if (pending) {
    warn('S09d', `orphan detection deferred — ${pending} atom(s) still pending, so an untraced requirement cannot yet be told apart from an unreconciled one`)
  } else {
    const s3Rows = tableRows(orphanSections.join('\n')).filter(r => (r[0] ?? '') && !/^requirement$/i.test(clean(r[0])))
    // Archived changes are history — their requirements are not orphans.
    for (const rq of live.filter(x => activeChanges.includes(x.change))) {
      if (tracedReq.has(`${rq.change}|${nameKey(rq.name)}`)) continue
      const row = s3Rows.find(r => nameKey(r[0]).includes(nameKey(rq.name)))
      if (!row) { ledger('S09', `orphan requirement "${rq.name}" (${rq.change} › ${rq.capability}) — no atom traces to it and §3 does not dispose it`); continue }
      const disp = clean(row[2] ?? '').toLowerCase()
      if (!disp || !DISPOSITIONS.some(d => disp.includes(d))) {
        gate('S10', `orphan requirement "${rq.name}" (${rq.change}): disposition must be "write new BR upstream" or "delete from spec"`)
      }
      if (blank(row[3] ?? '')) warn('S10b', `orphan requirement "${rq.name}" has no owner`)
    }
  }
}

for (const { rq, scen } of noAnchor.values()) {
  warn('S17', `${rq.change} › "${rq.name}" › "${scen.name}" covers atoms but declares no **Source:** anchor`)
}
for (const { rq, scen, rule } of missingRule.values()) {
  warn('S17', `${rq.change} › "${rq.name}" › "${scen.name}" covers ${rule} atoms but its anchor declares only ${[...scen.source].sort().join(', ')}`)
}

// ── anchors: MODIFIED must carry forward, placeholders must be filled ────────

for (const rq of live) {
  // anchors may sit on the requirement (legacy) or on any of its scenarios
  const holders = [{ label: `"${rq.name}"`, h: rq }, ...rq.scenarios.map(s => ({ label: `"${rq.name}" › "${s.name}"`, h: s }))]
  for (const { label, h } of holders) {
    if (h.placeholder) ledger('S20', `${rq.change} › ${label} still has the template's **Source:** placeholder comment — fill it in or delete the line`)
    for (const id of h.source) {
      if (ruleDoc.size && !ruleDoc.has(id)) ledger('S19', `${rq.change} › ${label} declares Source ${id}, which is not in the rules index`)
    }
  }
  if (rq.op !== 'MODIFIED') continue
  const livingPath = abs(path.join('openspec/specs', rq.capability, 'spec.md'))
  if (!fs.existsSync(livingPath)) continue
  // nameKey both sides: a heading carrying markdown would otherwise never match
  // its living counterpart, and a dropped anchor would go unreported.
  const prev = parseSpec(livingPath, '<living>', rq.capability).find(r => nameKey(r.name) === nameKey(rq.name))
  if (!prev) continue

  // Compare RULE SETS, not scenario names. MODIFIED replaces the requirement
  // wholesale — scenarios get renamed, split and merged — so matching scenario
  // by name silently finds nothing in exactly the case this check exists for.
  // What matters is whether the rewrite still references every rule the living
  // spec did.
  const rulesOf = r => new Set([...r.source, ...r.scenarios.flatMap(s => [...s.source])])
  const before = rulesOf(prev)
  const after = rulesOf(rq)
  const lost = [...before].filter(x => !after.has(x)).sort()
  if (lost.length) {
    ledger('S18', `${rq.change}: MODIFIED "${rq.name}" no longer references ${lost.join(', ')}, which openspec/specs/ anchors — MODIFIED is a full-text replace, re-add the Source line`)
  }
}

// ── gate ──────────────────────────────────────────────────────────────────────

const tally = {}
for (const a of atoms.values()) tally[a.status] = (tally[a.status] ?? 0) + 1

const uncovered = [...atoms].filter(([, a]) => a.status === 'uncovered').map(([id]) => id)

if (change) {
  if (!activeChanges.includes(change)) die(`not an active change: ${change}`)
  for (const [id, a] of atoms) {
    if (a.change !== change) continue
    if (a.status === 'contradiction') gate('S13', `${id}: this change's spec contradicts the rule — ${a.by}`)
    if (a.status === 'partial') warn('S15', `${id}: partial in this change — ${seg(a.by)[2] ?? ''}`)
    if (untested.includes(id)) {
      gate('T02', `${id}: covered by this change but no TC-ID and no §4 justification — a Scenario nothing exercises is not coverage`)
    }
  }
}
if (tally.deferred || tally['out-of-scope']) warn('S16', `${(tally.deferred ?? 0) + (tally['out-of-scope'] ?? 0)} atom(s) deferred/out-of-scope`)

report()

// ── report ────────────────────────────────────────────────────────────────────

function report (extra = {}) {
  const led = issues.filter(i => i.kind === 'ledger')
  const gat = issues.filter(i => i.kind === 'gate')
  const wrn = issues.filter(i => i.level === 'warn')
  const code = extra.na ? 0 : led.length ? 1 : gat.length ? 2 : 0

  if (opt.json) {
    say(JSON.stringify({
      change: change ?? null, ...extra, exit: code,
      atoms: atoms.size, tally, uncovered, ledger: led, gate: gat, warnings: wrn
    }, null, 2))
    flushAndExit(code)
  }

  say(`coverage-check${change ? ` — ${change}` : ' — domain only'}`)
  if (extra.na) { say(`\n  N/A: ${extra.na}`); flushAndExit(0) }

  // Collapse repeated codes. 35 identical warnings bury the one finding that
  // matters, and a wall of noise gets ignored wholesale.
  const dump = (title, list) => {
    if (!list.length) return
    say(`\n${title} (${list.length})`)
    const byCode = new Map()
    for (const i of list) { if (!byCode.has(i.code)) byCode.set(i.code, []); byCode.get(i.code).push(i) }
    for (const [code, group] of byCode) {
      if (group.length <= 5) { for (const i of group) say(`  ${code}  ${i.msg}`); continue }
      say(`  ${code}  ${group.length}× — showing 3:`)
      for (const i of group.slice(0, 3)) say(`        ${i.msg}`)
    }
  }
  dump('BOOKKEEPING — fix the ledger, a Source: anchor, or a spec', led)
  dump(`GATE FAIL${change ? ` — ${change} must fix these before the next artifact` : ''}`, gat)
  dump('WARNINGS', wrn)

  if (noTestSpec.length) {
    const by = new Map()
    for (const id of noTestSpec) {
      const c = seg(atoms.get(id).by)[0] ?? '?'
      by.set(c, (by.get(c) ?? 0) + 1)
    }
    say(`\nSTAGE 2 NOT DUE — ${noTestSpec.length} atom(s) in changes with no test spec yet`)
    for (const [c, n] of [...by].sort((a, b) => b[1] - a[1])) say(`  ${String(n).padStart(4)}  ${c}`)
  }

  if (untested.length) {
    say(`\nDOMAIN-LEVEL — ${untested.length} atom(s) covered by a Scenario that no test case exercises`)
    for (const id of untested.slice(0, 12)) say(`  ⬜ ${id}  ${seg(atoms.get(id).by)[0] ?? ''}`)
    if (untested.length > 12) say(`  … and ${untested.length - 12} more`)
  }

  if (uncovered.length) {
    say(`\nDOMAIN-LEVEL — ${uncovered.length} atom(s) covered by no change${change ? ` (not blocking ${change})` : ''}`)
    for (const id of uncovered.slice(0, 12)) say(`  ❌ ${id}  ${atoms.get(id).stmt.slice(0, 70)}`)
    if (uncovered.length > 12) say(`  … and ${uncovered.length - 12} more`)
    say('  Nobody implements these. Decide who does, or record why not in §4.')
  }

  const order = ['contradiction', 'uncovered', 'partial', 'covered', 'deferred', 'out-of-scope', 'retired', 'pending']
  const parts = order.filter(k => tally[k]).map(k => `${RENDER[k]} ${tally[k]}`)
  if (parts.length) say(`\nDOMAIN ROLLUP (${atoms.size} atoms) — ${parts.join(' · ')}`)

  say(code === 0 ? '\nOK — bookkeeping clean, gate PASS' : code === 1 ? '\nFAIL — bookkeeping broken' : '\nFAIL — gate blocked')
  flushAndExit(code)
}
