"""Install an actual artifact with uv into disposable tool dirs; never use checkout JS."""
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from smoke_process import run_cli, stop_process

ROOT = Path(__file__).resolve().parents[1]
release_version = json.loads((ROOT/'package.json').read_text())['version']
wheel = Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT/'python-dist'/f'fehm-{release_version}-py3-none-any.whl'
with zipfile.ZipFile(wheel) as archive:
    names=archive.namelist()
    assert 'fehm/runtime/dist/cli.js' in names
    assert not any('/website/' in n or '/.fehm/' in n or n.endswith('.DS_Store') for n in names)
    manifest=json.loads(archive.read('fehm/runtime/runtime-manifest.json'))
    for name, digest in manifest['files'].items():
        assert hashlib.sha256(archive.read('fehm/runtime/'+name)).hexdigest()==digest, name
    version=manifest['version']
with tempfile.TemporaryDirectory(prefix='fehm installed ü ') as tmp:
    base=Path(tmp); project=base/'project with spaces';project.mkdir()
    (project/'auth.ts').write_text('export function authenticateUser(token: string) { return validateToken(token); }\nexport function validateToken(token: string) { return token.length > 0; }\n')
    env={**os.environ,'UV_TOOL_DIR':str(base/'tools'),'UV_TOOL_BIN_DIR':str(base/'bin')}
    uv=__import__('shutil').which('uv')
    def uv_run(*args):
        subprocess.run([uv,*args],env=env,cwd=base,check=True)
    uv_run('tool','install',str(wheel))
    cli=base/'bin'/('fehm.exe' if os.name=='nt' else 'fehm')
    # No system Node/npm on the runtime PATH. Python and private Node use absolute paths.
    runtime_env={**env,'PATH':str(base/'bin')}
    def run(*args,ok=True):
        # Node writes UTF-8; Windows' locale default can corrupt Unicode paths.
        r=run_cli([str(cli),*args],env=runtime_env,cwd=base,text=True,encoding='utf-8')
        if ok: assert r.returncode==0,(args,r.stderr)
        return r
    started=time.monotonic();assert run('--version').stdout.strip()==version
    startup=time.monotonic()-started
    assert json.loads(run('doctor','--root',str(project),'--json').stdout)['index']['state']=='missing'
    run('scan',str(project))
    assert (project/'.fehm/graph.json').is_file()
    assert 'auth.ts' in run('context','authentication','--root',str(project),'--json').stdout
    run('install','--platform','codex','--project','--root',str(project))
    skill=project/'.agents/skills/fehm/SKILL.md';assert skill.is_file()
    config=json.loads(run('mcp-config','--platform','claude','--root',str(project)).stdout)
    server=config['mcpServers']['fehm'];assert Path(server['command']).is_absolute()
    assert Path(server['command']).is_file(), {'command':ascii(server['command']),'installed':ascii(str(cli)),'installedExists':cli.is_file()}
    assert Path(server['command']).samefile(cli), server['command']
    def session():
        p=subprocess.Popen([server['command'],*server['args']],cwd=base,env=runtime_env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
        messages=queue.Queue()
        def reader():
            for line in p.stdout: messages.put(json.loads(line))
        reader_thread=threading.Thread(target=reader,daemon=True)
        reader_thread.start()
        def send(method,params=None,id=1):
            req={'jsonrpc':'2.0','method':method}
            if params is not None:req['params']=params
            if id is not None:req['id']=id
            p.stdin.write(json.dumps(req)+'\n');p.stdin.flush()
            if id is None:return
            while True:
                msg=messages.get(timeout=30)
                if msg.get('id')==id:return msg
        try:
            assert send('initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'wheel-smoke','version':'1'}})['result']['serverInfo']['version']==version
            send('notifications/initialized',id=None)
            tools=send('tools/list')['result']['tools'];assert any(t['name']=='fehm_context' for t in tools)
            for name,args in [('fehm_context',{'query':'authenticateUser'}),('fehm_practices',{})]:
                result=send('tools/call',{'name':name,'arguments':args})['result'];assert not result.get('isError'),result
            assert send('tools/call',{'name':'fehm_context','arguments':{'query':'x','budget':-5}})['result']['isError']
            p.stdin.close();assert p.wait(timeout=10)==0
            assert not p.stderr.read().strip()
        finally:
            stop_process(p)
            reader_thread.join(timeout=10)
            assert not reader_thread.is_alive(), 'MCP child kept stdout open after shutdown'
            p.stdin.close();p.stdout.close();p.stderr.close()
    session();session()
    # A separately installed cockpit must serve its UI and graph without checkout assets.
    import urllib.request
    web=subprocess.Popen([str(cli),'serve','--root',str(project),'--port','0'],cwd=base,env=runtime_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
    try:
        line=web.stdout.readline().strip();assert line.startswith('fehm dashboard on '),line
        url=line.split(' on ',1)[1]
        with urllib.request.urlopen(url,timeout=10) as response: assert response.status==200 and b'Codebase graph' in response.read()
        with urllib.request.urlopen(url+'/graph',timeout=10) as response: assert response.status==200
    finally:
        stop_process(web)
        # EOF also verifies that descendants released their inherited pipes.
        web.communicate(timeout=10)
        web.stdout.close();web.stderr.close()
    # Missing assets produce a useful failure and do not depend on the checkout.
    runtime=Path(json.loads(run('doctor','--root',str(project),'--json').stdout)['runtime'])
    entry=runtime/'dist/cli.js';backup=entry.with_suffix('.smoke-backup')
    entry.rename(backup)
    try:
        failure=run('--version',ok=False);assert failure.returncode!=0 and 'incomplete' in failure.stderr
    finally:backup.rename(entry)
    state=project/'.fehm/user-settings.json';state.write_text('{"preserve":true}')
    before=skill.read_bytes()
    uv_run('tool','install','--reinstall',str(wheel))
    assert skill.read_bytes()==before and state.exists()
    assert run('--version').stdout.strip()==version
    run('uninstall','--platform','codex','--project','--root',str(project));assert not skill.exists()
    uv_run('tool','uninstall','fehm');assert state.exists() and (project/'.fehm/graph.json').exists()
    print(json.dumps({'wheel':wheel.name,'version':version,'startupSeconds':round(startup,3),'systemNodeRequired':False,'cli':'passed','mcp':'passed','reinstallPreservesState':True,'uninstallPreservesState':True}))
