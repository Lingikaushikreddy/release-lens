#!/usr/bin/env python3
"""Development-only acquisition; Release Lens itself never fetches packages."""
import urllib.request,json,hashlib,base64
from pathlib import Path
root=Path(__file__).resolve().parents[1];target=root/'fixtures/real';target.mkdir(parents=True,exist_ok=True)
records=[]
for version in ['6.0.0','7.0.0']:
    metadata=json.load(urllib.request.urlopen(f'https://registry.npmjs.org/is-number/{version}',timeout=30))
    url=metadata['dist']['tarball'];path=target/f'is-number-{version}.tgz'
    if not path.exists():path.write_bytes(urllib.request.urlopen(url,timeout=30).read())
    data=path.read_bytes();integrity=metadata['dist'].get('integrity','')
    if integrity.startswith('sha512-'):assert base64.b64encode(hashlib.sha512(data).digest()).decode()==integrity[7:]
    assert hashlib.sha1(data).hexdigest()==metadata['dist']['shasum']
    records.append({'package':'is-number','version':version,'url':url,'sha256':hashlib.sha256(data).hexdigest(),'registryIntegrity':integrity,'registryShasum':metadata['dist']['shasum'],'archiveBytes':len(data)})
(target/'records.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(records,indent=2))
