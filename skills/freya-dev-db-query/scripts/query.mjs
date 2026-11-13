#!/usr/bin/env node
// Read-only Freya tenant query through a local port-forward.
//
//   node query.mjs --sql "<SQL>" [--env dev] [--conn dev-db] [--tenant 0] [--kind rendition]
//   node query.mjs --sql-file query.sql [--database name]
//   node query.mjs --list
//   node query.mjs --tunnel-command [--env dev | --conn dev-db]
//
// Node 18+ and psql. Same flags on Windows and macOS.
// One file per connection: $HOME/.freya/<connection>.credentials (USERPROFILE on
// Windows). --env picks the file whose `envs` key lists that environment;
// --conn names the file directly. --host and --port override the file.
// FREYA_DEV_DB_HOST, FREYA_DEV_DB_PORT, FREYA_DEV_DB_USER and
// FREYA_DEV_DB_PASSWORD override the dev-db connection only. No password flag.
// This script never starts a tunnel and never calls the AWS CLI.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLACEHOLDER = /^(REPLACE_ME|REPLACE_WITH_YOUR_LOCAL_PORT|<[^>]*>)$/i
const BLOCKED_SQL = /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|CALL|COPY|VACUUM|INTO|SET|RESET|BEGIN|DO|EXECUTE|PREPARE|DEALLOCATE|LOCK)\b/i
const BLOCKED_CALL = /\b(set_config|setval|nextval)\s*\(/i
const EPOCH_MS_COLUMNS = new Set([
  'create_time',
  'update_time',
  'start_at',
  'end_at',
  'execution_deadline',
])
// Database name = prefix + tenant id. Keep in step with references/databases.md.
// A connection file can add or replace a prefix with db_prefix.<env>.<kind>.
const PREFIXES = {
  dev: { rendition: 'docs_rendition_dev_tenant_', docs: 'docs_dev_tenant_' },
  qa: { rendition: 'docs_rendition_qa_tenant_', docs: 'docs_qa_tenant_' },
  sqa: { rendition: 'ff-docs-docs-rendition-sqa-rds', docs: 'ff-docs-docs-sqa-rds' },
  'dso-bridge': { rendition: 'ff-docs-docs-rendition-devsecops-rds', docs: 'ff-docs-docs-devsecops-rds' },
  'dso-sws': { docs: 'ff-silo-sws-dso-db-cluster' },
}
// Keys whose values may be printed. A redacted read keeps the value of these
// keys and of db_prefix.<env>.<kind> only; see scanCredentials.
export const SHOWN_KEYS = [
  'envs',
  'type',
  'host',
  'port',
  'aws_profile',
  'region',
  'target',
  'target_name',
  'remote_host',
  'remote_port',
  'auto_start',
  'auto_reconnect',
]
export const LOGIN_KEYS = ['username', 'password']
export const TYPES = ['postgres', 'redis', 'tcp']
const PREFIX_KEY = /^db_prefix\.([a-z0-9][a-z0-9_-]*)\.([a-z0-9][a-z0-9_-]*)$/
const REDACTED = '***'
// What a tunnel key may look like. A value that does not fit is never printed.
const FORMATS = {
  target: /^m?i-[0-9a-f]+$/,
  target_name: /^[A-Za-z0-9._-]+$/,
  remote_host: /^[A-Za-z0-9.-]+$/,
  remote_port: /^\d{1,5}$/,
  aws_profile: /^[A-Za-z0-9._@+-]+$/,
  region: /^[a-z0-9-]+$/,
}
const DEFAULT_ENV = 'dev'
const DEFAULT_KIND = 'rendition'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_REGION = 'us-east-1'
const LEGACY_CONNECTION = 'dev-db'
// Files written before the `envs` key existed: dev-db served both dev and qa.
const LEGACY_ENVS = { [LEGACY_CONNECTION]: ['dev', 'qa'] }
export const FILE_SUFFIX = '.credentials'
export const NAME = /^[a-z0-9][a-z0-9._-]*$/
const DATABASE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/
const TUNNEL_DOCUMENT = 'AWS-StartPortForwardingSessionToRemoteHost'

export function configDir() {
  return path.join(os.homedir(), '.freya')
}

export function credentialsPath(name = LEGACY_CONNECTION) {
  return path.join(configDir(), name + FILE_SUFFIX)
}

export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

export function assertReadOnlySql(sql) {
  if (sql.includes('\0')) {
    throw new Error('Refusing SQL that contains a NUL byte.')
  }
  if (sql.includes('\\')) {
    throw new Error('Refusing SQL that contains a backslash. psql meta-commands are not allowed.')
  }
  const normalized = stripSqlComments(sql)
  if (!normalized.trim()) {
    throw new Error('SQL is empty.')
  }
  const blocked = normalized.match(BLOCKED_SQL)
  if (blocked) {
    throw new Error(`Refusing non-read SQL (found ${blocked[1].toUpperCase()}). This skill does not run writes.`)
  }
  const blockedCall = normalized.match(BLOCKED_CALL)
  if (blockedCall) {
    throw new Error(`Refusing ${blockedCall[1]}(). This skill does not run writes.`)
  }
}

// The value, or '' when it is empty or still a placeholder.
export function real(value) {
  return value && !PLACEHOLDER.test(value) ? value : ''
}

// Built-in prefixes plus the db_prefix.<env>.<kind> keys of one connection file.
export function prefixTable(fileMap = {}) {
  const table = {}
  for (const [env, kinds] of Object.entries(PREFIXES)) table[env] = { ...kinds }
  for (const [key, raw] of Object.entries(fileMap)) {
    const match = key.match(PREFIX_KEY)
    const value = real(raw)
    if (!match || !value) continue
    if (!DATABASE_NAME.test(value)) {
      throw new Error(`${key} must contain only letters, digits, underscores, and hyphens.`)
    }
    table[match[1]] = { ...table[match[1]], [match[2]]: value }
  }
  return table
}

export function resolveDatabaseName({ database, environment, kind, tenant, prefixes = PREFIXES }) {
  if (database) {
    if (!DATABASE_NAME.test(database)) {
      throw new Error('Database name must contain only letters, digits, underscores, and hyphens.')
    }
    return database
  }
  if (!/^\d+$/.test(tenant)) {
    throw new Error(`Tenant id must be numeric. Got: ${tenant}`)
  }
  const override = 'Pass --database <full name>, or add db_prefix.<env>.<kind>=<prefix> to the connection file.'
  if (!environment) {
    throw new Error(`No environment to build a database name from. Pass --env.\n${override}`)
  }
  const kinds = prefixes[environment]
  if (!kinds || Object.keys(kinds).length === 0) {
    throw new Error(
      `No database prefix is known for env ${environment}. Known envs: ${Object.keys(prefixes).join(', ')}.\n${override}`,
    )
  }
  const names = Object.keys(kinds)
  // Without --kind: rendition where the env has it, else the env's only kind.
  const chosen = kind || (kinds[DEFAULT_KIND] ? DEFAULT_KIND : names.length === 1 ? names[0] : '')
  if (!chosen) {
    throw new Error(`Env ${environment} has several database kinds: ${names.join(', ')}. Pass --kind.`)
  }
  if (!kinds[chosen]) {
    throw new Error(
      `No ${chosen} database prefix is known for env ${environment}. Known kinds: ${names.join(', ')}.\n${override}`,
    )
  }
  return kinds[chosen] + tenant
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

// The known key a mistyped key most likely meant, or ''.
function nearestKnownKey(key) {
  if (key.startsWith('db_prefix')) return 'db_prefix.<env>.<kind>'
  let best = ''
  let bestDistance = 3
  for (const known of [...SHOWN_KEYS, ...LOGIN_KEYS]) {
    const distance = editDistance(key, known)
    if (distance < bestDistance) {
      best = known
      bestDistance = distance
    }
  }
  return best
}

// Line-level read of a connection file.
//
// With `redact`, nothing sensitive leaves this function: a username or
// password is replaced by a marker that only says whether it is filled in,
// and a key the script does not know is dropped with its value, because it
// may be a mistyped login key or a pasted secret. Such a line is reported by
// number only. Everything except the query itself reads files this way.
export function scanCredentials(text, { redact = false } = {}) {
  const map = Object.create(null)
  const duplicates = []
  const malformed = []
  const unknown = []
  // Files saved by Windows editors may start with a byte-order mark.
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const eq = line.indexOf('=')
    if (eq === -1) {
      malformed.push(index + 1)
      return
    }
    const key = line.slice(0, eq).trim().toLowerCase()
    let value = line.slice(eq + 1).trim()
    const login = LOGIN_KEYS.includes(key)
    if (!login && !SHOWN_KEYS.includes(key) && !PREFIX_KEY.test(key)) {
      unknown.push({ line: index + 1, near: nearestKnownKey(key) })
      if (redact) return
    }
    if (redact && login) {
      value = real(value) ? REDACTED : value ? 'REPLACE_ME' : ''
    }
    if (key in map && !duplicates.includes(key)) duplicates.push(key)
    map[key] = value
  })
  return { map, duplicates, malformed, unknown }
}

