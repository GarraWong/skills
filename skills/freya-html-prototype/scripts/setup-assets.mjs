/**
 * Fetches the four scripts a Freya HTML prototype loads, into `<outdir>/assets/`.
 *
 *   react.js          React 18 UMD          -> window.React
 *   react-dom.js      ReactDOM 18 UMD       -> window.ReactDOM
 *   mui.js            @mui/material 5 UMD   -> window.MaterialUI  (emotion bundled in)
 *   freya-theme.js    @freyr/freya-docs-ui  -> window.FreyaTheme
 *
 * Everything is fetched with `npm pack`, so it uses the caller's existing npm
 * auth and registry config. `@freyr/freya-docs-ui` comes from the Freyr ADO feed
 * and the other three from the public registry; a consumer needs no checkout of
 * any frontend repo, which is the reason the theme is published at all — this
 * repo is documentation and has no node_modules.
 *
 * React is pinned to 18: React 19 removed the UMD builds entirely, and a
 * prototype has no bundler to fall back on. MUI is pinned to 5 to match what the
 * Freya frontends ship.
 *
 * Idempotent — a file already present is left alone unless --force.
 *
 *   node setup-assets.mjs [outdir] [--force]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, copyFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = promisify(execFile);

const FREYR_REGISTRY =
  'https://pkgs.dev.azure.com/FreyrDevOps/Freyr-Unified-RIMS/_packaging/freyr-react-common/npm/registry/';

/** [npm spec, path inside the tarball, filename we write]. */
const ASSETS = [
  ['react@18', 'package/umd/react.production.min.js', 'react.js'],
  ['react-dom@18', 'package/umd/react-dom.production.min.js', 'react-dom.js'],
  ['@mui/material@5', 'package/umd/material-ui.production.min.js', 'mui.js'],
  ['@freyr/freya-docs-ui', 'package/dist/theme.global.js', 'freya-theme.js'],
  // 3 MB, and the largest thing here by far. It buys real JSX with no build
  // step, so prototype markup is the same text as the app's and moves between
  // them by copy-paste. Fetched once per prototype folder, then offline.
  ['@babel/standalone@7', 'package/babel.min.js', 'babel.js'],
];

/**
 * `npm pack` runs in a temp dir, which is deliberate — but it means the project's
 * `.npmrc` is out of scope and the `@freyr:` mapping is not read. Stating the
 * registry on the command line restores it. Credentials still come from the
 * user's `~/.npmrc`, which keys them by registry URL rather than by scope.
 */
const registryArgs = (spec) =>
  spec.startsWith('@freyr/') ? [`--registry=${FREYR_REGISTRY}`] : [];

const args = process.argv.slice(2);
const force = args.includes('--force');
const outdir = resolve(args.find((a) => !a.startsWith('--')) ?? '.', 'assets');

const exists = (p) => access(p).then(() => true, () => false);

await mkdir(outdir, { recursive: true });

for (const [spec, entry, name] of ASSETS) {
  const dest = join(outdir, name);

  if (!force && (await exists(dest))) {
    console.log(`skip  ${name} (already present)`);
    continue;
  }

  // A fresh temp dir per asset: `npm pack` writes the tarball to cwd, and two
  // packages can otherwise collide on an unpacked `package/` directory.
  const tmp = await mkdtemp(join(tmpdir(), 'freya-proto-'));
  try {
    const { stdout } = await run('npm', ['pack', spec, '--silent', ...registryArgs(spec)], {
      cwd: tmp,
    });
    const tarball = stdout.trim().split('\n').pop();

    await run('tar', ['-xzf', tarball, entry], { cwd: tmp });
    await copyFile(join(tmp, entry), dest);
    console.log(`fetch ${name}  <- ${spec}`);
  } catch (err) {
    // Named explicitly: the usual cause is missing auth for the Freyr feed, and
    // the raw npm error does not say which package it was trying to reach.
    console.error(`\nFailed to fetch ${spec}`);
    if (spec.startsWith('@freyr/')) {
      console.error(
        'This one needs auth for the Freyr ADO feed. Check that your .npmrc has\n' +
          '  @freyr:registry=https://pkgs.dev.azure.com/FreyrDevOps/Freyr-Unified-RIMS/_packaging/freyr-react-common/npm/registry/\n' +
          'and that your credentials are current (vsts-npm-auth, or a PAT).',
      );
    }
    throw err;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

console.log(`\nassets ready in ${outdir}`);
