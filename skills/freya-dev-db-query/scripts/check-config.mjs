#!/usr/bin/env node
// Check the connection files in .freya under the user home directory and say
// what would stop a query.
//
//   node check-config.mjs
//
// The output is safe to paste anywhere. It names files, line numbers, and
// known keys. It never prints a username or a password, never prints a value
// that failed a check, and never prints anything from a line it does not
// recognise. Files are read redacted (see scanCredentials in query.mjs).
//
// Exit 0 when no line is an ERROR, 1 otherwise. Starts no tunnel and never
// calls the AWS CLI.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import {
  FILE_SUFFIX,
  LOGIN_KEYS,
  NAME,
  TYPES,
  configDir,
  findPsql,
  prefixTable,
  readConnections,
  real,
  tcpOpen,
  tunnelCommand,
} from './query.mjs'

const LEGACY_CONNECTION = 'dev-db'
// Environment variables that override the dev-db file, by key.
const OVERRIDES = {
  host: 'FREYA_DEV_DB_HOST',
  port: 'FREYA_DEV_DB_PORT',
  username: 'FREYA_DEV_DB_USER',
  password: 'FREYA_DEV_DB_PASSWORD',
}
const TUNNEL_KEYS = ['aws_profile', 'target', 'target_name', 'remote_host', 'remote_port']
const MIN_NODE = 18
const MIN_PSQL = 12

const records = []
const add = (level, scope, message) => records.push({ level, scope, message })

// Whether a setting is filled in, and where from. The value itself is returned
// only for keys that are safe to show.
function setting(connection, key) {
  const variable = connection.name === LEGACY_CONNECTION ? OVERRIDES[key] : ''
  const fromEnv = variable ? process.env[variable] || '' : ''
  const raw = fromEnv || connection.map[key] || ''
  const source = fromEnv ? variable : 'the file'
  const state = real(raw) ? 'set' : raw ? 'placeholder' : 'missing'
  return { state, source, value: LOGIN_KEYS.includes(key) ? '' : real(raw) }
}

function checkTools() {
  const major = Number(process.versions.node.split('.')[0])
  if (major >= MIN_NODE) add('OK', '-', `node ${process.versions.node}`)
  else add('ERROR', '-', `node ${process.versions.node} is too old; ${MIN_NODE} or newer is required`)

  const psql = findPsql()
  if (!psql) {
    add('ERROR', '-', `psql was not found on PATH; queries cannot run. Install the PostgreSQL client tools, ${MIN_PSQL} or newer`)
    return
  }
  const result = spawnSync(psql, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
  const version = result.status === 0 ? (result.stdout.match(/(\d+)(\.\d+)*/) || [])[0] : ''
  if (!version) add('WARN', '-', 'psql is on PATH but `psql --version` did not answer')
  else if (Number(version.split('.')[0]) < MIN_PSQL) add('WARN', '-', `psql ${version} is older than ${MIN_PSQL}`)
  else add('OK', '-', `psql ${version}`)
}

function checkDirectory(dir, { required }) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    if (required) {
      add('ERROR', '-', `${dir} does not exist. Create a connection file with: node scripts/init-config.mjs`)
    }
    return false
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(FILE_SUFFIX)) continue
    const name = entry.name.slice(0, -FILE_SUFFIX.length).toLowerCase()
    if (!NAME.test(name)) {
      add('WARN', '-', `a file ending in ${FILE_SUFFIX} is skipped: its name must be letters, digits, dots, underscores, and hyphens`)
    }
  }
  return true
}

function checkLines(connection) {
  const { name, malformed, unknown, duplicates } = connection
  if (malformed.length) {
    add('WARN', name, `line ${malformed.join(', ')}: not key=value, ignored (content not shown)`)
  }
  for (const item of unknown) {
    if (item.near) {
      add('WARN', name, `line ${item.line}: unknown key, probably meant ${item.near}; ignored (content not shown)`)
    } else {
      add('NOTE', name, `line ${item.line}: a key this skill does not use (content not shown)`)
    }
  }
  for (const key of duplicates) {
    add('WARN', name, `${key} appears more than once; the last one is used`)
  }
}

