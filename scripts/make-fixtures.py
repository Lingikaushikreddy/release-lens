#!/usr/bin/env python3
"""Deterministic, non-executing fixture construction with independent payload records."""
import gzip, hashlib, io, json, tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FIX=ROOT/'fixtures'
def pack(files):
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT) as out:
        for name,data in files.items():
            info=tarfile.TarInfo('package/'+name);info.size=len(data);info.mode=0o644;info.mtime=0
            out.addfile(info,io.BytesIO(data))
    return gzip.compress(stream.getvalue(),mtime=0)
def manifest(version,missing=False):
    return json.dumps({'name':'release-lens-demo','version':version,'description':'Synthetic release review fixture','main':'dist/index.js','types':'dist/index.d.ts','exports':{'.':{'import':'./dist/index.js','types':'./dist/index.d.ts'},'./*':'./dist/*.js'},'bin':{'demo':'dist/missing.js' if missing else 'dist/cli.js'},'files':['dist'],'engines':{'node':'>=22'},'scripts':{'prepublishOnly':'node build.js'}},sort_keys=True,indent=2).encode()+b'\n'
common={'dist/index.js':b'export const version = "demo";\n','dist/index.d.ts':b'export declare const version: string;\n','dist/cli.js':b'#!/usr/bin/env node\nconsole.log("demo");\n','README.md':b'# Demo package\nSynthetic fixtures for Release Lens.\n','dist/index.js.map':b'{"version":3,"sources":["../src/index.ts"],"mappings":""}\n'}
collections={
 'before.tgz':{'package.json':manifest('1.0.0'),**common},
 'after.tgz':{'package.json':manifest('1.0.1',True),**common,'fixtures/training-a.bin':b'A'*(10*1024**2),'fixtures/training-b.bin':b'B'*(8*1024**2)},
 'clean.tgz':{'package.json':manifest('1.0.2'),**common},
 'hostile/markup.tgz':{'package.json':json.dumps({'name':'hostile-text-fixture','version':'1.0.0','main':'dist/index.js','scripts':{'postinstall':'<img onerror=alert(1)>'}}).encode(),'dist/index.js':b'export {};','assets/<img onerror=alert(1)>.txt':b'inert text'},
 'hostile/traversal.tgz':{'package.json':b'{}','../escape.txt':b'no'},
 'hostile/missing-manifest.tgz':{'index.js':b'export {};'},
}
records={}
for name,files in collections.items():
    target=FIX/name;target.parent.mkdir(parents=True,exist_ok=True);data=pack(files);target.write_bytes(data)
    records[name]={'source':'scripts/make-fixtures.py; constructed payloads, Python USTAR writer','sha256':hashlib.sha256(data).hexdigest(),'archiveBytes':len(data),'payloadBytes':sum(map(len,files.values())),'regularFiles':len(files),'expected':'FORMAT' if name in ['hostile/traversal.tgz','hostile/missing-manifest.tgz'] else 'accept'}
# Corrupt tar checksum while preserving valid gzip integrity.
raw=bytearray(gzip.decompress((FIX/'before.tgz').read_bytes()));raw[0]^=1
corrupt=gzip.compress(raw,mtime=0);(FIX/'hostile/checksum.tgz').write_bytes(corrupt)
records['hostile/checksum.tgz']={'source':'before.tgz; first tar header name bit changed without checksum update','sha256':hashlib.sha256(corrupt).hexdigest(),'expected':'FORMAT'}
(FIX/'synthetic-records.json').write_text(json.dumps(records,indent=2)+'\n')
public=ROOT/'apps/web/public/examples';public.mkdir(parents=True,exist_ok=True)
for name in ['before','after','clean']:(public/f'{name}.tgz').write_bytes((FIX/f'{name}.tgz').read_bytes())
(public/'hostile.tgz').write_bytes((FIX/'hostile/markup.tgz').read_bytes())
print(json.dumps({'fixturePayloadGrowth':records['after.tgz']['payloadBytes']-records['before.tgz']['payloadBytes'],'fixtureDirectoryGrowth':18*1024**2,'files':len(records)},indent=2))
