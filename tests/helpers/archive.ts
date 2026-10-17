import { gzipSync } from 'node:zlib';

const enc = new TextEncoder();
export function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export type RecordSpec = { name: string; body?: string | Uint8Array; type?: string; size?: number; magic?: string };
export function tarRecord(spec: RecordSpec): Uint8Array {
  const body = typeof spec.body === 'string' ? enc.encode(spec.body) : spec.body ?? new Uint8Array();
  const header = new Uint8Array(512);
  const field = (offset: number, length: number, text: string) => header.set(enc.encode(text).subarray(0, length), offset);
  const octal = (offset: number, length: number, n: number) => field(offset, length, n.toString(8).padStart(length - 1, '0') + '\0');
  field(0, 100, spec.name); octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0);
  octal(124, 12, spec.size ?? body.length); octal(136, 12, 0);
  header.fill(32, 148, 156); field(156, 1, spec.type ?? '0'); field(257, 6, spec.magic ?? 'ustar\0'); field(263, 2, '00');
  const sum = header.reduce((n, byte) => n + byte, 0);
  field(148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return concat(header, body, new Uint8Array((512 - body.length % 512) % 512));
}
export function tar(...records: RecordSpec[]): Uint8Array { return concat(...records.map(tarRecord), new Uint8Array(1024)); }
export function gzip(bytes: Uint8Array): Uint8Array { return new Uint8Array(gzipSync(bytes, { mtime: 0 } as never)); }
export function pax(...pairs: [string, string][]): string {
  return pairs.map(([key, value]) => {
    const body = ` ${key}=${value}\n`;
    let length = enc.encode(body).length + 1;
    while (length !== enc.encode(body).length + String(length).length) length = enc.encode(body).length + String(length).length;
    return `${length}${body}`;
  }).join('');
}
export function stream(bytes: Uint8Array, chunkSize = bytes.length || 1): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.subarray(offset, offset += Math.min(chunkSize, bytes.length - offset)));
  } });
}
