import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Category, FileDelta, Report } from '../../../packages/core/src/types';
import AnalysisWorker from './analysis.worker?worker&inline';
import './styles.css';

const categories: Category[] = ['source maps', 'code', 'types', 'documentation', 'tests and fixtures', 'other'];
const integer = new Intl.NumberFormat('en-US');
const bytes = (value: number) => `${integer.format(value)} B`;
function size(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude < 1024) return bytes(magnitude);
  if (magnitude < 1024 ** 2) return `${(magnitude / 1024).toFixed(2)} KiB`;
  return `${(magnitude / 1024 ** 2).toFixed(2)} MiB`;
}
const signed = (value: number, exact = false) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${exact ? bytes(Math.abs(value)) : size(value)}`;
const direction = (value: number) => value > 0 ? 'growth' : value < 0 ? 'reduction' : 'neutral';
const valueText = (value: unknown, exists: boolean) => exists ? JSON.stringify(value, null, 2) : '(missing)';

type WorkerMessage = { type: 'progress'; message: string } | { type: 'error'; message: string } | { type: 'complete'; report: Report; json: string };

function ArchivePicker({ side, file, onChange }: { side: 'Before' | 'After'; file: File | null; onChange: (file: File | null) => void }) {
  const [dragging, setDragging] = useState(false);
  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) onChange(event.dataTransfer.files[0]);
  }
  return <section className={`archive-picker${dragging ? ' is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
    <label htmlFor={`${side}-file`}>{side} archive</label>
    <div className="archive-name">{file ? file.name : 'Choose a package .tgz'}</div>
    <div className="archive-detail">{file ? `${bytes(file.size)} compressed` : 'Drop a file here or browse locally'}</div>
    <input id={`${side}-file`} type="file" accept=".tgz,.tar.gz,application/gzip,application/x-gzip" aria-label={`${side} archive`} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.files?.[0] ?? null)} />
  </section>;
}

function CategoryChart({ report }: { report: Report }) {
  const totals = categories.map(category => ({ category, delta: report.fileDeltas.filter(file => file.category === category).reduce((sum, file) => sum + file.delta, 0) }));
  const max = Math.max(...totals.map(item => Math.abs(item.delta)), 1);
  return <section className="panel category-section" aria-labelledby="categories-heading">
    <div className="section-heading"><div><h2 id="categories-heading">Where the bytes changed</h2><p>Regular-file payload contributions add up to {signed(report.unpackedDelta, true)}.</p></div><span className="subtle-tag">Filename heuristics</span></div>
    <div className="category-rows">{totals.map(({ category, delta }) => <div className="category-row" key={category}>
      <span>{category}</span>
      <svg viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true"><line x1="200" x2="200" y1="0" y2="12" className="chart-axis" /><rect x={delta < 0 ? 200 - Math.abs(delta) / max * 196 : 200} y="2" width={Math.abs(delta) / max * 196} height="8" rx="2" className={`bar-${direction(delta)}`} /></svg>
      <span className={`numeric ${direction(delta)}`}>{signed(delta)}</span>
    </div>)}</div>
    <p className="footnote">Categories are inferred from filenames. They describe packaging contents and do not establish whether a file is needed.</p>
  </section>;
}

