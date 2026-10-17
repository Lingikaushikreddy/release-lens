import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = 'work/candidate';
const c = JSON.parse(await readFile(join(directory, 'release-verification.json'), 'utf8'));
assert.equal(c.sourceCommit, process.env.GITHUB_SHA);
assert.equal(`refs/tags/${c.tag}`, process.env.GITHUB_REF);
const repository = 'Lingikaushikreddy/release-lens';
assert.equal(process.env.GITHUB_REPOSITORY, repository);
const evidenceArchive = `release-lens-${c.version}-verification.zip`;
execFileSync('python3', ['-c', `
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
directory=Path('work/candidate')
names=['release-control.json','release-verification.json','provenance.json','RELEASE_REPORT.md']
with ZipFile(directory/'${evidenceArchive}','w',compression=ZIP_DEFLATED) as archive:
    for name in names: archive.write(directory/name,name)
    for folder in ['evidence','registry']:
        for path in sorted((directory/folder).rglob('*')):
            if path.is_file(): archive.write(path,str(path.relative_to(directory)))
`]);
const names = [c.artifact, `release-lens-${c.version}-source.tar.gz`, `release-lens-${c.version}-web.zip`, evidenceArchive, 'release.json', 'release-verification.json', 'RELEASE_REPORT.md'];
const hashes = {};
for (const name of names) hashes[name] = createHash('sha256').update(await readFile(join(directory, name))).digest('hex');
await writeFile(join(directory, 'SHA256SUMS'), Object.entries(hashes).map(([name, hash]) => `${hash}  ${name}\n`).join(''));
hashes.SHA256SUMS = createHash('sha256').update(await readFile(join(directory, 'SHA256SUMS'))).digest('hex');
const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${c.tag}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) });
assert([200, 404].includes(response.status), 'GitHub release lookup must succeed');
let existing;
if (response.status === 200) {
  existing = await response.json();
  assert.equal(existing.tag_name, c.tag);
  if (!existing.draft) {
    for (const name of Object.keys(hashes)) assert(existing.assets.some(asset => asset.name === name), `Finalized release is missing ${name}`);
    assert.equal(existing.assets.find(asset => asset.name === c.artifact).digest, `sha256:${c.sha256}`, 'Finalized release archive must match the tested package');
    const reportAsset = existing.assets.find(asset => asset.name === 'release-verification.json');
    const reportResponse = await fetch(reportAsset.browser_download_url, { signal: AbortSignal.timeout(30_000) });
    assert.equal(reportResponse.status, 200);
    const previous = await reportResponse.json();
    for (const key of ['sourceCommit', 'sha256', 'version', 'package', 'tag']) assert.equal(previous[key], c[key], `Finalized release ${key}`);
    console.log(`Already finalized and verified: https://github.com/${repository}/releases/tag/${c.tag}`);
    process.exit(0);
  }
} else {
  gh(['release', 'create', c.tag, '--repo', repository, '--verify-tag', '--draft', '--title', `Release Lens ${c.version}`, '--notes-file', join(directory, 'RELEASE_REPORT.md')]);
  existing = { assets: [], draft: true };
}
// A completed release is immutable here. A rerun can confirm it without replacing
// timestamps, evidence or bytes. Interrupted draft uploads can resume.
for (const [name, hash] of Object.entries(hashes)) {
  const asset = existing.assets.find(item => item.name === name);
  if (asset) {
    if (asset.digest !== `sha256:${hash}`) {
      assert([evidenceArchive, 'release-verification.json', 'RELEASE_REPORT.md', 'SHA256SUMS'].includes(name), `Existing draft archive differs: ${name}`);
      gh(['release', 'upload', c.tag, join(directory, name), '--repo', repository, '--clobber']);
    }
  } else {
    assert.equal(existing.draft, true, 'Never add new files to an already finalized release');
    gh(['release', 'upload', c.tag, join(directory, name), '--repo', repository]);
  }
}
if (existing.draft) gh(['release', 'edit', c.tag, '--repo', repository, '--draft=false', '--latest']);
console.log(`Verified public release: https://github.com/${repository}/releases/tag/${c.tag}`);
