export type Entry = { path: string; bytes: number; sha256: string };
export type Inventory = { schemaVersion: 1; archiveBytes: number; unpackedBytes: number; entries: Entry[]; manifest: Record<string, unknown> };
export type Category = 'source maps' | 'code' | 'types' | 'documentation' | 'tests and fixtures' | 'other';
export type FileDelta = { path: string; beforeBytes: number; afterBytes: number; delta: number; kind: 'added' | 'removed' | 'modified' | 'unchanged'; category: Category; beforeHash: string | null; afterHash: string | null };
export type ManifestChange = { pointer: string; before: unknown; after: unknown; beforeExists: boolean; afterExists: boolean };
export type Finding = { code: string; severity: 'info' | 'warning'; message: string; paths: string[]; pointer?: string; side?: 'before' | 'after' };
export type Report = { schemaVersion: 1; before: Inventory; after: Inventory; fileDeltas: FileDelta[]; manifestChanges: ManifestChange[]; findings: Finding[]; unpackedDelta: number; archiveDelta: number; budget: 'unset' | 'pass' | 'fail' };
export type Limits = { maxArchiveBytes: number; maxExpandedBytes: number; maxEntries: number; maxFileBytes: number; maxMetadataBytes: number; maxManifestDepth: number; signal?: AbortSignal };
export const DEFAULT_LIMITS: Limits = { maxArchiveBytes: 25 * 1024 ** 2, maxExpandedBytes: 150 * 1024 ** 2, maxEntries: 20000, maxFileBytes: 16 * 1024 ** 2, maxMetadataBytes: 1024 * 1024, maxManifestDepth: 64 };
export class AnalysisError extends Error {
  constructor(public readonly code: 'FORMAT' | 'LIMIT' | 'UNSUPPORTED' | 'CANCELLED', message: string) { super(message); this.name = 'AnalysisError'; }
}