export function parseCredentials(text) {
  return scanCredentials(text).map
}

// Names from a comma-separated value. An entry that is not a plain name is
// dropped: it could never match --env, and it must not be echoed back.
function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => real(item) && NAME.test(item))
}

function describe(connection) {
  return `${connection.name} (${connection.envs.length ? connection.envs.join(', ') : 'no envs'})`
}

// One connection per <name>.credentials file in the config directory.
// Pass { redact: true } unless the caller is about to log in to the database.
export function readConnections(dir = configDir(), { redact = false } = {}) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const connections = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(FILE_SUFFIX)) continue
    const name = entry.name.slice(0, -FILE_SUFFIX.length).toLowerCase()
    if (!NAME.test(name)) continue
    const filePath = path.join(dir, entry.name)
    const scan = scanCredentials(fs.readFileSync(filePath, 'utf8'), { redact })
    const declared = parseList(scan.map.envs)
    connections.push({
      name,
      filePath,
      ...scan,
      declared,
      envs: declared.length ? declared : LEGACY_ENVS[name] || [],
    })
  }
  return connections.sort((a, b) => a.name.localeCompare(b.name))
}

// Pick the connection for --conn or --env. Returns { connection, env }.
export function selectConnection(connections, { conn, env, dir = configDir() }) {
  const found = connections.length ? connections.map(describe).join('; ') : 'none'
  if (conn) {
    const connection = connections.find((item) => item.name === conn)
    if (!connection) {
      throw new Error(
        `No connection file ${conn}${FILE_SUFFIX} in ${dir}. Connections found: ${found}.\n` +
          `Create it with: node scripts/init-config.mjs --conn ${conn}`,
      )
    }
    if (env && connection.declared.length && !connection.declared.includes(env)) {
      throw new Error(`Connection ${conn} serves ${connection.declared.join(', ')}, not ${env}.`)
    }
    return { connection, env: env || connection.envs[0] || '' }
  }
  const wanted = env || DEFAULT_ENV
  // A file that names the env wins over the dev-db legacy default.
  let matches = connections.filter((item) => item.declared.includes(wanted))
  if (matches.length === 0) matches = connections.filter((item) => item.envs.includes(wanted))
  if (matches.length > 1) {
    throw new Error(
      `Env ${wanted} is declared by several connections: ${matches.map((item) => item.name).join(', ')}. Pass --conn.`,
    )
  }
  if (matches.length === 1) return { connection: matches[0], env: wanted }
  if (LEGACY_ENVS[LEGACY_CONNECTION].includes(wanted)) {
    // First run: point at the file init-config.mjs creates by default.
    const missing = {
      name: LEGACY_CONNECTION,
      filePath: credentialsPath(LEGACY_CONNECTION),
      map: {},
      declared: [],
      envs: LEGACY_ENVS[LEGACY_CONNECTION],
    }
    return { connection: missing, env: wanted }
  }
  throw new Error(
    `No connection in ${dir} declares env ${wanted}. Connections found: ${found}.\n` +
      `Add ${wanted} to the envs key of the file whose tunnel reaches it, pass --conn <name>,\n` +
      `or create a file with: node scripts/init-config.mjs --conn <name> --envs ${wanted}`,
  )
}

