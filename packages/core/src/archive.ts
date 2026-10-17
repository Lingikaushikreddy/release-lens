import { createTarDecoder } from 'modern-tar';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { AnalysisError, DEFAULT_LIMITS, type Entry, type Inventory, type Limits } from './types';

function invalid(message: string): never { throw new AnalysisError('FORMAT', message); }
function limited(message: string): never { throw new AnalysisError('LIMIT', message); }
function unsupported(message: string): never { throw new AnalysisError('UNSUPPORTED', message); }
const cancelled = () => new AnalysisError('CANCELLED', 'Analysis was cancelled.');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const zeros = (bytes: Uint8Array) => bytes.every(byte => byte === 0);
const padding = (size: number) => (512 - size % 512) % 512;
const checkSignal = (signal?: AbortSignal) => { if (signal?.aborted) throw cancelled(); };

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crcByte(crc: number, byte: number): number { return (crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)) >>> 0; }

type Huffman = { codes: Map<number, number>; max: number };
function huffman(lengths: number[]): Huffman {
  const counts = new Uint16Array(16);
  for (const length of lengths) { if (length > 15) invalid('Invalid deflate code length.'); if (length) counts[length]++; }
  let available = 1;
  for (let length = 1; length <= 15; length++) { available = available * 2 - counts[length]; if (available < 0) invalid('Oversubscribed deflate tree.'); }
  const next = new Uint16Array(16);
  let code = 0;
  for (let length = 1; length <= 15; length++) { code = (code + counts[length - 1]) * 2; next[length] = code; }
  const codes = new Map<number, number>();
  let max = 0;
  lengths.forEach((length, symbol) => { if (length) { codes.set((1 << length) | next[length]++, symbol); max = Math.max(max, length); } });
  return { codes, max };
}
function* symbol(tree: Huffman): Generator<number, number, number> {
  let code = 0;
  for (let length = 1; length <= tree.max; length++) {
    code = code * 2 + (yield 1);
    const value = tree.codes.get((1 << length) | code);
    if (value !== undefined) return value;
  }
  return invalid('Invalid deflate Huffman symbol.');
}
const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const distanceBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const distanceExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const fixedLiterals = huffman(Array.from({ length: 288 }, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
const fixedDistances = huffman(Array(32).fill(5));

/** Locates the first gzip trailer without retaining or inflating compressed data. */
class GzipFraming {
  private parser: Generator<number, void, number>;
  private request: IteratorResult<number, void>;
  private bits = 0;
  private bitCount = 0;
  outputBytes = 0;
  expectedCrc = 0;
  expectedSize = 0;

  constructor(private limits: Limits) { this.parser = this.parse(); this.request = this.parser.next(); }

  private* parse(): Generator<number, void, number> {
    let headerBytes = 0;
    let headerCrc = 0xffffffff;
    const self = this;
    function* headerByte(): Generator<number, number, number> {
      const value: number = yield 8;
      if (++headerBytes > self.limits.maxMetadataBytes) limited('Gzip header exceeds metadata limit.');
      headerCrc = crcByte(headerCrc, value);
      return value;
    }
    if ((yield* headerByte()) !== 31 || (yield* headerByte()) !== 139) invalid('Input is not gzip.');
    if ((yield* headerByte()) !== 8) unsupported('Unsupported gzip compression method.');
    const flags = yield* headerByte();
    if (flags & 224) invalid('Reserved gzip flags are set.');
    for (let i = 0; i < 6; i++) yield* headerByte();
    if (flags & 4) {
      const low = yield* headerByte();
      const length = low + (yield* headerByte()) * 256;
      for (let i = 0; i < length; i++) yield* headerByte();
    }
    if (flags & 8) while ((yield* headerByte()) !== 0) { /* bounded by headerByte */ }
    if (flags & 16) while ((yield* headerByte()) !== 0) { /* bounded by headerByte */ }
    if (flags & 2) {
      const checksum = (yield 8) + (yield 8) * 256;
      if (checksum !== ((headerCrc ^ 0xffffffff) & 65535)) invalid('Invalid gzip header checksum.');
    }
    const addOutput = (length: number) => {
      this.outputBytes += length;
      if (!Number.isSafeInteger(this.outputBytes) || this.outputBytes > this.limits.maxExpandedBytes) limited('Expanded archive exceeds byte limit.');
    };
    let last = 0;
    do {
      last = yield 1;
      const type = yield 2;
      if (type === 0) {
        yield -1;
        const length = yield 16;
        if (((yield 16) ^ 65535) !== length) invalid('Invalid deflate stored block length.');
        addOutput(length);
        for (let i = 0; i < length; i++) yield 8;
        continue;
      }
      if (type === 3) invalid('Reserved deflate block type.');
      let literals = fixedLiterals;
      let distances = fixedDistances;
      if (type === 2) {
        const literalCount = (yield 5) + 257;
        const distanceCount = (yield 5) + 1;
        const codeCount = (yield 4) + 4;
        if (literalCount > 286) invalid('Invalid deflate literal alphabet.');
        const codeOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        const codeLengths = Array<number>(19).fill(0);
        for (let i = 0; i < codeCount; i++) codeLengths[codeOrder[i]] = yield 3;
        const codeTree = huffman(codeLengths);
        const lengths: number[] = [];
        while (lengths.length < literalCount + distanceCount) {
          const value = yield* symbol(codeTree);
          if (value <= 15) { lengths.push(value); continue; }
          let count: number;
          let repeated = 0;
          if (value === 16) {
            if (!lengths.length) invalid('Invalid deflate repeat.');
            repeated = lengths[lengths.length - 1]; count = (yield 2) + 3;
          } else count = value === 17 ? (yield 3) + 3 : (yield 7) + 11;
          if (lengths.length + count > literalCount + distanceCount) invalid('Deflate repeat exceeds alphabet.');
          for (let i = 0; i < count; i++) lengths.push(repeated);
        }
        if (!lengths[256]) invalid('Deflate tree has no end marker.');
        literals = huffman(lengths.slice(0, literalCount));
        distances = huffman(lengths.slice(literalCount));
      }
      while (true) {
        const value = yield* symbol(literals);
        if (value < 256) { addOutput(1); continue; }
        if (value === 256) break;
        if (value > 285) invalid('Reserved deflate length symbol.');
        const index = value - 257;
        const length = lengthBase[index] + (lengthExtra[index] ? yield lengthExtra[index] : 0);
        const distanceSymbol = yield* symbol(distances);
        if (distanceSymbol > 29) invalid('Reserved deflate distance symbol.');
        const distance = distanceBase[distanceSymbol] + (distanceExtra[distanceSymbol] ? yield distanceExtra[distanceSymbol] : 0);
        if (distance > this.outputBytes) invalid('Deflate distance precedes output.');
        addOutput(length);
      }
    } while (!last);
    yield -1;
    const trailer: number[] = [];
    for (let i = 0; i < 8; i++) trailer.push(yield 8);
    this.expectedCrc = (trailer[0] + trailer[1] * 256 + trailer[2] * 65536 + trailer[3] * 16777216) >>> 0;
    this.expectedSize = (trailer[4] + trailer[5] * 256 + trailer[6] * 65536 + trailer[7] * 16777216) >>> 0;
    if (this.expectedSize !== this.outputBytes % 4294967296) invalid('Invalid gzip uncompressed size.');
  }

  feed(chunk: Uint8Array): number {
    let offset = 0;
    while (!this.request.done) {
      const need = this.request.value;
      if (need === -1) { this.bits = 0; this.bitCount = 0; this.request = this.parser.next(0); continue; }
      if (this.bitCount < need) {
        if (offset === chunk.length) return offset;
        this.bits |= chunk[offset++] << this.bitCount;
        this.bitCount += 8;
        continue;
      }
      const value = this.bits & ((1 << need) - 1);
      this.bits >>>= need; this.bitCount -= need;
      this.request = this.parser.next(value);
    }
    if (!zeros(chunk.subarray(offset))) invalid('Concatenated gzip members or trailing nonpadding bytes are unsupported.');
    return offset;
  }
  finish(): void { if (!this.request.done) invalid('Gzip stream is truncated.'); }
}

type ExpectedEntry = { path: string; size: number; directory: boolean };
const paxKeys = new Set(['path', 'size', 'uid', 'gid', 'uname', 'gname', 'mtime', 'atime', 'ctime', 'comment', 'charset']);
function parsePax(bytes: Uint8Array): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    if (space < 0 || space - offset > 12) invalid('Malformed PAX record length.');
    const digits = utf8.decode(bytes.subarray(offset, space));
    if (!/^[1-9]\d*$/.test(digits)) invalid('Invalid PAX record length.');
    const length = Number(digits);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > bytes.length || end <= space + 2 || bytes[end - 1] !== 10) invalid('Truncated or malformed PAX record.');
    const text = utf8.decode(bytes.subarray(space + 1, end - 1));
    const equals = text.indexOf('=');
    if (equals < 1 || text.includes('\0')) invalid('Invalid PAX key or value.');
    const key = text.slice(0, equals), value = text.slice(equals + 1);
    if (Object.hasOwn(result, key)) invalid('Duplicate PAX key.');
    if (!paxKeys.has(key)) unsupported(`Unsupported PAX attribute: ${key}.`);
    if (key === 'charset' && value !== 'UTF-8') unsupported('Unsupported PAX character set.');
    if ((key === 'path' || key === 'size') && !value) invalid('Empty PAX identity or size.');
    if (key === 'size' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) invalid('Invalid PAX file size.');
    result[key] = value;
    offset = end;
  }
  return result;
}

