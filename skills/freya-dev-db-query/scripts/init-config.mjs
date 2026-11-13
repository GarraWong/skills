#!/usr/bin/env node
// Create .freya/<connection>.credentials in the user home directory from the
// example. Never overwrites an existing file. Never writes a real secret.
//
//   node init-config.mjs                              creates dev-db.credentials
//   node init-config.mjs --conn sqa-db --envs sqa     creates sqa-db.credentials

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_CONNECTION = 'dev-db'
// The dev tunnel reaches both environments; other connections say theirs.
const DEFAULT_ENVS = { [DEFAULT_CONNECTION]: 'dev,qa' }
const NAME = /^[a-z0-9][a-z0-9._-]*$/

function usage() {
  return 'Usage: node init-config.mjs [--conn <name>] [--envs <env>[,<env>...]]'
}

function parseArgs(argv) {
  const out = { conn: DEFAULT_CONNECTION, envs: '' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg !== '--conn' && arg !== '--envs') {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`)
    }
    const value = argv[++i]
    if (value === undefined) throw new Error(`Missing value for ${arg}\n${usage()}`)
    if (arg === '--conn') out.conn = value.toLowerCase()
    else out.envs = value.toLowerCase()
  }
  if (!NAME.test(out.conn)) {
    throw new Error('--conn must be letters, digits, dots, underscores, and hyphens.')
  }
  const envs = out.envs.split(',').map((item) => item.trim()).filter(Boolean)
  if (envs.some((item) => !NAME.test(item))) {
    throw new Error('--envs must be a comma-separated list of environment names.')
  }
  out.envs = envs.join(',') || DEFAULT_ENVS[out.conn] || ''
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const example = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'references',
    'credentials.example',
  )
  const destination = path.join(os.homedir(), '.freya', `${args.conn}.credentials`)
  if (!fs.existsSync(example)) {
    throw new Error(`Example not found: ${example}`)
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  if (fs.existsSync(destination)) {
    console.log(`Credentials file already exists: ${destination}`)
    console.log('Fill it in locally. An existing file is left as it is.')
    return
  }
  let text = fs.readFileSync(example, 'utf8')
  if (args.envs) text = text.replace(/^envs=.*$/m, `envs=${args.envs}`)
  // 'wx' fails instead of overwriting if the file appeared in the meantime.
  fs.writeFileSync(destination, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  try {
    fs.chmodSync(destination, 0o600)
  } catch {
    // Windows ACLs may reject a Unix mode. The file is still created.
  }
  console.log(`Created ${destination} from credentials.example.`)
  console.log('Edit that file: set port to the local SSM listen port, and set username and password.')
  if (!args.envs) console.log('Set envs to the environments this tunnel reaches.')
  console.log('The tunnel keys (aws_profile, target, remote_host, remote_port) are optional for queries.')
  console.log('Do not commit the file or paste secrets into chat.')
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
