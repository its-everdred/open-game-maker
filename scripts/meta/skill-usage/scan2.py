import glob,os,re,base64,json,collections
H=os.path.expanduser('~'); SK=re.compile(r'skills/([a-z0-9][a-z0-9:_-]+)/SKILL\.md')
BK=re.compile(r'"(?:backend|provider)"\s*:\s*"([a-z:/.0-9-]+)"')
out=collections.defaultdict(lambda:{'backends':collections.Counter(),'skills':collections.Counter()})
for f in glob.glob(H+'/.aiur/logs/*/log/github-*.agent_events.jsonl'):
    m=re.search(r'github-([A-Za-z0-9_=-]+)\.(\d+)\.agent_events',f)
    try: repo=base64.urlsafe_b64decode(m.group(1)+'==').decode().split('/')[-1]
    except: continue
    repo='og' if repo.lower()=='open-games' else 'core'
    k=f'{repo}#{m.group(2)}'
    try: txt=open(f,errors='ignore').read()
    except: continue
    for b in BK.findall(txt): out[k]['backends'][b]+=1
    if 'openrouter' in txt or 'deepseek' in txt: out[k]['backends']['openrouter*']+=1
    for s in SK.findall(txt): out[k]['skills'][s]+=1
json.dump({k:{'backends':dict(v['backends']),'skills':dict(v['skills'])} for k,v in out.items()},open('events.json','w'))
c=collections.Counter(); sk=collections.Counter(); n=0
for k,v in out.items():
    if v['backends'].get('openrouter*'):
        n+=1
        for s in v['skills']: sk[s]+=1
print('tickets',len(out),'with openrouter',n); print(sk.most_common(30))
