import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repoDir = path.resolve(packageDir, '../..');
const entryPoint = path.join(packageDir, 'src/index.ts');
const outputPath = path.join(
  repoDir,
  'resources/spotcobuild-zebar-theme/bar/js/zebar-local.js',
);
const checkOnly = process.argv.includes('--check');

const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
});
const generated = result.outputFiles[0].text;

if (checkOnly) {
  const committed = await readFile(outputPath, 'utf8');
  if (committed !== generated) {
    console.error(
      `Stale vendored bundle: ${path.relative(repoDir, outputPath)}`,
    );
    console.error(
      'Run pnpm --filter zebar bundle:spotcobuild-theme to regenerate it.',
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated);
  console.log(`Wrote ${path.relative(repoDir, outputPath)}`);
}
