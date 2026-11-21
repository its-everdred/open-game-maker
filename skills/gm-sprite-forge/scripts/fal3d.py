"""Ledgered fal.ai client for the fal image-to-3D bake-off arms (host only; workers never hold the key).

The key is read in-process from ~/.config/ogm/env/fal.env (FAL_KEY=...); it is never printed, logged or passed on a
command line. Every call is booked in the ledger at OGM_FAL_LEDGER before its result is fetched, and a call that would
take the ledger total past OGM_FAL_STOP_USD (default 9.00, the creator's cap) is refused before anything is sent.
Use one ledger for every fal call on the host, so the cap covers all of them.

  fal3d.py price <endpoint>...                      listed unit price per endpoint
  fal3d.py run <endpoint> <out_dir> <usd> key=value...   value @path.png uploads that file; JSON values are parsed
  fal3d.py fetch <app> <request_id> <out_dir>       download a result that was already paid for
  fal3d.py total
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

KEY_FILE = os.path.expanduser('~/.config/ogm/env/fal.env')
STOP_USD = float(os.environ.get('OGM_FAL_STOP_USD', '9.0'))


def ledger_path():
    path = os.environ.get('OGM_FAL_LEDGER')
    if not path:
        raise SystemExit('set OGM_FAL_LEDGER to the host-wide fal ledger (one ledger, one cap)')
    return path


def key():
    for line in open(KEY_FILE):
        k, _, v = line.strip().partition('=')
        if k.strip() in ('FAL_KEY', 'export FAL_KEY'):
            return v.strip().strip('"\'')
    raise SystemExit('FAL_KEY missing from ' + KEY_FILE)


def call(url, data=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 method='POST' if data is not None else 'GET',
                                 headers={'Authorization': f'Key {key()}', 'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        raise SystemExit(f'HTTP {e.code} from {url.split("?")[0]}: {e.read()[:600].decode(errors="replace")}')


def ledger():
    path = ledger_path()
    return json.load(open(path)) if os.path.exists(path) else {'stop_usd': STOP_USD, 'calls': []}


def total(lg):
    return round(sum(c['usd'] for c in lg['calls']), 4)


def write(lg):
    json.dump(lg, open(ledger_path(), 'w'), indent=2)


def upload(path):
    """fal storage (CDN v3): initiate, then PUT the bytes; returns the public file URL. fal rejects data URIs."""
    init = call('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
                {'content_type': 'image/png', 'file_name': os.path.basename(path)})
    req = urllib.request.Request(init['upload_url'], data=open(path, 'rb').read(), method='PUT',
                                 headers={'Content-Type': 'image/png'})
    urllib.request.urlopen(req, timeout=180).read()
    return init['file_url']


def save(res, out):
    os.makedirs(out, exist_ok=True)
    saved = []

    def grab(o, name):
        if isinstance(o, dict) and isinstance(o.get('url'), str) and o['url'].startswith('http'):
            ext = os.path.splitext(o.get('file_name') or o['url'].split('?')[0])[1] or '.bin'
            p = os.path.join(out, (name or 'file') + ext)
            open(p, 'wb').write(urllib.request.urlopen(o['url'], timeout=120).read())
            saved.append(p)
        elif isinstance(o, dict):
            for k, v in o.items():
                grab(v, f'{name}_{k}' if name else k)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                grab(v, f'{name}_{i}')
    grab(res, '')
    json.dump(res, open(os.path.join(out, 'result.json'), 'w'), indent=1)
    return saved


def body_from(kvs):
    body = {}
    for kv in kvs:
        k, v = kv.split('=', 1)
        try:
            v = json.loads(v)
        except ValueError:
            pass
        up = lambda x: upload(x[1:]) if isinstance(x, str) and x.startswith('@') else x  # noqa: E731
        body[k] = [up(x) for x in v] if isinstance(v, list) else up(v)
    return body


def run(ep, out, kvs, usd):
    lg = ledger()
    if total(lg) + usd > STOP_USD:
        raise SystemExit(f'STOP: {total(lg)} + {usd} would pass {STOP_USD} USD')
    body = body_from(kvs)
    t0 = time.time()
    sub = call(f'https://queue.fal.run/{ep}', body)
    entry = {'endpoint': ep, 'usd': usd, 'request_id': sub.get('request_id'),
             'when': time.strftime('%Y-%m-%dT%H:%M:%S'), 'params': kvs, 'out': out}
    lg['calls'].append(entry)  # booked at submit: a failure after submit may still bill
    write(lg)
    while True:
        st = call(sub['status_url'])
        if st['status'] == 'COMPLETED':
            break
        if st['status'] not in ('IN_QUEUE', 'IN_PROGRESS'):
            raise SystemExit(f'fal status {st}')
        time.sleep(4)
    res = call(sub['response_url'])
    entry['seconds'] = round(time.time() - t0)
    write(lg)
    files = save(res, out)
    print(f'FAL_DONE {ep} usd={usd} total={total(lg)} seconds={entry["seconds"]} files={files}')


if __name__ == '__main__':
    cmd, *a = sys.argv[1:]
    if cmd == 'price':
        for e in a:
            p = call('https://api.fal.ai/v1/models/pricing?endpoint_id=' + e).get('prices') or [{}]
            print(e, p[0].get('unit_price', 'unlisted (check the model page)'), p[0].get('currency', ''),
                  'per', p[0].get('unit', ''))
    elif cmd == 'run':
        run(a[0], a[1], a[3:], float(a[2]))
    elif cmd == 'fetch':
        print(save(call(f'https://queue.fal.run/{a[0]}/requests/{a[1]}'), a[2]))
    elif cmd == 'total':
        print(total(ledger()), 'USD of', STOP_USD)
    else:
        raise SystemExit(__doc__)