function pathIdentity(value: string, directory: boolean): string {
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) invalid('Unsafe archive path.');
  const withoutPrefix = value.startsWith('./') ? value.slice(2) : value;
  const parts = withoutPrefix.split('/');
  if (parts.some(part => part === '..' || part === '.')) invalid('Archive path contains traversal components.');
  const normalized = parts.filter(Boolean).join('/');
  if (normalized !== 'package' && !normalized.startsWith('package/')) invalid('Archive entries must be inside package/.');
  if (!directory && (normalized === 'package' || value.endsWith('/'))) invalid('Invalid regular-file path.');
  return normalized;
}

/** Validates physical records before the library can buffer bodies or hide metadata. */
class TarFraming {
  private header = new Uint8Array(512);
  private headerOffset = 0;
  private remaining = 0;
  private padRemaining = 0;
  private meta: Uint8Array | null = null;
  private metaOffset = 0;
  private metaType = '';
  private globals: Record<string, string> = Object.create(null);
  private local: Record<string, string> | null = null;
  private seen = new Set<string>();
  private records = 0;
  private metadataBytes = 0;
  private zeroBlocks = 0;
  private ended = false;
  private position = 0;
  readonly expected: ExpectedEntry[] = [];
  expandedBytes = 0;
  crc = 0xffffffff;