function checkType(connection) {
  const type = (real(connection.map.type) || 'postgres').toLowerCase()
  if (!TYPES.includes(type)) {
    add('ERROR', connection.name, `type is not one of ${TYPES.join(', ')}`)
    return ''
  }
  if (type !== 'postgres') add('NOTE', connection.name, `type ${type}: the query script does not use this connection`)
  return type
}

function checkEnvs(connection, type) {
  const { name, map, declared, envs } = connection
  const listed = String(map.envs || '').split(',').map((item) => item.trim().toLowerCase()).filter(real)
  if (listed.some((item) => !NAME.test(item))) {
    add('WARN', name, 'envs has a name that is not letters, digits, dots, underscores, and hyphens')
  }
  const valid = envs.filter((item) => NAME.test(item))
  if (valid.length === 0) {
    add('WARN', name, `no envs: --env cannot find this connection. Add envs=<env>[,<env>], or pass --conn ${name}`)
  } else if (declared.length === 0) {
    add('OK', name, `envs ${valid.join(', ')} (no envs key; ${name} defaults to these)`)
  } else {
    add('OK', name, `envs ${valid.join(', ')}`)
  }
  if (type !== 'postgres') return

  let table
  try {
    table = prefixTable(map)
  } catch (err) {
    add('ERROR', name, err instanceof Error ? err.message : String(err))
    return
  }
  for (const env of valid) {
    const kinds = Object.keys(table[env] || {})
    if (kinds.length) add('OK', name, `env ${env}: database kinds ${kinds.join(', ')}`)
    else add('WARN', name, `env ${env}: no database prefix is known. Pass --database, or add db_prefix.${env}.<kind>=<prefix>`)
  }
  for (const key of Object.keys(map)) {
    const match = key.match(/^db_prefix\.([^.]+)\./)
    if (match && !valid.includes(match[1])) {
      add('WARN', name, `${key}: ${match[1]} is not in this file's envs`)
    }
  }
}

// Returns the local address when it is usable, for the duplicate check.
async function checkLocalAddress(connection) {
  const { name } = connection
  const host = setting(connection, 'host')
  const port = setting(connection, 'port')
  const hostValue = host.value || '127.0.0.1'
  let usable = true
  if (!/^[A-Za-z0-9._:-]+$/.test(hostValue)) {
    add('ERROR', name, `host (from ${host.source}) is not a hostname or IP address`)
    usable = false
  }
  if (port.state !== 'set') {
    add('ERROR', name, `port is ${port.state === 'missing' ? 'missing' : 'still a placeholder'}; set it to the local port of the tunnel`)
    usable = false
  } else if (!/^\d{1,5}$/.test(port.value) || Number(port.value) < 1 || Number(port.value) > 65535) {
    add('ERROR', name, `port (from ${port.source}) is not an integer from 1 to 65535`)
    usable = false
  }
  if (!usable) return ''
  const address = `${hostValue}:${Number(port.value)}`
  const open = await tcpOpen(hostValue, Number(port.value), 1000)
  const origin = port.source === 'the file' ? '' : ` (port from ${port.source})`
  add('OK', name, `local address ${address}${origin}, tunnel ${open ? 'open' : 'closed'}`)
  return address
}

function checkLogin(connection) {
  const problems = []
  const sources = []
  for (const key of LOGIN_KEYS) {
    const item = setting(connection, key)
    if (item.state === 'set') {
      if (item.source !== 'the file') sources.push(`${key} from ${item.source}`)
    } else {
      problems.push(`${key} is ${item.state === 'missing' ? 'missing' : 'still a placeholder'}`)
    }
  }
  if (problems.length) {
    add('ERROR', connection.name, `${problems.join('; ')}. The user fills it in the file`)
  } else {
    const origin = sources.length ? ` (${sources.join(', ')})` : ''
    add('OK', connection.name, `username and password are set${origin}; values not kept or shown`)
  }
}

