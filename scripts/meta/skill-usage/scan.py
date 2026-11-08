import json, glob, os, re, sqlite3, collections, sys
H=os.path.expanduser('~')
WS=re.compile(r'\.aiur/w/its-everdred/([A-Za-z-0-9]+?)/(\d+)')
SK=re.compile(r'skills/([a-z0-9][a-z0-9:_-]+)/SKILL\.md')
rows=collections.defaultdict(lambda: {'harness':set(),'skills':collections.Counter(),'sessions':0,'first':'9','last':'0'})
def key(path):
    m=WS.search(path); 
    if not m: return None
    repo=m.group(1).lower(); repo={'open-game-maker-2000':'core','open-game-maker':'core','open-games':'og'}.get(repo,repo)
    return (repo,int(m.group(2)))
def touch(k,ts):
    r=rows[k]; 
    if ts: r['first']=min(r['first'],ts[:10]); r['last']=max(r['last'],ts[:10])
# Claude
for base in [H+'/.claude/projects',H+'/.claude-2/projects']:
    for d in glob.glob(base+'/*aiur-w-its-everdred*'):
        m=re.search(r'aiur-w-its-everdred-(open-game-maker-2000|open-game-maker|open-games|Open-Games)-(\d+)$',d)
        if not m: continue
        repo={'open-games':'og','Open-Games':'og'}.get(m.group(1),'core'); k=(repo,int(m.group(2)))
        for f in glob.glob(d+'/**/*.jsonl',recursive=True):
            rows[k]['harness'].add('claude'); rows[k]['sessions']+=1
            for line in open(f,errors='ignore'):
                if '"tool_use"' not in line: continue
                try: o=json.loads(line)
                except: continue
                touch(k,o.get('timestamp',''))
                for c in (o.get('message',{}).get('content') or []):
                    if isinstance(c,dict) and c.get('type')=='tool_use':
                        inp=c.get('input',{})
                        if c.get('name')=='Skill': rows[k]['skills'][inp.get('skill','?').split(':')[-1]]+=1
                        else:
                            for s in SK.findall(json.dumps(inp)): rows[k]['skills'][s]+=1
# Codex
for f in glob.glob(H+'/.codex/sessions/2026/*/*/*.jsonl')+glob.glob(H+'/.config/ogm/codex-gamebuilder/sessions/**/*.jsonl',recursive=True):
    try: first=open(f,errors='ignore').readline()
    except: continue
    k=key(first)
    if not k: continue
    rows[k]['harness'].add('codex'); rows[k]['sessions']+=1
    ts=json.loads(first).get('timestamp',''); touch(k,ts)
    for line in open(f,errors='ignore'):
        if 'SKILL.md' not in line: continue
        try: o=json.loads(line)
        except: continue
        p=o.get('payload',{})
        if p.get('type') in ('function_call','custom_tool_call','local_shell_call') or o.get('type')=='response_item' and p.get('type','').endswith('call'):
            for s in set(SK.findall(json.dumps(p))): rows[k]['skills'][s]+=1
# opencode
db=H+'/.local/share/opencode/opencode.db'
if os.path.exists(db):
    con=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
    tabs=[r[0] for r in con.execute("select name from sqlite_master where type='table'")]
    print('opencode tables',tabs,file=sys.stderr)
    if 'session' in tabs and 'part' in tabs:
        cols=[r[1] for r in con.execute('pragma table_info(session)')]
        dircol='directory' if 'directory' in cols else None
        sess={}
        for r in con.execute(f'select id,{dircol} from session'):
            k=key(r[1] or ''); 
            if k: sess[r[0]]=k; rows[k]['harness'].add('openrouter'); rows[k]['sessions']+=1
        pcols=[r[1] for r in con.execute('pragma table_info(part)')]
        for sid,data in con.execute('select session_id,data from part'):
            if sid in sess and data and 'SKILL.md' in data or (sid in sess and data and '"skill"' in data):
                for s in set(SK.findall(data)): rows[sess[sid]]['skills'][s]+=1
                m=re.findall(r'"tool":"skill".{0,200}?"name":"([^"]+)"',data)
                for s in m: rows[sess[sid]]['skills'][s]+=1
out=[]
for (repo,n),r in sorted(rows.items()):
    out.append({'repo':repo,'ticket':n,'harness':sorted(r['harness']),'sessions':r['sessions'],'first':r['first'],'last':r['last'],'skills':dict(r['skills'])})
json.dump(out,open('usage.json','w'),indent=0)
print(len(out),'tickets')
