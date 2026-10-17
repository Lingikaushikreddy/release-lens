#!/usr/bin/env python3
"""Assemble the already verified local candidate without publishing anything."""
import argparse,hashlib,json,shutil,subprocess,tarfile,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--cli-artifact');args=parser.parse_args()
manifest=json.loads((root/'packages/cli/package.json').read_text())
version=manifest['version'];package=manifest['name']
if json.loads((root/'package.json').read_text()).get('version')!=version:
    parser.error('Workspace and CLI versions must match')
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
assert (root/'dist/web/index.html').exists(),'Run pnpm build first'
# Retain the existing GitHub download filename while the tarball's package
# identity follows packages/cli/package.json, including its npm scope.
cli=out/f'releaselens-{version}.tgz'
if args.cli_artifact:
    provided=Path(args.cli_artifact).resolve()
    try:
        with tarfile.open(provided,'r:gz') as archive:
            manifests=[member for member in archive.getmembers() if member.name=='package/package.json']
            if len(manifests)!=1 or not manifests[0].isfile():
                raise ValueError('expected one regular package/package.json')
            packed_manifest=json.load(archive.extractfile(manifests[0]))
        if packed_manifest.get('name')!=package or packed_manifest.get('version')!=version:
            raise ValueError(f'expected {package}@{version}')
    except (OSError,tarfile.TarError,ValueError,AttributeError) as error:
        parser.error(f'CLI artifact identity is invalid: {error}')
    if provided!=cli:shutil.copy2(provided,cli)
else:
    pack=subprocess.run(['npm','pack',str(root/'packages/cli'),'--ignore-scripts','--json','--pack-destination',str(out)],capture_output=True,text=True,check=True)
    metadata=json.loads(pack.stdout)[0];packed=out/metadata['filename']
    if packed!=cli:packed.replace(cli)
# Frozen source, without dependencies, runtime scratch or generated copies.
source=out/'source';source.mkdir(exist_ok=True)
items=['.github','.gitignore','.npmrc','CHANGELOG.md','CONTRIBUTING.md','LICENSE','README.md','SECURITY.md','THIRD_PARTY_NOTICES.md','apps/web','docs','evidence','fixtures','package.json','packages/core/src','packages/cli/src','packages/cli/package.json','playwright.config.ts','pnpm-lock.yaml','pnpm-workspace.yaml','scripts','tests','tsconfig.json','vite.config.ts','vitest.config.ts']
for name in items:
    src=root/name;dest=source/name;dest.parent.mkdir(parents=True,exist_ok=True)
    if src.is_dir():shutil.copytree(src,dest,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules','__pycache__','test-results','work'))
    else:shutil.copy2(src,dest)
web=out/'web';shutil.copytree(root/'dist/web',web,dirs_exist_ok=True)
for name in ['LICENSE','THIRD_PARTY_NOTICES.md']:shutil.copy2(root/name,web/name)
# Include a directly usable self-contained executable for convenience as well as npm tarball.
(out/'cli').mkdir(exist_ok=True);shutil.copy2(root/'packages/cli/dist/main.js',out/'cli/releaselens.mjs')
(out/'cli/releaselens.mjs').chmod(0o755)
for name in ['LICENSE','THIRD_PARTY_NOTICES.md']:shutil.copy2(root/name,out/'cli'/name)
shutil.copytree(root/'evidence',out/'evidence',dirs_exist_ok=True)
(out/'serve.py').write_text('''#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
import argparse
parser=argparse.ArgumentParser(description="Serve the prebuilt Release Lens app locally")
parser.add_argument("--port",type=int,default=8080)
args=parser.parse_args()
handler=partial(SimpleHTTPRequestHandler,directory=str(Path(__file__).resolve().parent/"web"))
print(f"Release Lens: http://127.0.0.1:{args.port}/",flush=True)
ThreadingHTTPServer(("127.0.0.1",args.port),handler).serve_forever()
''')
(out/'README.md').write_text(f'''# Release Lens {version}

This release bundle includes the static browser app, self-contained Node CLI, installable npm tarball, source, fixtures and verification evidence. The CLI package is `{package}@{version}`, exposing the `releaselens` command. The tarball retains the GitHub download filename `releaselens-{version}.tgz`. A candidate bundle does not establish npm registry publication or provenance status; consult the release workflow and registry for those results.

## Run the app

From this directory, run `python3 serve.py` and open http://127.0.0.1:8080/. No dependency installation or build is required for the prebuilt app. Stop the server with Ctrl+C. Choose two local npm tarballs or **Compare example releases**. Contents stay in your browser. The server only serves the static application/examples.

## Run the CLI

Use Node 22 or 24:

```sh
node cli/releaselens.mjs diff source/fixtures/before.tgz source/fixtures/after.tgz --format json
```

Use your own two artifact paths. For installation, run `npm install --ignore-scripts /absolute/path/releaselens-{version}.tgz` in your chosen consumer directory. See `source/README.md` for CLI flags and exit codes.

## Inspect or develop

`source/` contains the reproducible pnpm project and lockfile. From it, run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:pack`, `pnpm test:oracle`. `pnpm dev` starts development with a nonce for Vite-injected styles. Browser tests need `pnpm exec playwright install chromium firefox webkit` and `pnpm test:e2e` after building.

The bundled `evidence/` directory contains verification records. Read their recorded runtimes, platforms, timestamps and limits, and consult this source commit's GitHub Actions checks for hosted results. `release.json` records the package identity, source commit and SHA-256 of each archive. The packager preserves the supplied tested CLI tarball without repacking it.

The accepted archive subset and limits are in `source/docs/measurement-contract.md`; parser assumptions and scanner maintenance risk are in `source/docs/parser-audit.md`. Checks do not establish Node compatibility or malware safety. MIT license and bundled third-party notices included.

`SHA256SUMS` identifies the deliverable archives. It is an integrity record, not a signature or provenance certification.
''')
with tarfile.open(out/f'release-lens-{version}-source.tar.gz','w:gz') as archive:
    archive.add(source,arcname=f'release-lens-{version}-source')
with zipfile.ZipFile(out/f'release-lens-{version}-web.zip','w',compression=zipfile.ZIP_DEFLATED) as archive:
    for p in web.rglob('*'):
        if p.is_file():archive.write(p,'web/'+str(p.relative_to(web)))
artifacts=[cli,out/f'release-lens-{version}-source.tar.gz',out/f'release-lens-{version}-web.zip']
receipts={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in artifacts}
(out/'SHA256SUMS').write_text(''.join(f"{record['sha256']}  {name}\n" for name,record in receipts.items()))
try:revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True,stderr=subprocess.DEVNULL).strip()
except subprocess.CalledProcessError:revision='uncommitted-source'
(out/'release.json').write_text(json.dumps({'version':version,'package':f'{package}@{version}','kind':'GitHub release bundle','sourceCommit':revision,'artifacts':receipts,'verification':'evidence/RELEASE.md'},indent=2)+'\n')
print(json.dumps({'output':str(out),'artifacts':receipts},indent=2))
