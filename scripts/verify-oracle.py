#!/usr/bin/env python3
"""Independent verification: CPython tarfile/hashlib vs shipped JS CLI, no extraction.

Checks valid supported artifacts only. Malformed-input refusal follows the product's
explicit byte fixture policy, not Python's broader acceptance behavior.
"""
import hashlib,json,os,subprocess,sys,tarfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
NODE=os.environ.get('NODE_BINARY','node')
def inventory(path):
    entries=[];manifest=None
    with tarfile.open(path,mode='r|gz') as archive:
        for member in archive:
            if not member.isfile():continue
            name=member.name
            while name.startswith('./'):name=name[2:]
            assert name.startswith('package/'),name
            body=archive.extractfile(member);assert body is not None
            digest=hashlib.sha256();size=0;parts=[]
            for chunk in iter(lambda:body.read(65536),b''):
                size+=len(chunk);digest.update(chunk)
                if name=='package/package.json':parts.append(chunk)
            assert size==member.size
            entries.append({'path':name[len('package/'):],'bytes':size,'sha256':digest.hexdigest()})
            if name=='package/package.json':manifest=json.loads(b''.join(parts))
    assert isinstance(manifest,dict)
    return {'schemaVersion':1,'archiveBytes':path.stat().st_size,'unpackedBytes':sum(e['bytes'] for e in entries),'entries':sorted(entries,key=lambda e:e['path']),'manifest':manifest}
def verify(before,after,label):
    start=time.monotonic()
    command=[NODE,str(ROOT/'packages/cli/dist/main.js'),'diff',str(before),str(after),'--format','json']
    a=subprocess.run(command,capture_output=True,text=True,check=True);b=subprocess.run(command,capture_output=True,text=True,check=True)
    assert a.stdout==b.stdout,'Nondeterministic CLI output'
    report=json.loads(a.stdout);left=inventory(before);right=inventory(after)
    assert report['before']==left,f'{label}: before differs from CPython oracle'
    assert report['after']==right,f'{label}: after differs from CPython oracle'
    delta=right['unpackedBytes']-left['unpackedBytes']
    assert report['unpackedDelta']==delta==sum(x['delta'] for x in report['fileDeltas'])
    assert report['archiveDelta']==right['archiveBytes']-left['archiveBytes']
    l={e['path']:e for e in left['entries']};r={e['path']:e for e in right['entries']}
    assert [d['path'] for d in report['fileDeltas']]==sorted(l.keys()|r.keys())
    for item in report['fileDeltas']:
        x=l.get(item['path']);y=r.get(item['path'])
        assert item['beforeBytes']==(x['bytes'] if x else 0)
        assert item['afterBytes']==(y['bytes'] if y else 0)
        expected='added' if x is None else 'removed' if y is None else 'modified' if (x['sha256'],x['bytes'])!=(y['sha256'],y['bytes']) else 'unchanged'
        assert item['kind']==expected
        assert item['beforeHash']==(x['sha256'] if x else None) and item['afterHash']==(y['sha256'] if y else None)
    cats={}
    for item in report['fileDeltas']:cats[item['category']]=cats.get(item['category'],0)+item['delta']
    assert sum(cats.values())==delta
    hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [before,after]}
    result={'pair':label,'status':'pass','oracle':'CPython tarfile + hashlib; regular members read in memory chunks; no extraction','filesBefore':len(left['entries']),'filesAfter':len(right['entries']),'unpackedDelta':delta,'archiveDelta':report['archiveDelta'],'inputSha256':hashes,'repeatOutputIdentical':True,'elapsedSeconds':round(time.monotonic()-start,4)}
    return result
pairs=[('fixtures/before.tgz','fixtures/after.tgz','synthetic growth'),('fixtures/after.tgz','fixtures/clean.tgz','synthetic cleanup'),('fixtures/before.tgz','fixtures/hostile/markup.tgz','inert hostile text'),('fixtures/real/is-number-6.0.0.tgz','fixtures/real/is-number-7.0.0.tgz','real is-number 6 -> 7')]
results=[verify(ROOT/a,ROOT/b,label) for a,b,label in pairs]
output={'pythonVersion':sys.version.split()[0],'nodeVersion':subprocess.check_output([NODE,'--version'],text=True).strip(),'results':results,'limitations':'Valid supported subset only; not a malformed-input acceptance oracle or proof of package compatibility.'}
(ROOT/'evidence').mkdir(exist_ok=True);(ROOT/'evidence/oracle.json').write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output,indent=2))