  constructor(private limits: Limits) {}
  private text(block: Uint8Array, start: number, length: number): string {
    const field = block.subarray(start, start + length);
    const end = field.indexOf(0);
    if (end >= 0 && !zeros(field.subarray(end))) invalid('Nonpadding bytes follow a tar string terminator.');
    return utf8.decode(end < 0 ? field : field.subarray(0, end));
  }
  private octal(block: Uint8Array, start: number, length: number): number {
    const text = new TextDecoder('ascii').decode(block.subarray(start, start + length));
    if (!/^[ 0-7]*[\0 ]*$/.test(text)) invalid('Invalid USTAR numeric field.');
    const digits = text.replace(/[\0 ]/g, '');
    const value = digits ? Number.parseInt(digits, 8) : 0;
    if (!Number.isSafeInteger(value)) invalid('Unsafe USTAR numeric field.');
    return value;
  }
  private completeMetadata(): void {
    if (!this.meta) return;
    const parsed = parsePax(this.meta);
    if (this.metaType === 'g') Object.assign(this.globals, parsed);
    else {
      if (this.local) invalid('Multiple local PAX records for one entry are unsupported.');
      this.local = parsed;
    }
    this.meta = null; this.metaOffset = 0;
  }
  private readHeader(): void {
    const block = this.header;
    if (zeros(block)) {
      if (++this.zeroBlocks === 2) {
        if (this.local) invalid('Local PAX metadata has no following entry.');
        this.ended = true;
      }
      return;
    }
    if (this.zeroBlocks) invalid('Tar end marker requires two zero blocks.');
    if (++this.records > this.limits.maxEntries) limited('Archive exceeds physical entry limit.');
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : block[i];
    if (this.octal(block, 148, 8) !== checksum) invalid('Invalid tar header checksum.');
    if (this.text(block, 257, 6) !== 'ustar' || this.text(block, 263, 2) !== '00') unsupported('Only POSIX USTAR/PAX archives are supported.');
    const type = String.fromCharCode(block[156]);
    if (!['0', '\0', '5', 'x', 'g'].includes(type)) unsupported('Links, special files and non-PAX extensions are unsupported.');
    let size = this.octal(block, 124, 12);
    for (const [start, length] of [[100, 8], [108, 8], [116, 8], [136, 12], [329, 8], [337, 8]]) this.octal(block, start, length);
    const name = this.text(block, 0, 100), prefix = this.text(block, 345, 155);
    if (this.text(block, 157, 100)) unsupported('Link targets are unsupported.');
    if (type === 'x' || type === 'g') {
      this.metadataBytes += size;
      if (size > this.limits.maxMetadataBytes || this.metadataBytes > this.limits.maxMetadataBytes) limited('PAX metadata exceeds byte limit.');
      if (this.position + size + padding(size) > this.limits.maxExpandedBytes) limited('Declared metadata exceeds expanded byte limit.');
      this.meta = new Uint8Array(size); this.metaOffset = 0; this.metaType = type;
    } else {
      const effective = { ...this.globals, ...this.local };
      if (effective.size !== undefined) size = Number(effective.size);
      const directory = type === '5';
      if (directory && (size !== 0 || this.octal(block, 124, 12) !== 0)) invalid('Directory declares a nonzero payload.');
      const path = pathIdentity(effective.path ?? (prefix ? `${prefix}/${name}` : name), directory);
      if (this.seen.has(path)) invalid('Duplicate effective archive path.');
      this.seen.add(path);
      if (!directory && size > this.limits.maxFileBytes) limited('File declaration exceeds byte limit.');
      if (path === 'package/package.json' && size > this.limits.maxMetadataBytes) limited('Manifest exceeds metadata byte limit.');
      if (this.position + size + padding(size) > this.limits.maxExpandedBytes) limited('File declaration exceeds expanded byte limit.');
      this.expected.push({ path, size, directory });
      this.local = null;
    }
    this.remaining = size;
    this.padRemaining = padding(size);
    if (!size) this.completeMetadata();
  }

