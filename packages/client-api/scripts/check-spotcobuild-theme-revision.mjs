import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repoDir = path.resolve(packageDir, '../..');
const packDir = path.join(repoDir, 'resources/spotcobuild-zebar-theme');
const packConfigPath = path.join(packDir, 'zpack.json');
const checkOnly = process.argv.includes('--check');

async function filesIn(dir, relative = '') {
  const entries = await readdir(path.join(dir, relative), {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesIn(dir, entryRelative)));
    } else if (entryRelative !== 'zpack.json') {
      files.push(entryRelative);
    }
  }

  return files;
}

const files = (await filesIn(packDir)).sort();
const hash = createHash('sha256');
for (const relative of files) {
  hash.update(relative.split(path.sep).join('/'));
  hash.update('\0');
  hash.update(await readFile(path.join(packDir, relative)));
  hash.update('\0');
}

const expectedRevision = `spotcobuild-content-${hash.digest('hex').slice(0, 16)}`;
const packConfig = JSON.parse(await readFile(packConfigPath, 'utf8'));

if (checkOnly) {
  if (packConfig.buildRevision !== expectedRevision) {
    console.error(
      `Stale embedded pack revision: expected ${expectedRevision}, found ${packConfig.buildRevision ?? '<missing>'}`,
    );
    console.error(
      'Run pnpm --filter zebar pack:spotcobuild-theme:revision to update zpack.json.',
    );
    process.exitCode = 1;
  }
} else {
  packConfig.buildRevision = expectedRevision;
  await writeFile(
    packConfigPath,
    `${JSON.stringify(packConfig, null, 2)}\n`,
  );
  console.log(`Updated embedded pack revision to ${expectedRevision}`);
}
