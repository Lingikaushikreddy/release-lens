#!/usr/bin/env python3
"""Reproducible local resource observations, not a cross-machine performance promise."""
import gzip,hashlib,io,json,os,platform,subprocess,tarfile,time
from pathlib import Path
root=Path(__file__).resolve().parents[1];scratch=root/'work/performance';scratch.mkdir(parents=True,exist_ok=True)
path=scratch/'near-expanded-limit.tgz'
with path.open('wb') as raw:
    with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as compressed:
        with tarfile.open(fileobj=compressed,mode='w|',format=tarfile.USTAR_FORMAT) as archive:
            parts=[('package/package.json',b'{"name":"near-limit-fixture","version":"1.0.0"}'),*[(f'package/fixtures/{i}.bin',b'A'*(16*1024**2)) for i in range(9)],('package/fixtures/tail.bin',b'B'*(5*1024**2))]
            for name,body in parts:
                entry=tarfile.TarInfo(name);entry.size=len(body);entry.mode=0o644;archive.addfile(entry,io.BytesIO(body))
meter=scratch/'meter.cjs';meter.write_text("process.on('exit',()=>process.stderr.write('RESOURCE:'+JSON.stringify({maxRssKiB:process.resourceUsage().maxRSS,rssBytes:process.memoryUsage().rss})+'\\n'));\n")
node=os.environ.get('NODE_BINARY','node');results=[]
for label,after in [('18 MiB synthetic growth',root/'fixtures/after.tgz'),('149 MiB payload near expanded limit',path)]:
    start=time.monotonic();run=subprocess.run([node,'--require',str(meter),str(root/'packages/cli/dist/main.js'),'diff',str(root/'fixtures/before.tgz'),str(after),'--format','json'],capture_output=True,text=True,check=True)
    elapsed=time.monotonic()-start;report=json.loads(run.stdout)
    metrics=json.loads(run.stderr.split('RESOURCE:')[1]);results.append({'case':label,'elapsedSeconds':round(elapsed,4),'afterPayloadBytes':report['after']['unpackedBytes'],'afterArchiveBytes':after.stat().st_size,**metrics})
output={'platform':platform.platform(),'machine':platform.machine(),'nodeVersion':subprocess.check_output([node,'--version'],text=True).strip(),'observations':results,'limits':'Compressed input <25MiB, expanded stream <150MiB, each regular payload <=16MiB. High compression stress; not representative of all archives. Peak RSS includes runtime, parser, hashes and report. Maintainer interaction timing still requires a pilot.'}
(root/'evidence/performance.json').write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output,indent=2))
