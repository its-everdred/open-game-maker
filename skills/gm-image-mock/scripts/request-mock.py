#!/usr/bin/env python3
"""Ask the host's mock broker for one generated image mock and wait for it.

Writes <workspace>/.gm-mock/requests/<id>.json; the broker (outside the sandbox) writes <out>/<id>.png and
<workspace>/.gm-mock/done/<id>.json. Prints the image path, or the broker's error, and exits non-zero on failure.
A look request also appends its outcome (answer or error) to <workspace>/.gm-mock/looks.jsonl for `gm look check`.
"""
import argparse, hashlib, json, os, sys, time, uuid

VERDICT = '\n\nList the differences to fix, worst first. End your answer with one line, exactly `VERDICT: pass` or `VERDICT: fail`.'

ap = argparse.ArgumentParser()
ap.add_argument('--prompt-file', default=None, help='image prompt, or the line to speak for --kind voice')
ap.add_argument('--kind', default='image', choices=['image', 'voice', 'voices', 'look'], help='voice: one ElevenLabs sample; voices: list the voices; look: a vision model answers --prompt-file about the --ref images')
ap.add_argument('--voice-id', default='')
ap.add_argument('--voice-model', default='eleven_v3', help='eleven_v3 (expressive, takes [excited]-style tags), eleven_multilingual_v2 or eleven_flash_v2_5')
ap.add_argument('--stability', default='', help='v3: 0.0 creative, 0.5 natural, 1.0 robust')
ap.add_argument('--style', default='', help='v2 only: 0.0-1.0 style exaggeration')
ap.add_argument('--out', required=True, help='workspace-relative output directory')
ap.add_argument('--ref', action='append', default=[], help='workspace-relative reference image (free-licence only)')
ap.add_argument('--aspect', default='9:16')
ap.add_argument('--model', default=None, help='image model id (default: the broker\'s)')
ap.add_argument('--name', default=None, help='file stem for the image (default: a random id)')
ap.add_argument('--wait', type=int, default=600, help='seconds to wait for the broker')
a = ap.parse_args()

root = os.getcwd()
while root != '/' and not os.path.isdir(os.path.join(root, '.git')):
    root = os.path.dirname(root)
if root == '/':
    sys.exit('run inside the workspace')
rid = a.name or uuid.uuid4().hex[:12]
if a.kind == 'look':
    # Every look gets its own id (so its own done and answer files): a reused --name can never pick up an earlier
    # or late answer and log it against new bytes.
    rid = (a.name + '-' if a.name else '') + uuid.uuid4().hex[:8]
prompt = open(a.prompt_file, encoding='utf-8').read() if a.prompt_file else ''
req = {
    'id': rid,
    'prompt': prompt + VERDICT if a.kind == 'look' else prompt,
    'kind': a.kind,
    'voice_id': a.voice_id,
    'voice_model': a.voice_model,
    'stability': a.stability,
    'style': a.style,
    'out': os.path.relpath(os.path.abspath(a.out), root),
    'refs': [os.path.relpath(os.path.abspath(r), root) for r in a.ref],
    'aspect': a.aspect,
    'model': a.model,
}
# The git blob id of each ref as sent, so `gm look check` can tell which version of a still a look judged.
blobs = []
for ref in req['refs']:
    data = open(os.path.join(root, ref), 'rb').read()
    blobs.append(hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest())
for d in ('requests', 'done'):
    os.makedirs(os.path.join(root, '.gm-mock', d), exist_ok=True)
tmp = os.path.join(root, '.gm-mock', 'requests', rid + '.tmp')
done = os.path.join(root, '.gm-mock', 'done', rid + '.json')
json.dump(req, open(tmp, 'w'))
os.rename(tmp, tmp[:-4] + '.json')


def log_look(entry):
    if a.kind != 'look':
        return
    line = {'id': rid, 'time': time.time(), 'refs': [{'path': p, 'blob': b} for p, b in zip(req['refs'], blobs)], **entry}
    with open(os.path.join(root, '.gm-mock', 'looks.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps(line) + '\n')


end = time.time() + a.wait
while time.time() < end:
    if os.path.exists(done):
        r = json.load(open(done))
        if r.get('ok'):
            print(os.path.join(req['out'], r['file']))
            json.dump({**req, **r}, open(os.path.join(root, req['out'], rid + '.json'), 'w'), indent=1)  # the record: prompt, refs, model, cost, time
            answer = os.path.join(req['out'], r['file'])
            digest = hashlib.sha256(open(os.path.join(root, answer), 'rb').read()).hexdigest()
            log_look({'ok': True, 'answer': answer, 'answer_sha256': digest})
            sys.exit(0)
        log_look({'ok': False, 'error': r.get('error', 'unknown')})
        sys.exit('mock failed: ' + r.get('error', 'unknown'))
    time.sleep(3)
log_look({'ok': False, 'error': 'no answer from the mock broker in %ds' % a.wait})
sys.exit('no answer from the mock broker in %ds (is it running on the host?)' % a.wait)