  feed(chunk: Uint8Array): void {
    checkSignal(this.limits.signal);
    this.expandedBytes += chunk.length;
    if (this.expandedBytes > this.limits.maxExpandedBytes) limited('Expanded archive exceeds byte limit.');
    for (const byte of chunk) this.crc = crcByte(this.crc, byte);
    let offset = 0;
    while (offset < chunk.length) {
      if (this.ended) { if (!zeros(chunk.subarray(offset))) invalid('Nonpadding data follows tar termination.'); this.position += chunk.length - offset; break; }
      if (this.remaining) {
        const amount = Math.min(this.remaining, chunk.length - offset);
        if (this.meta) { this.meta.set(chunk.subarray(offset, offset + amount), this.metaOffset); this.metaOffset += amount; }
        this.remaining -= amount; offset += amount; this.position += amount;
        if (!this.remaining) this.completeMetadata();
      } else if (this.padRemaining) {
        const amount = Math.min(this.padRemaining, chunk.length - offset);
        if (!zeros(chunk.subarray(offset, offset + amount))) invalid('Nonzero tar record padding.');
        this.padRemaining -= amount; offset += amount; this.position += amount;
      } else {
        const amount = Math.min(512 - this.headerOffset, chunk.length - offset);
        this.header.set(chunk.subarray(offset, offset + amount), this.headerOffset);
        this.headerOffset += amount; offset += amount; this.position += amount;
        if (this.headerOffset === 512) { this.headerOffset = 0; this.readHeader(); }
      }
    }
  }
  finish(): void { if (!this.ended || this.remaining || this.padRemaining || this.headerOffset) invalid('Tar archive is truncated or lacks termination.'); }
}

function manifestObject(bytes: Uint8Array, maxDepth: number): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(utf8.decode(bytes)); } catch { return invalid('package/package.json is not valid UTF-8 JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Manifest must be a JSON object.');
  const visit: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (visit.length) {
    const current = visit.pop()!;
    if (typeof current.value === 'number' && !Number.isFinite(current.value)) invalid('Manifest contains a nonfinite number.');
    if (current.value && typeof current.value === 'object') {
      if (current.depth > Math.min(maxDepth, 64)) limited('Manifest exceeds nesting depth limit.');
      for (const child of Object.values(current.value)) visit.push({ value: child, depth: current.depth + 1 });
    }
  }
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical((item as Record<string, unknown>)[key])])) : item;
  return canonical(value) as Record<string, unknown>;
}

