import { describe, expect, it } from 'vitest';
import { constants, gzipSync } from 'node:zlib';
import { readInventory } from '../packages/core/src/archive';
import { DEFAULT_LIMITS, type Limits } from '../packages/core/src/types';
import { concat, gzip, pax, stream, tar, tarRecord, type RecordSpec } from './helpers/archive';

const manifest: RecordSpec = { name: 'package/package.json', body: '{"z":1,"name":"fixture","a":{"z":2,"a":3}}' };
async function read(bytes: Uint8Array, limits: Partial<Limits> = {}, chunk = bytes.length) {
  return readInventory(stream(bytes, chunk), bytes.length, { ...DEFAULT_LIMITS, ...limits });
}
const fail = (bytes: Uint8Array, code = 'FORMAT', limits: Partial<Limits> = {}) => expect(read(bytes, limits)).rejects.toMatchObject({ name: 'AnalysisError', code });

describe('bounded archive inventory', () => {
  it.each([1, 7, 511, 4096])('hashes empty and nonempty files across %i-byte input chunks', async chunk => {
    const bytes = gzip(tar({ name: 'package/z.txt', body: 'abc' }, { name: 'package/', type: '5' }, manifest, { name: './package//empty', body: '' }));
    const result = await read(bytes, {}, chunk);
    expect(result.archiveBytes).toBe(bytes.length);
    expect(result.unpackedBytes).toBe(45);
    expect(result.entries.map(e => e.path)).toEqual(['empty', 'package.json', 'z.txt']);
    expect(result.entries[0]).toEqual({ path: 'empty', bytes: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
    expect(result.entries[2].sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(Object.keys(result.manifest)).toEqual(['a', 'name', 'z']);
    expect(Object.keys(result.manifest.a as object)).toEqual(['a', 'z']);
  });

  it('uses valid PAX path and size overrides', async () => {
    const bytes = gzip(concat(tarRecord(manifest), tarRecord({ name: 'PaxHeader/x', type: 'x', body: pax(['path', 'package/long-name'], ['size', '3']) }), tarRecord({ name: 'placeholder', size: 0, body: 'abc' }), new Uint8Array(1024)));
    expect((await read(bytes, {}, 3)).entries.map(e => [e.path, e.bytes])).toEqual([['long-name', 3], ['package.json', 42]]);
  });

  it.each([{ level: 0 }, { level: 6, strategy: constants.Z_FIXED }, { level: 9 }])('accepts stored, fixed and dynamic deflate blocks with $level/$strategy compression', async options => {
    const payload = new Uint8Array(90000);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 37 + Math.floor(i / 113)) % 256;
    const bytes = new Uint8Array(gzipSync(tar(manifest, { name: 'package/data', body: payload }), options));
    const result = await read(bytes, {}, 17);
    expect(result.unpackedBytes).toBe(90042);
    expect(result.entries[0].bytes).toBe(90000);
  });

  it('merges global metadata with local overrides without losing effective identities', async () => {
    const bytes = gzip(tar({ name: 'global', type: 'g', body: pax(['comment', 'a']) }, manifest,
      { name: 'global2', type: 'g', body: pax(['path', 'package/global-name']) }, { name: 'package/ignored' },
      { name: 'local', type: 'x', body: pax(['path', 'package/local-name']) }, { name: 'package/ignored2', body: 'x' }));
    expect((await read(bytes, {}, 7)).entries.map(entry => entry.path)).toEqual(['global-name', 'local-name', 'package.json']);
  });

  it('does not convert underlying source I/O failures into archive-format errors', async () => {
    const io = Object.assign(new Error('read failed'), { code: 'EIO' });
    const source = new ReadableStream<Uint8Array>({ pull() { throw io; } });
    await expect(readInventory(source, 1, DEFAULT_LIMITS)).rejects.toBe(io);
  });

  it.each(['package/../escape', '/package/absolute', 'package\\evil', 'other/a', 'package/a\0hidden', '././package/a'])('rejects effective PAX path %s', async path => {
    await fail(gzip(tar(manifest, { name: 'PaxHeader/x', type: 'x', body: pax(['path', path]) }, { name: 'package/safe' })));
  });

  it('rejects duplicate PAX keys and duplicate normalized identities including directories', async () => {
    await fail(gzip(tar(manifest, { name: 'pax', type: 'x', body: pax(['path', 'package/ok'], ['path', 'package/../bad']) }, { name: 'package/a' })));
    await fail(gzip(tar(manifest, { name: 'package/a/', type: '5' }, { name: './package//a' })));
    await fail(gzip(tar(manifest, { name: 'package/a' }, { name: 'pax', type: 'x', body: pax(['path', 'package/a']) }, { name: 'package/b' })));
  });

  it.each(['1', '2', '3', '4', '6', '7', 'L', 'K', 'S', 'Z'])('rejects unsupported typeflag %s', async type => {
    await fail(gzip(tar(manifest, { name: 'package/entry', type })), 'UNSUPPORTED');
  });

  it('rejects file, metadata, entry and expanded declarations before reading a missing body', async () => {
    await fail(gzip(concat(tarRecord({ name: 'package/huge', size: 1000 }))), 'LIMIT', { maxFileBytes: 999 });
    await fail(gzip(concat(tarRecord({ name: 'pax', type: 'x', size: 1000 }))), 'LIMIT', { maxMetadataBytes: 999 });
    await fail(gzip(tar(manifest, { name: 'pax', type: 'g', body: pax(['comment', 'x']) })), 'LIMIT', { maxEntries: 1 });
    await fail(gzip(concat(tarRecord({ name: 'package/huge', size: 1000 }))), 'LIMIT', { maxExpandedBytes: 1000 });
  });

  it('counts all expanded tar overhead and permits the inclusive boundary', async () => {
    const expanded = tar(manifest);
    await fail(gzip(expanded), 'LIMIT', { maxExpandedBytes: expanded.length - 1 });
    expect((await read(gzip(expanded), { maxExpandedBytes: expanded.length })).entries).toHaveLength(1);
  });

  it('rejects the 20001st physical record including zero-byte files', async () => {
    const records: RecordSpec[] = [manifest, ...Array.from({ length: 20000 }, (_, i) => ({ name: `package/f${i}` }))];
    await fail(gzip(tar(...records)), 'LIMIT');
  });

  it('checks compressed byte counts independently from the supplied length', async () => {
    const bytes = gzip(tar(manifest));
    await expect(readInventory(stream(bytes), bytes.length + 1, DEFAULT_LIMITS)).rejects.toMatchObject({ code: 'FORMAT' });
    await fail(bytes, 'LIMIT', { maxArchiveBytes: bytes.length - 1 });
    await expect(readInventory(stream(bytes), 1, { ...DEFAULT_LIMITS, maxArchiveBytes: bytes.length - 1 })).rejects.toMatchObject({ code: 'LIMIT' });
  });

  it('requires valid checksum, USTAR magic, sizes, complete bodies and two end blocks', async () => {
    const checksum = tar(manifest); checksum[0] ^= 1;
    await fail(gzip(checksum));
    await fail(gzip(tar({ ...manifest, magic: 'bad\0' })), 'UNSUPPORTED');
    await fail(gzip(tarRecord(manifest)));
    await fail(gzip(concat(tarRecord(manifest), new Uint8Array(512))));
    await fail(gzip(concat(tarRecord({ name: 'package/a', body: 'a', size: 2000 }), new Uint8Array(1024))));
    await fail(gzip(tar(manifest, { name: 'package/dir/', type: '5', size: 1 })));
    await fail(gzip(tar(manifest, { name: 'package/slash/', body: 'a' })));
  });

  it('rejects malformed PAX, unsupported extensions and dangling local metadata', async () => {
    await fail(gzip(tar(manifest, { name: 'pax', type: 'x', body: '99 path=package/a\n' }, { name: 'package/a' })));
    await fail(gzip(tar(manifest, { name: 'pax', type: 'x', body: pax(['GNU.sparse.size', '1']) }, { name: 'package/a' })), 'UNSUPPORTED');
    await fail(gzip(tar(manifest, { name: 'pax', type: 'x', body: pax(['path', 'package/a']) })));
    await fail(gzip(tar(manifest, { name: 'pax', type: 'x', body: pax(['size', '-1']) }, { name: 'package/a' })));
  });

  it('checks gzip CRC, size, truncation, member count and nonpadding trailing data', async () => {
    const bytes = gzip(tar(manifest));
    const crc = bytes.slice(); crc[crc.length - 8] ^= 1;
    const size = bytes.slice(); size[size.length - 4] ^= 1;
    await fail(crc); await fail(size); await fail(bytes.subarray(0, bytes.length - 1));
    await fail(concat(bytes, bytes));
    await fail(concat(bytes, new Uint8Array([1])));
    await fail(gzip(concat(tar(manifest), new Uint8Array([1]))));
    expect((await read(concat(bytes, new Uint8Array(9)))).entries).toHaveLength(1);
  });

  it('rejects missing, invalid, nonobject, oversized and deeply nested manifests', async () => {
    await fail(gzip(tar({ name: 'package/a' })));
    for (const body of ['{bad', '[]', 'null', '42', '\ufffd']) await fail(gzip(tar({ ...manifest, body })));
    await fail(gzip(tar(manifest)), 'LIMIT', { maxMetadataBytes: 10 });
    await fail(gzip(tar({ ...manifest, body: '{"a":{"b":1}}' })), 'LIMIT', { maxManifestDepth: 1 });
  });

  it('cancels a pending source read promptly and releases the source', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } });
    const result = readInventory(source, 0, { ...DEFAULT_LIMITS, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancelled).toBe(true);
  });

  it('validates limit configuration and honors an already aborted signal', async () => {
    await fail(gzip(tar(manifest)), 'LIMIT', { maxFileBytes: -1 });
    await fail(gzip(tar(manifest)), 'CANCELLED', { signal: AbortSignal.abort() });
  });
});