function Files({ report }: { report: Report }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('growth');
  const [changedOnly, setChangedOnly] = useState(true);
  const [limit, setLimit] = useState(300);
  const files = useMemo(() => report.fileDeltas.filter(file => (!changedOnly || file.kind !== 'unchanged') && file.path.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    const pathOrder = a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    return sort === 'path' ? pathOrder : (sort === 'size' ? b.afterBytes - a.afterBytes : b.delta - a.delta) || pathOrder;
  }), [report, search, sort, changedOnly]);
  return <section className="panel file-section" aria-labelledby="files-heading">
    <div className="section-heading"><div><h2 id="files-heading">File changes</h2><p>Inspect exact sizes and SHA-256 evidence for each path.</p></div><span className="count">{integer.format(report.fileDeltas.length)} paths</span></div>
    <div className="file-tools"><label className="search-label"><span>Search file paths</span><input type="search" value={search} placeholder="Filter by path…" onChange={event => { setSearch(event.target.value); setLimit(300); }} /></label><fieldset className="sort-group"><legend>Sort files</legend><div className="sort-buttons"><button aria-pressed={sort === 'growth'} onClick={() => setSort('growth')}>Growth</button><button aria-pressed={sort === 'size'} onClick={() => setSort('size')}>After size</button><button aria-pressed={sort === 'path'} onClick={() => setSort('path')}>Path A–Z</button></div></fieldset><label className="checkbox-label"><input type="checkbox" checked={changedOnly} onChange={event => setChangedOnly(event.target.checked)} />Changed only</label></div>
    <div className="table-scroll"><table><caption className="sr-only">Package file comparison</caption><thead><tr><th scope="col">Path / change</th><th scope="col" className="numeric">Before</th><th scope="col" className="numeric">After</th><th scope="col" className="numeric">Change</th></tr></thead><tbody>{files.slice(0, limit).map(file => <FileRow key={file.path} file={file} />)}</tbody></table></div>
    {files.length === 0 && <p className="empty-list">No files match this search.</p>}
    {files.length > limit && <div className="table-more"><p>Showing {limit} of {integer.format(files.length)} matching paths.</p><button onClick={() => setLimit(limit + 300)}>Show 300 more files</button></div>}
  </section>;
}

function FileRow({ file }: { file: FileDelta }) {
  return <tr><td><details><summary><span className="file-path">{file.path}</span><span className={`kind kind-${file.kind}`}>{file.kind}</span></summary><div className="file-evidence"><p>Category: {file.category} (filename heuristic)</p><p>Before SHA-256 <code>{file.beforeHash ?? '(missing)'}</code></p><p>After SHA-256 <code>{file.afterHash ?? '(missing)'}</code></p></div></details></td><td className="numeric">{bytes(file.beforeBytes)}</td><td className="numeric">{bytes(file.afterBytes)}</td><td className={`numeric ${direction(file.delta)}`}>{signed(file.delta, true)}</td></tr>;
}

function Evidence({ report }: { report: Report }) {
  const missingAfter = report.findings.filter(finding => finding.side === 'after' && finding.code === 'MISSING_LITERAL_TARGET');
  return <div className="evidence-grid">
    <section className="panel" aria-labelledby="manifest-heading"><div className="section-heading"><div><h2 id="manifest-heading">Manifest changes</h2><p>Selected package.json fields, with exact JSON pointers.</p></div><span className="count">{report.manifestChanges.length}</span></div>
      {report.manifestChanges.length === 0 ? <p className="empty-list">No changes in the inspected manifest fields.</p> : <div className="manifest-list">{report.manifestChanges.map(change => <article className="manifest-change" key={change.pointer}><h3><code>{change.pointer}</code></h3><dl><div><dt>Before</dt><dd><pre>{valueText(change.before, change.beforeExists)}</pre></dd></div><div><dt>After</dt><dd><pre>{valueText(change.after, change.afterExists)}</pre></dd></div></dl></article>)}</div>}
    </section>
    <section className="panel" aria-labelledby="findings-heading"><div className="section-heading"><div><h2 id="findings-heading">Target findings</h2><p>Literal local file existence checks only.</p></div><span className="count">{report.findings.length}</span></div>
      {missingAfter.length === 0 && <p className="finding-clear">No missing local targets in the after archive.</p>}
      {report.findings.length > 0 && <ul className="findings-list">{report.findings.map((finding, index) => <li key={`${finding.side}-${finding.pointer}-${index}`} className={`finding finding-${finding.severity}`}><div className="finding-label"><span>{finding.side === 'before' ? 'Before' : 'After'} archive</span><span>{finding.severity === 'warning' ? 'Missing target' : 'Unchecked'}</span></div><p>{finding.message}</p>{finding.pointer && <code>{finding.pointer}</code>}{finding.paths.map(path => <p className="finding-path" key={path}>{path}</p>)}</li>)}</ul>}
      <p className="footnote findings-note">These checks do not resolve dependencies or establish compatibility, security, or install behavior. Patterns and unsupported targets are reported as unchecked.</p>
    </section>
  </div>;
}

