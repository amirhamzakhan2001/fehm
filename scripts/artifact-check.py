"""Inspect built distribution contents, hashes, version agreement and notices."""
from pathlib import Path
import hashlib
import json
import tarfile
import zipfile
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text())['version']
wheel=root/'python-dist'/f'fehm-{version}-py3-none-any.whl'
sdist=root/'python-dist'/f'fehm-{version}.tar.gz'
with zipfile.ZipFile(wheel) as z:
    names=z.namelist();manifest=json.loads(z.read('fehm/runtime/runtime-manifest.json'))
    assert manifest['version']==version
    for name,digest in manifest['files'].items():
        assert hashlib.sha256(z.read('fehm/runtime/'+name)).hexdigest()==digest,name
    assert not any('/.fehm/' in n or '/website/' in n or '.DS_Store' in n or n.endswith(('.node','.exe','.dll','.dylib','.so')) for n in names)
    metadata=z.read(f'fehm-{version}.dist-info/METADATA').decode()
    assert f'Version: {version}' in metadata and 'nodejs-wheel-binaries==24.19.0' in metadata
with tarfile.open(sdist) as tar:
    members=tar.getmembers();assert not any(m.issym() or m.islnk() or m.name.startswith('/') or '..' in Path(m.name).parts for m in members)
    prefix=f'fehm-{version}/build/fehm-runtime/'
    for name,digest in manifest['files'].items():
        f=tar.extractfile(prefix+name);assert f is not None
        assert hashlib.sha256(f.read()).hexdigest()==digest,name
report={'version':version,'runtimeFiles':len(manifest['files']),'artifacts':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [wheel,sdist]],'platformClaim':'portable JS wheel; only recorded installed-artifact tests establish platform support'}
(root/'python-dist/SHA256SUMS').write_text(''.join(f"{a['sha256']}  {a['name']}\n" for a in report['artifacts']))
(root/'python-dist/artifact-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