/** Stream a single bounded gzip/USTAR archive; only the manifest payload is retained. */
export async function readInventory(input: ReadableStream<Uint8Array>, archiveBytes: number, limits: Limits = DEFAULT_LIMITS): Promise<Inventory> {
  limits = Object.freeze({ ...limits });
  for (const [key, value] of Object.entries(limits)) if (key !== 'signal' && (!Number.isSafeInteger(value) || (value as number) < 0)) limited(`Invalid ${key} limit.`);
  for (const key of ['maxArchiveBytes', 'maxExpandedBytes', 'maxEntries', 'maxFileBytes', 'maxMetadataBytes', 'maxManifestDepth'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) limited(`Invalid ${key} limit.`);
  }
  if (!Number.isSafeInteger(archiveBytes) || archiveBytes < 0) invalid('Invalid supplied compressed byte length.');
  checkSignal(limits.signal);
  if (archiveBytes > limits.maxArchiveBytes) limited('Compressed archive exceeds byte limit.');
  const sourceReader = input.getReader();
  let observedArchiveBytes = 0;
  let sourceFailed = false;
  let sourceError: unknown;
  let remainder: Uint8Array | undefined;
  let sourceController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const onAbort = () => { const error = cancelled(); sourceController?.error(error); void sourceReader.cancel(error).catch(() => {}); };
  limits.signal?.addEventListener('abort', onAbort, { once: true });
  const source = new ReadableStream<Uint8Array>({
    start(controller) { sourceController = controller; },
    async pull(controller) {
      checkSignal(limits.signal);
      while (!remainder?.length) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try { result = await sourceReader.read(); }
        catch (error) { sourceFailed = true; sourceError = error; throw error; }
        const { done, value } = result;
        if (done) {
          if (observedArchiveBytes !== archiveBytes) invalid('Supplied and observed compressed byte lengths differ.');
          controller.close(); return;
        }
        if (!(value instanceof Uint8Array)) invalid('Archive stream must contain byte chunks.');
        remainder = value;
      }
      const part = remainder.subarray(0, 65536);
      remainder = remainder.length > 65536 ? remainder.subarray(65536) : undefined;
      observedArchiveBytes += part.length;
      if (observedArchiveBytes > limits.maxArchiveBytes) limited('Observed compressed archive exceeds byte limit.');
      controller.enqueue(part);
    },
    cancel(reason) { remainder = undefined; return sourceReader.cancel(reason); }
  });
  const gzip = new GzipFraming(limits);
  const tar = new TarFraming(limits);
  const entries: Entry[] = [];
  let manifest: Record<string, unknown> | undefined;
  let unpackedBytes = 0;
  const decoder = createTarDecoder({ strict: true });
  const reader = source.pipeThrough(new TransformStream<Uint8Array, Uint8Array<ArrayBuffer>>({
    transform(chunk, controller) { checkSignal(limits.signal); const count = gzip.feed(chunk); if (count) controller.enqueue(new Uint8Array(chunk.subarray(0, count))); },
    flush() { gzip.finish(); }
  })).pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { tar.feed(chunk); controller.enqueue(chunk); },
    flush() {
      tar.finish();
      if (tar.expandedBytes !== gzip.outputBytes || ((tar.crc ^ 0xffffffff) >>> 0) !== gzip.expectedCrc || tar.expandedBytes % 4294967296 !== gzip.expectedSize) invalid('Gzip payload checksum or size mismatch.');
    }
  })).pipeThrough(decoder).getReader();
  try {
    while (true) {
      checkSignal(limits.signal);
      const { done, value } = await reader.read();
      if (done) break;
      const expected = tar.expected.shift();
      if (!expected || pathIdentity(value.header.name, value.header.type === 'directory') !== expected.path || value.header.size !== expected.size || (value.header.type === 'directory') !== expected.directory) invalid('Tar parser and framing policy disagree.');
      const body = value.body.getReader();
      const hash = sha256.create();
      const manifestBytes = expected.path === 'package/package.json' && !expected.directory ? new Uint8Array(expected.size) : null;
      let count = 0;
      try {
        while (true) {
          checkSignal(limits.signal);
          const result = await body.read();
          if (result.done) break;
          count += result.value.length;
          if (count > expected.size || count > limits.maxFileBytes) limited('Observed file payload exceeds declared or allowed size.');
          hash.update(result.value);
          manifestBytes?.set(result.value, count - result.value.length);
        }
      } finally { body.releaseLock(); }
      if (count !== expected.size) invalid('File payload differs from declared size.');
      if (!expected.directory) {
        unpackedBytes += count;
        entries.push({ path: expected.path.slice('package/'.length), bytes: count, sha256: bytesToHex(hash.digest()) });
        if (manifestBytes) manifest = manifestObject(manifestBytes, limits.maxManifestDepth);
      }
    }
    if (tar.expected.length) invalid('Tar parser omitted entries.');
    if (!manifest) invalid('Archive has no regular package/package.json manifest.');
    entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { schemaVersion: 1, archiveBytes: observedArchiveBytes, unpackedBytes, entries, manifest };
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    void sourceReader.cancel(error).catch(() => {});
    if (limits.signal?.aborted) throw cancelled();
    if (sourceFailed && error === sourceError) throw error;
    if (error instanceof AnalysisError) throw error;
    throw new AnalysisError('FORMAT', error instanceof Error ? `Invalid archive: ${error.message}` : 'Invalid archive stream.');
  } finally {
    limits.signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
    sourceReader.releaseLock();
  }
}