function Review({ report, onDownload, onClean, isExample }: { report: Report; onDownload: () => void; onClean: () => void; isExample: boolean }) {
  const changed = report.fileDeltas.filter(file => file.kind !== 'unchanged');
  const missing = report.findings.filter(finding => finding.side === 'after' && finding.code === 'MISSING_LITERAL_TARGET');
  return <div className="results">
    <section className="panel review-summary" aria-labelledby="summary-heading">
      <div className="section-heading"><div><h2 id="summary-heading">Review summary</h2><p>{changed.length} changed {changed.length === 1 ? 'file' : 'files'}; {missing.length} missing local {missing.length === 1 ? 'target' : 'targets'} in the after archive.</p></div><button onClick={onDownload} className="secondary">Download JSON</button></div>
      <div className="measurement-grid"><div className="measurement primary-measurement"><h3>Unpacked payload</h3><p className={`measurement-value ${direction(report.unpackedDelta)}`}>{signed(report.unpackedDelta)}</p><p className="exact-value">{signed(report.unpackedDelta, true)}</p><p className="measurement-comparison">{bytes(report.before.unpackedBytes)} <span aria-label="to">→</span> {bytes(report.after.unpackedBytes)}</p></div><div className="measurement"><h3>Gzip archive</h3><p className={`measurement-value ${direction(report.archiveDelta)}`}>{signed(report.archiveDelta)}</p><p className="exact-value">{signed(report.archiveDelta, true)}</p><p className="measurement-comparison">{bytes(report.before.archiveBytes)} <span aria-label="to">→</span> {bytes(report.after.archiveBytes)}</p></div><div className="budget-result"><span className={`budget-badge budget-${report.budget}`}>{report.budget === 'fail' ? 'Budget exceeded' : report.budget === 'pass' ? 'Within budget' : 'No budget set'}</span><p>Growth budget compares the exact unpacked byte delta, with an inclusive boundary.</p></div></div>
      <p className="footnote">Unpacked payload is the sum of regular-file bytes. Gzip is measured separately. Neither measurement is installed footprint.</p>
      {isExample && <div className="example-followup"><p><strong>Example review:</strong> inspect the added fixtures and the missing bin target, then compare the corrected package.</p><button onClick={onClean}>Compare clean follow-up</button></div>}
    </section>
    <CategoryChart report={report} /><Files key={report.after.archiveBytes + ':' + report.after.unpackedBytes} report={report} /><Evidence report={report} />
  </div>;
}