function checkTunnelKeys(connection) {
  const { name, map } = connection
  if (!TUNNEL_KEYS.some((key) => real(map[key]))) {
    add('NOTE', name, 'no tunnel keys: the tunnel command cannot be shown. Queries do not need them')
    return
  }
  try {
    const { command, missing } = tunnelCommand(connection, 1)
    if (!command) {
      add('NOTE', name, `the tunnel command cannot be shown: ${missing.join(', ')} not set`)
      return
    }
    const profile = real(map.aws_profile)
    add('OK', name, `tunnel keys complete: ${profile ? `profile ${profile}` : 'default AWS profile'}, region ${real(map.region) || 'us-east-1'}`)
  } catch {
    // tunnelCommand names the file and the key; say only which keys to look at.
    add('WARN', name, 'a tunnel key has an invalid value: check target (i-…), remote_host, remote_port, aws_profile, region')
  }
}

function checkAcrossConnections(connections, addresses) {
  const byEnv = new Map()
  for (const connection of connections) {
    for (const env of connection.declared.filter((item) => NAME.test(item))) {
      byEnv.set(env, [...(byEnv.get(env) || []), connection.name])
    }
  }
  for (const [env, names] of byEnv) {
    if (names.length > 1) {
      add('ERROR', '-', `env ${env} is declared by ${names.join(', ')}: --env ${env} fails. Keep it in one file, or pass --conn`)
    }
  }
  const byAddress = new Map()
  for (const [name, address] of addresses) {
    if (address) byAddress.set(address, [...(byAddress.get(address) || []), name])
  }
  for (const [address, names] of byAddress) {
    if (names.length > 1) {
      add('WARN', '-', `${names.join(', ')} share the local address ${address}: their tunnels cannot be open together`)
    }
  }
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error('Usage: node check-config.mjs')
  }
  const dir = configDir()
  console.log(`Config directory: ${dir}`)
  checkTools()
  for (const [key, variable] of Object.entries(OVERRIDES)) {
    if (process.env[variable]) {
      add('NOTE', LEGACY_CONNECTION, `${variable} is set in this shell and overrides ${key} in the file (value not shown)`)
    }
  }
  const overridden = Object.values(OVERRIDES).some((variable) => process.env[variable])
  // With no dev-db file, the query script still runs on the variables alone.
  const directoryFound = checkDirectory(dir, { required: !overridden })
  if (directoryFound || overridden) {
    const connections = directoryFound ? readConnections(dir, { redact: true }) : []
    if (overridden && !connections.some((connection) => connection.name === LEGACY_CONNECTION)) {
      add('NOTE', LEGACY_CONNECTION, 'no file; this connection exists only through the environment variables above')
      connections.unshift({
        name: LEGACY_CONNECTION,
        map: {},
        declared: [],
        envs: ['dev', 'qa'],
        malformed: [],
        unknown: [],
        duplicates: [],
      })
    }
    if (connections.length === 0) {
      add('ERROR', '-', `no connection files (*${FILE_SUFFIX}). Create one with: node scripts/init-config.mjs`)
    }
    const addresses = []
    for (const connection of connections) {
      checkLines(connection)
      const type = checkType(connection)
      checkEnvs(connection, type)
      addresses.push([connection.name, await checkLocalAddress(connection)])
      if (type === 'postgres') checkLogin(connection)
      checkTunnelKeys(connection)
    }
    checkAcrossConnections(connections, addresses)
  }
  for (const record of records) {
    console.log(`${record.level}\t${record.scope}\t${record.message}`)
  }
  const count = (level) => records.filter((record) => record.level === level).length
  console.log(`ERRORS=${count('ERROR')}`)
  console.log(`WARNINGS=${count('WARN')}`)
  if (count('ERROR') > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
