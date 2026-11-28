"""Write prototypes/ogm-glass/index.html from canvas.json. usage: index.py <prototype dir>"""
import html, json, os, sys

out = sys.argv[1]
c = json.load(open(os.path.join(out, 'canvas.json')))
pages = {p['id']: p['name'] for p in c['pages']}
groups = [('Phone portrait', lambda b: b['w'] == 390, 0.5),
          ('Phone landscape', lambda b: b['w'] == 844, 0.4),
          ('Desktop', lambda b: b['w'] == 1440 and b['page'] != 'system', 0.25),
          ('System', lambda b: b['page'] == 'system', 0.25)]
seen, body = set(), []
for label, test, scale in groups:
    boards = [(f, b) for f, b in c['boards'].items() if test(b) and f not in seen]
    seen.update(f for f, _ in boards)
    body.append(f'<h2>{label} <span>{len(boards)}</span></h2>')
    last_page = None
    for f, b in boards:
        if label == 'Phone portrait' and b['page'] != last_page:
            if last_page is not None:
                body.append('</div>')
            body.append(f'<h3>{html.escape(pages[b["page"]])}</h3><div class="grid">')
            last_page = b['page']
        elif last_page is None:
            body.append('<div class="grid">')
            last_page = ''
        name = f.replace('.dc.html', '')
        w, h = round(b['w'] * scale), round(b['h'] * scale)
        body.append(
            f'<a class="card" href="{name}.html" title="{html.escape(b["title"])}" style="width:{w}px">'
            f'<div class="frame" style="width:{w}px;height:{h}px">'
            f'<iframe src="{name}.html" width="{b["w"]}" height="{b["h"]}" style="transform:scale({scale})" loading="lazy" tabindex="-1" aria-hidden="true"></iframe></div>'
            f'<b>{name}</b><span>{html.escape(b["title"])} · {b["w"]}×{b["h"]}</span></a>')
    body.append('</div>')
assert seen == set(c['boards']), set(c['boards']) - seen

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OGM Glass</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&amp;family=Nunito:wght@600;700;800&amp;display=swap" rel="stylesheet">
<style>
body{{margin:0;padding:24px 16px 48px;background:#0f0e16;color:#f2ead6;font:600 14px Nunito,sans-serif}}
h1,h2,h3{{font-family:Fredoka,sans-serif;font-weight:600;margin:0}}
h1{{font-size:30px}}
h2{{font-size:24px;margin:36px 0 12px}}h2 span{{color:#c4beb0;font-size:16px}}
h3{{font-size:17px;color:#c4beb0;margin:20px 0 10px}}
.grid{{display:flex;flex-wrap:wrap;gap:20px}}
.card{{display:flex;flex-direction:column;gap:4px;color:#f2ead6;text-decoration:none;max-width:100%}}
.card span{{color:#c4beb0;font-size:12px}}
.frame{{position:relative;overflow:hidden;border-radius:14px;border:1px solid rgba(242,234,214,.16);max-width:100%}}
.frame iframe{{position:absolute;left:0;top:0;border:0;transform-origin:0 0;pointer-events:none}}
.card:hover .frame{{border-color:#74c8ed}}
</style>
</head>
<body>
<h1>OGM Glass</h1>
{chr(10).join(body)}
</body>
</html>
"""
open(os.path.join(out, 'index.html'), 'w').write(page)
print('index:', len(seen), 'artboards')