function assertReal(label, value, connection) {
  if (!real(value)) {
    const legacy =
      connection.name === LEGACY_CONNECTION
        ? 'Env overrides: FREYA_DEV_DB_HOST, FREYA_DEV_DB_PORT, FREYA_DEV_DB_USER, FREYA_DEV_DB_PASSWORD.\n'
        : ''
    throw new Error(
      `Missing or placeholder ${label} for connection ${connection.name}.\n` +
        `Edit ${connection.filePath} (create it with scripts/init-config.mjs --conn ${connection.name} if needed).\n` +
        'Required keys: port, username, password.\n' +
        legacy +
        'Do not paste secrets into chat.',
    )
  }
}

function parsePort(label, text) {
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== String(text)) {
    // The bad value is not echoed: it may be something pasted into the wrong key.
    throw new Error(`${label} must be an integer 1-65535.`)
  }
  return port
}

// Local end of the tunnel. `needLogin: false` skips the username and password.
export function loadConnection({ connection, cliHost, cliPort, needLogin = true }) {
  const fileMap = connection.map
  const fromEnv = (name) => (connection.name === LEGACY_CONNECTION ? process.env[name] : '')
  const pick = (name, envValue, cliValue) => cliValue || envValue || fileMap[name] || ''
  const host = real(pick('host', fromEnv('FREYA_DEV_DB_HOST'), cliHost)) || DEFAULT_HOST
  const portText = pick('port', fromEnv('FREYA_DEV_DB_PORT'), cliPort)
  assertReal('port', portText, connection)
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) {
    throw new Error('host must be a hostname or IP address, with no spaces.')
  }
  const port = parsePort('port', portText)
  if (!needLogin) return { host, port, username: '', password: '' }
  const username = pick('username', fromEnv('FREYA_DEV_DB_USER'), '')
  const password = pick('password', fromEnv('FREYA_DEV_DB_PASSWORD'), '')
  assertReal('username', username, connection)
  assertReal('password', password, connection)
  if (/[\r\n]/.test(username) || /[\r\n]/.test(password)) {
    throw new Error('username and password must be a single line.')
  }
  return { host, port, username, password }
}

