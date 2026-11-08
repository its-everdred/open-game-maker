import json,re,collections
T={}
for repo,f in [('og','og-titles.jsonl'),('core','core-titles.jsonl')]:
    for l in open(f):
        o=json.loads(l); T[(repo,o['n'])]=o['t']
U={}
for r in json.load(open('usage.json')):
    U[(r['repo'],r['ticket'])]={'h':set(r['harness']),'s':collections.Counter(r['skills'])}
for k,v in json.load(open('events.json')).items():
    repo,n=k.split('#'); key=(repo,int(n)); e=U.setdefault(key,{'h':set(),'s':collections.Counter()})
    if v['backends'].get('openrouter*'): e['h'].add('openrouter')
    e['s'].update(v['skills'])
cats=[('visual/UI',r'look|screen|ui\b|hud|layout|render|title|menu|deck|style|select|camera|character|theme|icon|visual|button|portrait|landscape|phone layout|glossy|mock|diorama|scene|showcase'),
('gameplay',r'blobs|garbage|cpu|score|rules|chain|hold|controls|speed|playtest|versus|tetro|pair|room'),
('audio/voice',r'audio|voice|music|sfx|sound'),
('assets',r'asset|pack|kaykit|catalog|thumbnail|lineup|preprocess|tag'),
('qa',r'\bqa\b|gate|cycle|verify|test')]
def cat(t):
    t=t.lower()
    for c,rx in cats:
        if re.search(rx,t): return c
    return 'infra/app/pipeline'
WATCH=['gm-verify','gm-design-loop','gm-image-mock','gm-ui-hud','gm-3d','gm-assets','gm-asset-variants','gm-qa','gm-core','gm-build','gm-input','ce-brainstorm','ce-plan','ce-code-review','ce-test-browser','agent-browser','ce-frontend-design']
by=collections.defaultdict(list)
for k,v in U.items():
    t=T.get(k)
    if not t: continue
    by[cat(t)].append((k,t,v))
lines=['| work type | tickets | '+' | '.join(WATCH)+' |','|'+'---|'*(len(WATCH)+2)]
for c in ['visual/UI','gameplay','audio/voice','assets','qa','infra/app/pipeline']:
    L=by[c]; n=len(L)
    if not n: continue
    lines.append(f'| {c} | {n} | '+' | '.join(f"{round(100*sum(1 for _,_,v in L if v['s'][s])/n)}%" for s in WATCH)+' |')
print('\n'.join(lines))
# visual tickets detail
print('\nVISUAL tickets (repo#n, harness, gm skills):')
for k,t,v in sorted(by['visual/UI']):
    gm=sorted(s for s in v['s'] if s.startswith('gm-'))
    print(f"{k[0]}#{k[1]} [{'+'.join(sorted(v['h']))}] {t[:70]} :: {', '.join(gm) or '—'}")
json.dump({c:[(f'{k[0]}#{k[1]}',t,sorted(v['h']),dict(v['s'])) for k,t,v in L] for c,L in by.items()},open('by-cat.json','w'),indent=0)
