import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runSceneMatch } from '../src/scene/run-match.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('runs a local worker without shell interpretation and binds its result to the requested mock and crops', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scene-match-'));
  dirs.push(dir);
  const mock = join(dir, 'mock $(not-a-command).png');
  const worker = join(dir, 'worker.py');
  await writeFile(mock, 'local mock bytes');
  await writeFile(
    worker,
    `import hashlib,json,sys
args=sys.argv
def value(name): return args[args.index(name)+1]
assert '--include-vectors' in args
assert value('--facing') == 'E'
q={'model':'local','vector':[1,0]}
crops=[list(map(int,args[i+1].split(','))) for i,x in enumerate(args) if x=='--crop']
if value('--pack') == 'bad-crop': crops[0][0]+=1
digest=hashlib.sha256(open(value('--mock'),'rb').read()).hexdigest()
if value('--pack') == 'bad-hash': digest='b'*64
scope={'pack':value('--pack'),'kind':'sprite','facing': 'N' if value('--pack') == 'bad-scope' else value('--facing')}
print(json.dumps({'mock_sha256':digest,'scope':scope,'query':q,'candidates':[dict(id='one',source_sha256='b'*64,**q)],'examined':1,'eligible':2,'truncated':True,'regions':[dict(crop=c,query=q) for c in crops]}))
`,
  );
  const input = {
    python: 'python3',
    worker,
    assetsRoot: dir,
    pack: 'pack',
    mock,
    crops: [
      [0, 1, 2, 3],
      [2, 3, 4, 5],
    ] as const,
    facing: 'E' as const,
    encoder: 'clip' as const,
  };
  const result = await runSceneMatch(input);
  expect(result.regions.map((region) => region.crop)).toEqual(input.crops);
  expect(result.truncated).toBe(true);
  await expect(runSceneMatch({ ...input, pack: 'bad-crop' })).rejects.toThrow('different crops');
  await expect(runSceneMatch({ ...input, pack: 'bad-hash' })).rejects.toThrow('different mock');
  await expect(runSceneMatch({ ...input, pack: 'bad-scope' })).rejects.toThrow('different search scope');
  await expect(runSceneMatch({ ...input, crops: [] })).rejects.toThrow('invalid scene match crops');
});