// The command the user runs to open this connection's tunnel. Printed, never run.
export function tunnelCommand(connection, localPort) {
  const map = connection.map
  const target = real(map.target)
  const remoteHost = real(map.remote_host)
  const remotePort = real(map.remote_port)
  const profile = real(map.aws_profile)
  const region = real(map.region) || DEFAULT_REGION
  const missing = []
  if (!target) missing.push(real(map.target_name) ? 'target (only target_name is set)' : 'target')
  if (!remoteHost) missing.push('remote_host')
  if (!remotePort) missing.push('remote_port')
  if (missing.length) return { command: '', missing }
  const checks = [
    ['target', target],
    ['remote_host', remoteHost],
    ['remote_port', remotePort],
    ['aws_profile', profile || 'default'],
    ['region', region],
  ]
  for (const [label, value] of checks) {
    if (!FORMATS[label].test(value)) {
      throw new Error(`${label} in ${connection.filePath} is not a valid value.`)
    }
  }
  const parameters = JSON.stringify({
    host: [remoteHost],
    portNumber: [remotePort],
    localPortNumber: [String(localPort)],
  })
  const command =
    'aws ssm start-session' +
    (profile ? ` --profile ${profile}` : '') +
    ` --region ${region} --target ${target} --document-name ${TUNNEL_DOCUMENT}` +
    ` --parameters '${parameters}'`
  return { command, missing: [] }
}

function tunnelHelp(connection, localPort) {
  const { command, missing } = tunnelCommand(connection, localPort)
  if (command) {
    return `The user starts the tunnel; the agent never does. Command for the user:\n  ${command}`
  }
  return (
    `The user starts the tunnel; the agent never does.\n` +
    `${connection.filePath} lacks ${missing.join(', ')}, so no command can be shown. See references/tunnel.md.`
  )
}

export function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let quoted = false
  const pushField = () => {
    row.push(quoted ? field : field === '' ? null : field)
    field = ''
    quoted = false
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      quoted = true
      continue
    }
    if (c === ',') {
      pushField()
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++
      pushField()
      rows.push(row)
      row = []
      continue
    }
    field += c
  }
  if (inQuotes) {
    throw new Error('psql CSV ended inside a quoted field.')
  }
  if (field !== '' || quoted || row.length > 0) {
    pushField()
    rows.push(row)
  }
  return rows
}

function formatShanghai(millis) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }).formatToParts(new Date(millis))
  const pick = (type) => {
    const part = parts.find((item) => item.type === type)
    if (!part) throw new Error(`Could not format timestamp (missing ${type}).`)
    return part.value
  }
  const hour = pick('hour') === '24' ? '00' : pick('hour')
  return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')}:${pick('second')}.${pick('fractionalSecond')}`
}

export function formatCell(column, value) {
  if (value === null) return 'NULL'
  const text = String(value).replace(/[\t\r\n]/g, ' ')
  if (!EPOCH_MS_COLUMNS.has(String(column).toLowerCase())) return text
  if (!/^\d+$/.test(text)) return text
  const millis = Number(text)
  if (!Number.isSafeInteger(millis)) return text
  if (millis < 1_000_000_000_000 || millis >= 100_000_000_000_000) return text
  return `${text} (${formatShanghai(millis)} +08:00)`
}

