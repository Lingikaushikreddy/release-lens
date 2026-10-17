import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import {
  AnalysisError, DEFAULT_LIMITS, applyBudget, compare, readInventory, serializeReport,
  type Inventory, type Report,
} from '../../core/src/index';

const HELP = `Usage: releaselens diff <before.tgz> <after.tgz> [options]

Compare local npm tarballs offline. Inputs are read without extraction or execution.
Requires Node.js 22 or newer.

Options:
  --format json|text             Output format (default: text)
  --out <path>                   Atomically write the report; suppress stdout
  --max-unpacked-growth <bytes>   Nonnegative integer byte budget (inclusive)
  -h, --help                     Show this help

Examples:
  releaselens diff before.tgz after.tgz
  releaselens diff before.tgz after.tgz --format json --out report.json
  releaselens diff before.tgz after.tgz --max-unpacked-growth 1048576

Exit codes: 0 completed within/unset budget; 1 budget exceeded;
2 invalid arguments, configuration, or archive; 3 I/O or unsupported runtime;
130 cancelled by SIGINT. Findings never change the exit code.
`;

class ArgumentError extends Error {}
type Options = { before: string; after: string; format: 'json' | 'text'; out?: string; maxGrowth?: number };

function parseArguments(args: string[]): Options | 'help' {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return 'help';
  if (args[0] !== 'diff') throw new ArgumentError('Expected the diff command. Run releaselens --help for usage.');
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  let positionalOnly = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (!positionalOnly && arg === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && (arg === '--help' || arg === '-h')) {
      if (args.length !== 2) throw new ArgumentError('Help cannot be combined with other arguments.');
      return 'help';
    }
    if (!positionalOnly && arg.startsWith('-')) {
      if (!['--format', '--out', '--max-unpacked-growth'].includes(arg)) throw new ArgumentError(`Unknown option ${JSON.stringify(arg)}.`);
      if (flags.has(arg)) throw new ArgumentError(`Duplicate option ${arg}.`);
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--') || value.length === 0) throw new ArgumentError(`Missing value for ${arg}.`);
      flags.set(arg, value);
      index += 1;
    } else positionals.push(arg);
  }
  if (positionals.length !== 2 || positionals.some((path) => path.length === 0)) throw new ArgumentError('diff requires exactly two local tarball paths.');
  const format = flags.get('--format') ?? 'text';
  if (format !== 'json' && format !== 'text') throw new ArgumentError('--format must be json or text.');
  const budget = flags.get('--max-unpacked-growth');
  let maxGrowth: number | undefined;
  if (budget !== undefined) {
    if (!/^\d+$/.test(budget) || !Number.isSafeInteger(Number(budget))) throw new ArgumentError('--max-unpacked-growth must be a nonnegative safe integer byte count.');
    maxGrowth = Number(budget);
  }
  return { before: positionals[0], after: positionals[1], format, out: flags.get('--out'), maxGrowth };
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new AnalysisError('CANCELLED', 'Analysis cancelled.');
}

async function readArchive(path: string, signal: AbortSignal): Promise<Inventory> {
  assertNotCancelled(signal);
  // POSIX FIFO open must not wait for a writer before fstat can reject it.
  // O_NONBLOCK also closes the race a path-only stat check would leave.
  const flags = process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NONBLOCK;
  const handle = await open(path, flags);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error(`Input is not a regular file: ${JSON.stringify(path)}.`);
    assertNotCancelled(signal);
    const source = handle.createReadStream({ autoClose: false, signal });
    try {
      return await readInventory(Readable.toWeb(source) as ReadableStream<Uint8Array>, metadata.size, { ...DEFAULT_LIMITS, signal });
    } finally {
      source.destroy();
    }
  } finally {
    await handle.close();
  }
}

