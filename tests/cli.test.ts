import { spawnSync } from 'node:child_process';
import { linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
beforeAll(() => {
  const result = spawnSync(process.execPath, ['scripts/build-cli.mjs'], { cwd: root, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});
const directory = mkdtempSync(join(tmpdir(), 'release lens-cli-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

// Deliberately small, independent USTAR writer: expected payload changes below
// are literal bytes, never calculated by Release Lens.
function archive(name: string, files: Record<string, string>): string {
  const blocks: Buffer[] = [];
  for (const [path, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(`package/${path}`, 0, 100, 'utf8');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const path = join(directory, name);
  writeFileSync(path, gzipSync(Buffer.concat(blocks)));
  return path;
}

const manifest = '{"name":"cli-fixture","version":"1.0.0","main":"index.js"}';
const before = archive('before.tgz', { 'package.json': manifest, 'index.js': 'a' });
const after = archive('after.tgz', { 'package.json': manifest, 'index.js': 'abcd', 'extra.txt': 'xyz' });

describe('CLI arguments', () => {
  it('shows installed usage without requiring archives', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('releaselens diff');
    expect(result.stderr).toBe('');
  });

  it.each([
    [], ['diff'], ['install', 'before.tgz'],
    ['diff', 'before.tgz', 'after.tgz', '--format', 'html'],
    ['diff', 'before.tgz', 'after.tgz', '--max-unpacked-growth', '-1'],
    ['diff', 'before.tgz', 'after.tgz', '--max-unpacked-growth', '1.5'],
    ['diff', 'before.tgz', 'after.tgz', '--max-unpacked-growth', '9007199254740992'],
    ['diff', 'before.tgz', 'after.tgz', '--out'],
    ['diff', 'before.tgz', 'after.tgz', '--unknown'],
    ['diff', 'before.tgz', 'after.tgz', '--format', 'json', '--format', 'text'],
  ].map((args) => ({ args })))('rejects invalid arguments $args with a diagnostic and no report', ({ args }) => {
    const result = run(...args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('releaselens:');
  });

  it('returns I/O exit 3 for a missing input', () => {
    const result = run('diff', join(directory, 'missing.tgz'), after);
    expect(result.status).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ENOENT');
  });

  it.skipIf(process.platform === 'win32')('rejects a POSIX FIFO promptly without waiting for a writer', () => {
    const fifo = join(directory, 'input-fifo.tgz');
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    expect(created.status, created.stderr).toBe(0);
    const result = spawnSync(process.execPath, [cli, 'diff', fifo, after], { cwd: root, encoding: 'utf8', timeout: 1500 });
    expect(result.error, 'FIFO analysis must finish before the subprocess timeout').toBeUndefined();
    expect(result.status, result.stderr).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('not a regular file');
  });

  it('preserves input read failures as I/O exit 3', () => {
    // A portable EIO cannot be forced with ordinary files. Inject the error at
    // the actual ReadStream boundary while retaining real open/close behavior.
    const code = `import fsp from 'node:fs/promises'; import { syncBuiltinESMExports } from 'node:module'; const originalOpen = fsp.open; fsp.open = async (...args) => { const handle = await originalOpen(...args); const createReadStream = handle.createReadStream.bind(handle); handle.createReadStream = (...options) => { const stream = createReadStream(...options); stream._read = () => stream.destroy(Object.assign(new Error('injected input read failure'), { code: 'EIO' })); return stream; }; return handle; }; syncBuiltinESMExports(); process.argv = [process.execPath, ${JSON.stringify(cli)}, 'diff', ${JSON.stringify(before)}, ${JSON.stringify(after)}]; await import(${JSON.stringify(pathToFileURL(cli).href)});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('injected input read failure');
  });

  it('returns unsupported runtime exit 3 before analyzing inputs', () => {
    const code = `Object.defineProperty(process.versions, 'node', { value: '20.0.0' }); await import(${JSON.stringify(pathToFileURL(cli).href)});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    expect(result.status).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Node.js 22');
  });
});

describe('CLI reports and budgets', () => {
  it('serializes exact payload deltas and hashes deterministically as JSON', () => {
    const result = run('diff', before, after, '--format', 'json');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.unpackedDelta).toBe(6);
    expect(report.archiveDelta).toBe(readFileSync(after).length - readFileSync(before).length);
    expect(report.budget).toBe('unset');
    expect(report.fileDeltas.find((file: { path: string }) => file.path.endsWith('index.js'))).toMatchObject({ beforeBytes: 1, afterBytes: 4, delta: 3, kind: 'modified' });
    expect(report.fileDeltas.find((file: { path: string }) => file.path.endsWith('extra.txt'))).toMatchObject({ beforeBytes: 0, afterBytes: 3, delta: 3, kind: 'added' });
    expect(result.stdout).toBe(run('diff', before, after, '--format', 'json').stdout);
    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(result.stdout).not.toContain(directory);
  });

  it.each([{ budget: '6', status: 0, result: 'pass' }, { budget: '5', status: 1, result: 'fail' }, { budget: '0', status: 1, result: 'fail' }])('enforces inclusive growth budget $budget', ({ budget, status, result: expected }) => {
    const result = run('diff', before, after, '--format', 'json', '--max-unpacked-growth', budget);
    expect(result.status).toBe(status);
    expect(JSON.parse(result.stdout).budget).toBe(expected);
    expect(result.stderr).toBe('');
  });

  it('defaults to a readable byte report', () => {
    const result = run('diff', before, after);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Unpacked file bytes:');
    expect(result.stdout).toContain('(+6)');
    expect(result.stdout).toContain('index.js');
    expect(result.stderr).toBe('');
  });

  it('leaves warnings as successful report evidence', () => {
    const warning = archive('warning.tgz', { 'package.json': '{"name":"warning","main":"missing.js"}' });
    const result = run('diff', warning, warning, '--format', 'json');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).findings.some((finding: { severity: string }) => finding.severity === 'warning')).toBe(true);
  });

  it.each([
    { name: 'demo', pointer: '"/bin/demo"' },
    { name: 'de"mo\nline', pointer: '"/bin/de\\"mo\\nline"' },
  ])('identifies a fixed warning as before-side evidence with a safely quoted pointer $pointer', ({ name, pointer }) => {
    const manifest = JSON.stringify({ name: 'fixed-warning', bin: { [name]: 'missing.js' } });
    const warningBefore = archive('fixed-warning-before.tgz', { 'package.json': manifest });
    const warningAfter = archive('fixed-warning-after.tgz', { 'package.json': manifest, 'missing.js': 'present' });
    const result = run('diff', warningBefore, warningAfter);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const warningLines = result.stdout.split('\n').filter((line) => line.includes('MISSING_LITERAL_TARGET'));
    expect(warningLines).toHaveLength(1);
    expect(warningLines[0]).toContain('side="before"');
    expect(warningLines[0]).toContain(`pointer=${pointer}`);
    expect(warningLines[0]).toContain('paths=["missing.js"]');
  });

  it('returns archive exit 2 without a report for corrupt gzip', () => {
    const corrupt = join(directory, 'corrupt.tgz');
    writeFileSync(corrupt, 'not a gzip archive');
    const result = run('diff', before, corrupt, '--format', 'json');
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('releaselens:');
  });

  it('cancels with SIGINT exit 130 and clears pending output', () => {
    // Windows process.kill forcibly terminates; emit the event that console
    // Ctrl+C delivers there. POSIX exercises the real operating-system signal.
    const interrupt = process.platform === 'win32' ? "process.emit('SIGINT')" : "process.kill(process.pid, 'SIGINT')";
    const code = `process.on('newListener', (event) => { if (event === 'SIGINT') setImmediate(() => ${interrupt}); }); process.argv = [process.execPath, ${JSON.stringify(cli)}, 'diff', ${JSON.stringify(before)}, ${JSON.stringify(after)}, '--format', 'json']; await import(${JSON.stringify(pathToFileURL(cli).href)});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(130);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('cancelled');
  });
});

describe('CLI atomic report output', () => {
  it('writes the selected format and suppresses stdout without changing inputs', () => {
    const output = join(directory, 'report.json');
    writeFileSync(output, 'previous report');
    const original = readFileSync(before);
    const result = run('diff', before, after, '--format', 'json', '--out', output);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(JSON.parse(readFileSync(output, 'utf8')).unpackedDelta).toBe(6);
    expect(readFileSync(before)).toEqual(original);
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('preserves existing output when archive validation fails', () => {
    const output = join(directory, 'preserved.json');
    const corrupt = join(directory, 'invalid.tgz');
    writeFileSync(output, 'keep this');
    writeFileSync(corrupt, 'invalid');
    expect(run('diff', before, corrupt, '--out', output).status).toBe(2);
    expect(readFileSync(output, 'utf8')).toBe('keep this');
  });

  it('cleans its temporary file after a failed atomic rename', () => {
    const output = join(directory, 'directory-target');
    mkdirSync(output);
    const result = run('diff', before, after, '--out', output);
    expect(result.status).toBe(3);
    expect(result.stdout).toBe('');
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects an output path identical to an input', () => {
    const original = readFileSync(before);
    expect(run('diff', before, after, '--out', before).status).toBe(2);
    expect(readFileSync(before)).toEqual(original);
  });

  it('rejects output hard links to inputs', () => {
    const output = join(directory, 'hardlink.tgz');
    linkSync(before, output);
    expect(run('diff', before, after, '--out', output).status).toBe(2);
    expect(readFileSync(output)).toEqual(readFileSync(before));
  });

  it.skipIf(process.platform === 'win32')('rejects output symlinks to inputs', () => {
    const output = join(directory, 'symlink.tgz');
    symlinkSync(before, output);
    expect(run('diff', before, after, '--out', output).status).toBe(2);
    expect(readFileSync(output)).toEqual(readFileSync(before));
  });
});