export function tcpOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export function findPsql() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const names = process.platform === 'win32' ? ['psql.exe', 'psql.cmd', 'psql'] : ['psql']
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name)
      try {
        if (fs.statSync(full).isFile()) return full
      } catch {
        // keep looking
      }
    }
  }
  if (process.platform === 'darwin') {
    for (const full of ['/opt/homebrew/opt/libpq/bin/psql', '/usr/local/opt/libpq/bin/psql']) {
      try {
        if (fs.statSync(full).isFile()) return full
      } catch {
        // keep looking
      }
    }
  }
  return null
}

function runPsql(bin, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out = []
    const err = []
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      })
    })
  })
}

function redact(text, secret) {
  if (!secret || !text) return text
  return text.split(secret).join('***')
}

function usage() {
  return `Usage: node query.mjs --sql "<SQL>" [--env dev] [--conn name] [--tenant 0] [--kind rendition|docs] [--database name] [--host h] [--port n]
       node query.mjs --sql-file <path> [same options]
       node query.mjs --list
       node query.mjs --tunnel-command [--env dev | --conn name]

Reads .freya/<connection>.credentials in the user home directory, one file per
connection. --env picks the file whose envs key lists that environment; --conn
names the file. Queries require psql. Nothing here starts a tunnel.`
}

// One row per connection file. Never prints a username or a password.
async function listConnections() {
  const dir = configDir()
  const connections = readConnections(dir, { redact: true })
  if (connections.length === 0) {
    console.log(`No connection files (*${FILE_SUFFIX}) in ${dir}.`)
    console.log('Create one with: node scripts/init-config.mjs')
    return
  }
  console.log(
    ['CONNECTION', 'ENVS', 'TYPE', 'LOCAL', 'TUNNEL', 'AWS_PROFILE', 'REGION', 'TARGET', 'REMOTE', 'LOGIN'].join('\t'),
  )
  for (const connection of connections) {
    const map = connection.map
    let local = '-'
    let tunnel = 'port not set'
    try {
      const conn = loadConnection({ connection, needLogin: false })
      local = `${conn.host}:${conn.port}`
      tunnel = (await tcpOpen(conn.host, conn.port, 1000)) ? 'open' : 'closed'
    } catch {
      // Leave the placeholders: the file has no usable port yet.
    }
    // A value is printed only when it has the expected shape; a secret typed
    // into the wrong key shows as "invalid".
    const shown = (key, fallback = '-') => {
      const value = real(map[key])
      if (!value) return fallback
      return FORMATS[key].test(value) ? value : 'invalid'
    }
    const remote = real(map.remote_host) ? `${shown('remote_host')}:${shown('remote_port', '?')}` : '-'
    const rawType = (real(map.type) || 'postgres').toLowerCase()
    const type = TYPES.includes(rawType) ? rawType : 'invalid'
    const login = real(map.username) && real(map.password) ? 'set' : rawType === 'postgres' ? 'missing' : '-'
    const envs = connection.envs.map((env) => (NAME.test(env) ? env : 'invalid')).join(',')
    console.log(
      [
        connection.name,
        envs || '-',
        type,
        local,
        tunnel,
        shown('aws_profile'),
        shown('region', DEFAULT_REGION),
        real(map.target) ? shown('target') : shown('target_name'),
        remote,
        login,
      ].join('\t'),
    )
  }
  console.log(`CONNECTION_COUNT=${connections.length}`)
}

function parseArgs(argv) {
  const out = {
    sql: '',
    sqlFile: '',
    database: '',
    tenant: '0',
    kind: '',
    env: '',
    conn: '',
    host: '',
    port: '',
    list: false,
    tunnelCommand: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const take = () => {
      const value = argv[++i]
      if (value === undefined) throw new Error(`Missing value for ${arg}\n${usage()}`)
      return value
    }
    switch (arg) {
      case '--help':
      case '-h':
        out.help = true
        break
      case '--sql':
        out.sql = take()
        break
      case '--sql-file':
        out.sqlFile = take()
        break
      case '--database':
        out.database = take()
        break
      case '--tenant':
        out.tenant = take()
        break
      case '--kind':
        out.kind = take().toLowerCase()
        break
      case '--env':
        out.env = take().toLowerCase()
        break
      case '--conn':
        out.conn = take().toLowerCase()
        break
      case '--list':
        out.list = true
        break
      case '--tunnel-command':
        out.tunnelCommand = true
        break
      case '--host':
        out.host = take()
        break
      case '--port':
        out.port = take()
        break
      default:
        throw new Error(`Unknown argument: ${arg}\n${usage()}`)
    }
  }
  return out
}

