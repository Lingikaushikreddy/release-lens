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
type ChangeFilter = 'all' | FileDelta['kind'];

function LensMark() {
  return <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="11" className="mark-background" /><path d="M11 11h11v5H11zm0 7h16v5H11zm0 7h9v5h-9z" className="mark-bars" /><path d="M28 9v22" className="mark-line" /></svg>;
}

function ArchiveIcon() {
  return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="m9 14 15-8 15 8v20l-15 8-15-8V14Z" /><path d="m9 14 15 8 15-8M24 22v20M17 10l15 8v8l-5 2v-8" /></svg>;
}

function ArchivePicker({ side, file, onChange }: { side: 'Before' | 'After'; file: File | null; onChange: (file: File | null) => void }) {
  const [dragging, setDragging] = useState(false);
  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) onChange(event.dataTransfer.files[0]);
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.files?.[0] ?? null);
    event.target.value = '';
  }
  return <section className={`archive-picker archive-${side.toLowerCase()}${dragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={drop}>
    <div className="archive-label"><label htmlFor={`${side}-file`}>{side} archive</label><span>{side === 'Before' ? 'The release you trust' : 'The candidate to review'}</span></div>
    <div className="archive-symbol"><ArchiveIcon />{file && <span className="selected-check" aria-label="Archive selected">✓</span>}</div>
    <div className="archive-name">{file ? file.name : 'Drop your .tgz here'}</div>
    <div className="archive-detail">{file ? `${bytes(file.size)} compressed` : 'or choose an archive from your device'}</div>
    <label className="file-select" htmlFor={`${side}-file`}>{file ? 'Change archive' : 'Browse files'}<span aria-hidden="true">↗</span></label>
    <input className="archive-input" id={`${side}-file`} type="file" accept=".tgz,.tar.gz,application/gzip,application/x-gzip" aria-label={`${side} archive`} onChange={choose} />
  </section>;
}

function CategoryChart({ report, selected, onSelect }: { report: Report; selected: Category | null; onSelect: (category: Category | null) => void }) {
  const totals = categories.map(category => {
    const files = report.fileDeltas.filter(file => file.category === category);
    return { category, delta: files.reduce((sum, file) => sum + file.delta, 0), count: files.length };
  });
  const max = Math.max(...totals.map(item => Math.abs(item.delta)), 1);
  return <section id="categories" className="panel category-section" aria-labelledby="categories-heading">
    <div className="section-heading"><div><h2 id="categories-heading">Where the bytes changed</h2><p>Select a category to explore its files. Contributions add up to {signed(report.unpackedDelta, true)}.</p></div><span className="subtle-tag">Filename heuristics</span></div>
    <div className="category-rows">{totals.map(({ category, delta, count }) => <button className="category-row" key={category} aria-label={`Filter files by ${category}`} aria-describedby={`category-${category.replaceAll(' ', '-')}-count category-${category.replaceAll(' ', '-')}-delta`} aria-pressed={selected === category} onClick={() => onSelect(selected === category ? null : category)}>
      <span className="category-name">{category}<span id={`category-${category.replaceAll(' ', '-')}-count`}>{integer.format(count)} {count === 1 ? 'path' : 'paths'}</span></span>
      <svg viewBox="0 0 400 16" preserveAspectRatio="none" aria-hidden="true"><line x1="200" x2="200" y1="0" y2="16" className="chart-axis" /><rect x={delta < 0 ? 200 - Math.abs(delta) / max * 196 : 200} y="3" width={Math.abs(delta) / max * 196} height="10" rx="3" className={`bar-${direction(delta)}`} /></svg>
      <span id={`category-${category.replaceAll(' ', '-')}-delta`} className={`numeric ${direction(delta)}`}>{signed(delta)}<span className="category-action" aria-hidden="true">↗</span></span>
    </button>)}</div>
    <p className="footnote">Categories are inferred from filenames. They describe packaging contents and do not establish whether a file is needed.</p>
  </section>;
}

function Files({ report, category, onClearCategory }: { report: Report; category: Category | null; onClearCategory: () => void }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('growth');
  const [change, setChange] = useState<ChangeFilter>('all');
  const [limit, setLimit] = useState(300);
  const counts = useMemo(() => ({ all: report.fileDeltas.filter(file => file.kind !== 'unchanged').length, added: report.fileDeltas.filter(file => file.kind === 'added').length, removed: report.fileDeltas.filter(file => file.kind === 'removed').length, modified: report.fileDeltas.filter(file => file.kind === 'modified').length, unchanged: report.fileDeltas.filter(file => file.kind === 'unchanged').length }), [report]);
  const files = useMemo(() => report.fileDeltas.filter(file => (change === 'all' ? file.kind !== 'unchanged' : file.kind === change) && (!category || file.category === category) && file.path.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    const pathOrder = a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    return sort === 'path' ? pathOrder : (sort === 'size' ? b.afterBytes - a.afterBytes : b.delta - a.delta) || pathOrder;
  }), [report, search, sort, change, category]);
  const filters: { value: ChangeFilter; label: string }[] = [{ value: 'all', label: 'All changes' }, { value: 'added', label: 'Added' }, { value: 'removed', label: 'Removed' }, { value: 'modified', label: 'Modified' }, { value: 'unchanged', label: 'Unchanged' }];
  return <section id="files" className="panel file-section" aria-labelledby="files-heading">
    <div className="section-heading"><div><h2 id="files-heading">File changes</h2><p>Follow any path down to exact sizes and SHA-256 evidence.</p></div><span className="count">{integer.format(report.fileDeltas.length)} paths</span></div>
    <fieldset className="change-filters" aria-describedby="filter-counts-note"><legend className="sr-only">Filter by change</legend>{filters.map(filter => <button key={filter.value} aria-pressed={change === filter.value} onClick={() => { setChange(filter.value); setLimit(300); }}>{filter.label} <span>({integer.format(counts[filter.value])})</span></button>)}</fieldset>
    <div className="file-tools"><label className="search-label"><span>Search file paths</span><input type="search" value={search} placeholder="Search a file or directory…" onChange={event => { setSearch(event.target.value); setLimit(300); }} /></label><fieldset className="sort-group"><legend>Sort files</legend><div className="sort-buttons"><button aria-pressed={sort === 'growth'} onClick={() => setSort('growth')}>Growth</button><button aria-pressed={sort === 'size'} onClick={() => setSort('size')}>After size</button><button aria-pressed={sort === 'path'} onClick={() => setSort('path')}>Path A–Z</button></div></fieldset></div>
    <p id="filter-counts-note" className="sr-only">Change counts cover all archive paths. Category and search filters further narrow the table.</p>
    <div className="file-results-label"><p role="status">Showing {integer.format(Math.min(files.length, limit))} of {integer.format(files.length)} matching paths</p>{category && <div className="active-category"><span>Category: {category}</span><button onClick={() => { onClearCategory(); setLimit(300); }}>Clear category filter</button></div>}</div>
    <div className="table-scroll"><table><caption className="sr-only">Package file comparison</caption><thead><tr><th scope="col">Path / change</th><th scope="col" className="numeric">Before</th><th scope="col" className="numeric">After</th><th scope="col" className="numeric">Change</th></tr></thead><tbody>{files.slice(0, limit).map(file => <FileRow key={file.path} file={file} />)}</tbody></table></div>
    {files.length === 0 && <div className="empty-list"><strong>No paths match these filters.</strong><p>Try another change type, clear the category, or search for a different path.</p><button onClick={() => { setSearch(''); setChange('all'); onClearCategory(); setLimit(300); }}>Reset file filters</button></div>}
    {files.length > limit && <div className="table-more"><p>Showing {limit} of {integer.format(files.length)} matching paths.</p><button onClick={() => setLimit(limit + 300)}>Show 300 more files</button></div>}
  </section>;
}

function FileRow({ file }: { file: FileDelta }) {
  return <tr><td><details><summary><span className="file-path">{file.path}</span><span className={`kind kind-${file.kind}`}>{file.kind}</span></summary><div className="file-evidence"><p>Category: {file.category} (filename heuristic)</p><p>Before SHA-256 <code>{file.beforeHash ?? '(missing)'}</code></p><p>After SHA-256 <code>{file.afterHash ?? '(missing)'}</code></p></div></details></td><td className="numeric">{bytes(file.beforeBytes)}</td><td className="numeric">{bytes(file.afterBytes)}</td><td className={`numeric ${direction(file.delta)}`}>{signed(file.delta, true)}</td></tr>;
}

function Evidence({ report }: { report: Report }) {
  const missingAfter = report.findings.filter(finding => finding.side === 'after' && finding.code === 'MISSING_LITERAL_TARGET');
  return <div id="evidence" className="evidence-grid">
    <section className="panel" aria-labelledby="manifest-heading"><div className="section-heading"><div><h2 id="manifest-heading">Manifest changes</h2><p>Selected package.json fields, with exact JSON pointers.</p></div><span className="count">{report.manifestChanges.length}</span></div>
      {report.manifestChanges.length === 0 ? <p className="empty-list">No changes in the inspected manifest fields.</p> : <div className="manifest-list">{report.manifestChanges.map(change => <article className="manifest-change" key={change.pointer}><h3><code>{change.pointer}</code></h3><dl><div><dt>Before</dt><dd><pre>{valueText(change.before, change.beforeExists)}</pre></dd></div><div><dt>After</dt><dd><pre>{valueText(change.after, change.afterExists)}</pre></dd></div></dl></article>)}</div>}
    </section>
    <section className="panel" aria-labelledby="findings-heading"><div className="section-heading"><div><h2 id="findings-heading">Target findings</h2><p>Literal local file existence checks only.</p></div><span className="count">{report.findings.length}</span></div>
      {missingAfter.length === 0 && <p className="finding-clear"><span aria-hidden="true">✓</span> No missing local targets in the after archive.</p>}
      {report.findings.length > 0 && <ul className="findings-list">{report.findings.map((finding, index) => <li key={`${finding.side}-${finding.pointer}-${index}`} className={`finding finding-${finding.severity}`}><div className="finding-label"><span>{finding.side === 'before' ? 'Before' : 'After'} archive</span><span>{finding.severity === 'warning' ? 'Missing target' : 'Unchecked'}</span></div><p>{finding.message}</p>{finding.pointer && <code>{finding.pointer}</code>}{finding.paths.map(path => <p className="finding-path" key={path}>{path}</p>)}</li>)}</ul>}
      <p className="footnote findings-note">These checks do not resolve dependencies or establish compatibility, security, or install behavior. Patterns and unsupported targets are reported as unchecked.</p>
    </section>
  </div>;
}

function Review({ report, onDownload, onClean, isExample }: { report: Report; onDownload: () => void; onClean: () => void; isExample: boolean }) {
  const [category, setCategory] = useState<Category | null>(null);
  const changed = report.fileDeltas.filter(file => file.kind !== 'unchanged');
  const missing = report.findings.filter(finding => finding.side === 'after' && finding.code === 'MISSING_LITERAL_TARGET');
  return <div className="results">
    <div className="results-navigation"><p><span className="complete-dot" />Comparison ready</p><nav aria-label="Review sections"><a href="#summary">Overview</a><a href="#categories">Categories</a><a href="#files">Files</a><a href="#evidence">Manifest &amp; targets</a></nav></div>
    <section id="summary" className="panel review-summary" aria-labelledby="summary-heading">
      <div className="section-heading"><div><h2 id="summary-heading">Review summary</h2><p>{changed.length} changed {changed.length === 1 ? 'file' : 'files'}; {missing.length} missing local {missing.length === 1 ? 'target' : 'targets'} in the after archive.</p></div><button onClick={onDownload} className="secondary"><span aria-hidden="true">↓</span> Download JSON</button></div>
      <div className="measurement-grid"><div className="measurement primary-measurement"><h3>Unpacked payload</h3><p className={`measurement-value ${direction(report.unpackedDelta)}`}>{signed(report.unpackedDelta)}</p><p className="exact-value">{signed(report.unpackedDelta, true)}</p><p className="measurement-comparison">{bytes(report.before.unpackedBytes)} <span aria-label="to">→</span> {bytes(report.after.unpackedBytes)}</p></div><div className="measurement"><h3>Gzip archive</h3><p className={`measurement-value ${direction(report.archiveDelta)}`}>{signed(report.archiveDelta)}</p><p className="exact-value">{signed(report.archiveDelta, true)}</p><p className="measurement-comparison">{bytes(report.before.archiveBytes)} <span aria-label="to">→</span> {bytes(report.after.archiveBytes)}</p></div><div className="budget-result"><span className={`budget-badge budget-${report.budget}`}>{report.budget === 'fail' ? 'Budget exceeded' : report.budget === 'pass' ? 'Within budget' : 'No budget set'}</span><p>Growth budget compares the exact unpacked byte delta, with an inclusive boundary.</p></div></div>
      <p className="footnote">Unpacked payload is the sum of regular-file bytes. Gzip is measured separately. Neither measurement is installed footprint.</p>
      {isExample && <div className="example-followup"><div><span className="example-step">Next in the example</span><p>Those added fixtures and the missing bin target have a fix. See what changes in the corrected package.</p></div><button onClick={onClean}>Compare clean follow-up</button></div>}
    </section>
    <CategoryChart report={report} selected={category} onSelect={setCategory} /><Files report={report} category={category} onClearCategory={() => setCategory(null)} /><Evidence report={report} />
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
  function swapArchives() {
    clearWork(); setIsExample(false); setBefore(after); setAfter(before);
    setStatus('Archives swapped. Compare again to review this direction.');
  }
  function changeBudget(value: string) {
    clearWork(); setBudget(value);
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
  return <>
    <a className="skip-link" href="#main" tabIndex={0}>Skip to comparison</a>
    <header className="app-header"><a href="#main" className="brand" aria-label="Release Lens home"><LensMark /><span>Release Lens</span><span className="version">Open source</span></a><nav className="header-nav" aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="https://github.com/Lingikaushikreddy/release-lens" target="_blank" rel="noopener noreferrer">GitHub <span aria-hidden="true">↗</span></a></nav></header>
    <main id="main" tabIndex={-1}>
      <div className="intro"><div className="intro-copy"><h1>A closer look.<br />A better release.</h1><p>See exactly what your npm package ships. Compare two archives, trace every byte, and catch missing targets before you publish.</p><button className="hero-example-button" onClick={() => void loadExample()}>Explore an example <span aria-hidden="true">↗</span></button></div><div className="intro-note"><span className="privacy-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></svg></span><div><strong>Your files. Your device.</strong><p>No upload, no install.<br />Just a clearer view of your release.</p></div></div></div>
      <section className="comparison-panel" aria-label="Archive comparison"><div className="comparison-heading"><div><h2>Compare your archives</h2><p>One trusted release. One new candidate.</p></div><span className="local-label"><span />Local analysis</span></div><div className="archive-workspace"><div className="archive-pair"><ArchivePicker side="Before" file={before} onChange={file => replace('before', file)} /><button className="swap-button" onClick={swapArchives} aria-label="Swap archives" title="Swap before and after archives" disabled={busy || !before || !after}><span aria-hidden="true">⇄</span></button><ArchivePicker side="After" file={after} onChange={file => replace('after', file)} /></div><div className="compare-controls"><div className="budget-title"><label htmlFor="budget">Growth budget in bytes <span>(optional)</span></label><p>Maximum unpacked growth. Equal to the limit passes.</p></div><input id="budget" type="text" inputMode="numeric" value={budget} placeholder="No growth limit" autoComplete="off" onChange={event => changeBudget(event.target.value)} /><fieldset className="budget-presets"><legend className="sr-only">Budget presets</legend>{[{ label: 'None', value: '' }, { label: '1 MiB', value: '1048576' }, { label: '10 MiB', value: '10485760' }].map(preset => <button key={preset.label} aria-pressed={budget === preset.value} onClick={() => changeBudget(preset.value)}>{preset.label}</button>)}</fieldset><div className="action-row"><button className="primary" onClick={() => start()} disabled={busy}>Compare archives<span aria-hidden="true">↗</span></button>{busy && <button className="cancel-button" onClick={() => { clearWork(); setStatus('Analysis cancelled. You can compare again.'); }}>Cancel analysis</button>}</div></div></div><p className="privacy-note"><span aria-hidden="true">✓</span> Archive contents are read locally. Package scripts are never run.<span className="format-note">.tgz / .tar.gz</span></p></section>
      {error && <div className="error-box" role="alert"><strong>Comparison needs attention</strong><p>{error}</p></div>}
      <div role="status" aria-live="polite" className={`analysis-status${busy ? ' is-busy' : ''}`}>{status}{busy && <progress aria-label="Analysis in progress" />}</div>
      {report ? <Review report={report} onDownload={download} onClean={() => void loadExample(true)} isExample={isExample} /> : !busy && !error && <section className="empty-state"><div className="example-invitation"><div className="example-visual" aria-hidden="true"><span className="mini-archive">.tgz</span><span className="example-connection"><i /><i /><i /></span><span className="mini-report"><span /><span /><span /></span></div><div className="example-copy"><h2>Try a release with something to find.</h2><p>Explore an example with extra fixtures and a missing bin target. Then compare the fix.</p><button className="example-button" onClick={() => void loadExample()}>Compare example releases <span aria-hidden="true">↗</span></button></div></div><p className="limits-note">Limits: 25 MiB compressed per archive, 150 MiB expanded, 20,000 entries, 16 MiB per file. Supported tar/gzip inputs only.</p></section>}
      <div id="how-it-works" className="how-it-works"><h2>From archive to evidence.</h2><ol><li><span>1</span><div><h3>Choose two releases</h3><p>Use the .tgz archives from npm pack or a registry download.</p></div></li><li><span>2</span><div><h3>Follow the changes</h3><p>Explore file sizes, hashes, manifest fields, and literal targets.</p></div></li><li><span>3</span><div><h3>Keep the evidence</h3><p>Download deterministic JSON for a review or your release records.</p></div></li></ol></div>
      <footer><div className="footer-brand"><strong>Release Lens</strong><p>Exact bytes. Clear evidence.</p></div><div className="footer-links"><a href="https://www.npmjs.com/package/@kaushikgojo/release-lens" target="_blank" rel="noopener noreferrer">Get the CLI ↗</a><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.md`}>Licenses &amp; notices</a><span>Schema v1</span></div></footer>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