function App() {
  const [before, setBefore] = useState<File | null>(null);
  const [after, setAfter] = useState<File | null>(null);
  const [budget, setBudget] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isExample, setIsExample] = useState(false);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; worker.current?.terminate(); }, []);
  function clearWork() {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    setReport(null); setJson(''); setBusy(false); setError(''); setStatus('');
  }
  function replace(side: 'before' | 'after', file: File | null) {
    clearWork(); setIsExample(false);
    (side === 'before' ? setBefore : setAfter)(file);
  }
  function start(left = before, right = after) {
    clearWork();
    if (!left || !right) { setError('Choose both a before archive and an after archive.'); return; }
    if (budget !== '' && (!/^\d+$/.test(budget) || !Number.isSafeInteger(Number(budget)))) { setError('Enter a nonnegative whole number of bytes within the safe integer range, or leave the budget empty.'); return; }
    const id = generation.current;
    setBusy(true); setStatus('Starting local analysis…');
    try {
      const current = new AnalysisWorker();
      worker.current = current;
      current.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (generation.current !== id) return;
        if (event.data.type === 'progress') { setStatus(event.data.message); return; }
        current.terminate(); worker.current = null; setBusy(false);
        if (event.data.type === 'error') { setError(event.data.message); setStatus(''); return; }
        setReport(event.data.report); setJson(event.data.json); setStatus('Analysis complete.');
      };
      current.onerror = () => {
        if (generation.current !== id) return;
        current.terminate(); worker.current = null; setBusy(false); setStatus(''); setError('The analysis worker could not run. Reload the application and try again.');
      };
      current.postMessage({ before: left, after: right, budget: budget === '' ? undefined : Number(budget) });
    } catch { setBusy(false); setStatus(''); setError('This browser could not start local analysis. Use a current browser and try again.'); }
  }
  async function loadExample(clean = false) {
    clearWork(); setBusy(true); setStatus('Loading local example archives…');
    const id = generation.current;
    try {
      const files = await Promise.all([clean ? 'after' : 'before', clean ? 'clean' : 'after'].map(async name => {
        const response = await fetch(`${import.meta.env.BASE_URL}examples/${name}.tgz`);
        if (!response.ok) throw new Error('Example archive unavailable.');
        return new File([await response.blob()], `${name}.tgz`, { type: 'application/gzip' });
      }));
      if (id !== generation.current) return;
      setBefore(files[0]); setAfter(files[1]); setIsExample(!clean); start(files[0], files[1]);
    } catch { if (id === generation.current) { setBusy(false); setStatus(''); setError('The example archives could not load. Choose local .tgz files or try the example again.'); } }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'release-lens-report.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <><a className="skip-link" href="#main" tabIndex={0}>Skip to comparison</a><header className="app-header"><div className="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="6" /><path d="M10 8h10v4H10zm0 6h14v4H10zm0 6h8v4h-8z" /></svg><span>Release Lens</span><span className="version">0.1</span></div><span className="local-label"><span aria-hidden="true">●</span> Runs on your device</span></header>
    <main id="main" tabIndex={-1}><div className="intro"><div><h1>Review what your package ships.</h1><p>Compare two npm tarballs before you publish. Trace size changes to files and check manifest targets.</p></div><button className="example-button" onClick={() => void loadExample()}>Compare example releases</button></div>
      <section className="comparison-panel" aria-label="Archive comparison"><div className="archive-pair"><ArchivePicker side="Before" file={before} onChange={file => replace('before', file)} /><div className="pair-direction" aria-hidden="true">→</div><ArchivePicker side="After" file={after} onChange={file => replace('after', file)} /></div><div className="compare-controls"><label htmlFor="budget">Growth budget in bytes <span>(optional)</span></label><input id="budget" type="text" inputMode="numeric" value={budget} placeholder="e.g. 1048576" autoComplete="off" onChange={event => { clearWork(); setBudget(event.target.value); }} /><p>Maximum unpacked growth. Equal to the limit passes.</p><div className="action-row"><button className="primary" onClick={() => start()} disabled={busy}>Compare archives</button>{busy && <button onClick={() => { clearWork(); setStatus('Analysis cancelled. You can compare again.'); }}>Cancel analysis</button>}</div></div><p className="privacy-note">Files stay in this browser. Archive contents are read locally; package scripts are never run.</p></section>
      {error && <div className="error-box" role="alert"><strong>Comparison needs attention</strong><p>{error}</p></div>}
      <div role="status" aria-live="polite" className={`analysis-status${busy ? ' is-busy' : ''}`}>{status}{busy && <progress aria-label="Analysis in progress" />}</div>
      {report ? <Review report={report} onDownload={download} onClean={() => void loadExample(true)} isExample={isExample} /> : !busy && !error && <section className="empty-state"><div className="empty-rail" aria-hidden="true"><span /><span /><span /></div><h2>Start with the release you trust.</h2><p>Choose its archive as Before and your candidate as After. The review will show exact byte changes, file hashes, manifest differences, and local target findings.</p><p className="limits-note">Limits: 25 MiB compressed per archive, 150 MiB expanded, 20,000 entries, 16 MiB per file. Supported tar/gzip inputs only.</p></section>}
      <footer><span>Release Lens</span><p>Schema v1 · Exact bytes, explicit limits, reproducible JSON.</p><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`}>Licenses &amp; notices</a></footer>
    </main></>;
}

createRoot(document.getElementById('root')!).render(<App />);