function isDirectRun() {
  if (!process.argv[1]) return false
  const entry = path.resolve(process.argv[1])
  const self = fileURLToPath(import.meta.url)
  if (entry === self) return true
  return process.platform === 'win32' && entry.toLowerCase() === self.toLowerCase()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  for (const [flag, value] of [['--kind', args.kind], ['--env', args.env], ['--conn', args.conn]]) {
    if (value && !NAME.test(value)) {
      throw new Error(`${flag} must be letters, digits, dots, underscores, and hyphens. Got: ${value}`)
    }
  }
  if (args.list) {
    await listConnections()
    return
  }
  // Only a real query needs the login; everything else reads the files redacted.
  const connections = readConnections(configDir(), { redact: args.tunnelCommand })
  const { connection, env } = selectConnection(connections, { conn: args.conn, env: args.env })
  if (args.tunnelCommand) {
    const local = loadConnection({ connection, cliHost: args.host, cliPort: args.port, needLogin: false })
    console.log(`Connection ${connection.name}, local ${local.host}:${local.port}`)
    console.log(tunnelHelp(connection, local.port))
    return
  }
  if (Boolean(args.sql) === Boolean(args.sqlFile)) {
    throw new Error(`Pass exactly one of --sql or --sql-file.\n${usage()}`)
  }
  const sql = args.sqlFile ? fs.readFileSync(args.sqlFile, 'utf8') : args.sql
  assertReadOnlySql(sql)
  const type = (real(connection.map.type) || 'postgres').toLowerCase()
  if (!TYPES.includes(type)) {
    throw new Error(`Connection ${connection.name} has an invalid type. Use ${TYPES.join(', ')}.`)
  }
  if (type !== 'postgres') {
    throw new Error(`Connection ${connection.name} is type ${type}. This skill queries PostgreSQL only.`)
  }
  const database = resolveDatabaseName({
    database: args.database,
    environment: env,
    kind: args.kind,
    tenant: args.tenant,
    prefixes: prefixTable(connection.map),
  })
  const conn = loadConnection({ connection, cliHost: args.host, cliPort: args.port })
  const open = await tcpOpen(conn.host, conn.port, 1000)
  if (!open) {
    throw new Error(
      `Local tunnel for connection ${connection.name} is not reachable at ${conn.host}:${conn.port} within 1000ms.\n` +
        tunnelHelp(connection, conn.port),
    )
  }
  const psql = findPsql()
  if (!psql) {
    throw new Error(
      'psql was not found on PATH.\n' +
        'macOS: brew install libpq, and put its bin directory on PATH (Apple Silicon: /opt/homebrew/opt/libpq/bin).\n' +
        'Windows: install the PostgreSQL client tools and add that bin directory to PATH.',
    )
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-dev-db-'))
  const sqlFile = path.join(dir, 'query.sql')
  const started = Date.now()
  try {
    fs.writeFileSync(sqlFile, sql, { encoding: 'utf8', mode: 0o600 })
    console.log(`Connecting ${conn.host}:${conn.port}/${database} (connection ${connection.name})`)
    const result = await runPsql(
      psql,
      [
        '-X',
        '-q',
        '-w',
        '-v',
        'ON_ERROR_STOP=1',
        '--csv',
        '-P',
        'pager=off',
        '-h',
        conn.host,
        '-p',
        String(conn.port),
        '-U',
        conn.username,
        '-d',
        database,
        '-f',
        sqlFile,
      ],
      {
        ...process.env,
        PGPASSWORD: conn.password,
        PGCONNECT_TIMEOUT: '5',
        PGCLIENTENCODING: 'UTF8',
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=60s',
      },
    )
    if (result.code !== 0) {
      const detail = redact((result.stderr || result.stdout).trim(), conn.password) || `exit ${result.code}`
      throw new Error(`psql failed: ${detail}`)
    }
    const rows = parseCsv(result.stdout)
    if (rows.length === 0 || rows[0].length === 0) {
      throw new Error('psql returned no header row.')
    }
    const header = rows[0].map((cell) => (cell === null ? '' : cell))
    const data = rows.slice(1).filter((row) => !(row.length === 1 && row[0] === null && header.length > 1))
    console.log(header.join('\t'))
    for (const row of data) {
      const cells = header.map((column, index) => formatCell(column, row[index] ?? null))
      console.log(cells.join('\t'))
    }
    console.log(`ROW_COUNT=${data.length}`)
    console.log(`QUERY_MS=${Date.now() - started}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