async function assertDistinctOutput(options: Options): Promise<void> {
  if (!options.out) return;
  const outputPath = resolve(options.out);
  if ([options.before, options.after].some((path) => resolve(path) === outputPath)) throw new ArgumentError('--out must be different from both input archives.');
  let outputMetadata;
  try { outputMetadata = await stat(options.out); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const path of [options.before, options.after]) {
    const inputMetadata = await stat(path);
    if (outputMetadata.dev === inputMetadata.dev && outputMetadata.ino === inputMetadata.ino) throw new ArgumentError('--out must not alias an input archive.');
  }
}

async function writeAtomic(path: string, contents: string, signal: AbortSignal): Promise<void> {
  const temporary = join(dirname(resolve(path)), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    assertNotCancelled(signal);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function signed(bytes: number): string { return bytes >= 0 ? `+${bytes}` : String(bytes); }

function formatText(report: Report): string {
  const lines = [
    'Release Lens — local archive comparison',
    `Archive bytes: ${report.before.archiveBytes} -> ${report.after.archiveBytes} (${signed(report.archiveDelta)})`,
    `Unpacked file bytes: ${report.before.unpackedBytes} -> ${report.after.unpackedBytes} (${signed(report.unpackedDelta)})`,
    `Budget: ${report.budget}`,
    '',
    'Changed files:',
  ];
  const changed = report.fileDeltas.filter((file) => file.kind !== 'unchanged');
  if (!changed.length) lines.push('  (none)');
  for (const file of changed) lines.push(`  ${file.kind} ${JSON.stringify(file.path)}: ${file.beforeBytes} -> ${file.afterBytes} (${signed(file.delta)} bytes; ${file.category})`);
  lines.push('', 'Manifest changes:');
  if (!report.manifestChanges.length) lines.push('  (none)');
  for (const change of report.manifestChanges) lines.push(`  ${JSON.stringify(change.pointer)}: ${change.beforeExists ? JSON.stringify(change.before) : '(missing)'} -> ${change.afterExists ? JSON.stringify(change.after) : '(missing)'}`);
  lines.push('', 'Findings:');
  if (!report.findings.length) lines.push('  (none)');
  for (const finding of report.findings) lines.push(`  ${finding.severity} ${finding.code} [side=${JSON.stringify(finding.side ?? null)} pointer=${JSON.stringify(finding.pointer ?? null)} paths=${JSON.stringify(finding.paths)}]: ${JSON.stringify(finding.message)}`);
  lines.push('', 'Unpacked bytes sum regular-file payloads; neither measure is installed footprint.');
  return `${lines.join('\n')}\n`;
}

async function writeStdout(contents: string): Promise<void> {
  await new Promise<void>((resolveWrite, reject) => {
    process.stdout.once('error', reject);
    process.stdout.write(contents, (error) => {
      process.stdout.removeListener('error', reject);
      if (error) reject(error); else resolveWrite();
    });
  });
}

async function main(): Promise<number> {
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.on('SIGINT', interrupt);
  try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
    const options = parseArguments(process.argv.slice(2));
    if (options === 'help') { await writeStdout(HELP); return 0; }
    await assertDistinctOutput(options);
    const before = await readArchive(options.before, abort.signal);
    const after = await readArchive(options.after, abort.signal);
    let report = compare(before, after);
    if (options.maxGrowth !== undefined) report = applyBudget(report, options.maxGrowth);
    assertNotCancelled(abort.signal);
    const contents = options.format === 'json' ? serializeReport(report) : formatText(report);
    if (options.out) await writeAtomic(options.out, contents, abort.signal);
    else await writeStdout(contents);
    return report.budget === 'fail' ? 1 : 0;
  } catch (error) {
    const cancelled = abort.signal.aborted || (error instanceof AnalysisError && error.code === 'CANCELLED');
    const message = cancelled ? 'Analysis cancelled.' : error instanceof Error ? error.message : 'Unknown error.';
    process.stderr.write(`releaselens: ${message}\n`);
    if (cancelled) return 130;
    if (error instanceof ArgumentError || error instanceof AnalysisError) return 2;
    return 3;
  } finally {
    process.off('SIGINT', interrupt);
  }
}

process.exitCode = await main();
