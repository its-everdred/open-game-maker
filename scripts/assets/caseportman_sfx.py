"""Measure the WAV originals and pair the matching OGG files for UI sound cards."""
from pathlib import Path
import re
import wave
import math

from smallscaleint import NOW, source


def build_cards(root: Path, collection: dict) -> list[dict]:
    cards = []
    for wav in sorted((root / 'WAV').rglob('*.wav')):
        relative = wav.relative_to(root / 'WAV')
        ogg = root / 'OGG' / relative.with_suffix('.ogg')
        if not ogg.is_file():
            raise ValueError(f'missing OGG for {relative}')
        try:
            with wave.open(str(wav), 'rb') as audio:
                rate, channels, width = audio.getframerate(), audio.getnchannels(), audio.getsampwidth()
                duration = audio.getnframes() / rate
                if width not in (1, 2, 3, 4):
                    raise ValueError(f'unsupported PCM sample width: {wav}')
                data = audio.readframes(audio.getnframes())
                samples = (data[i:i + width] for i in range(0, len(data), width))
                peak = max((abs(int.from_bytes(s, 'little', signed=width != 1) - (128 if width == 1 else 0))
                            for s in samples), default=0)
                peak_dbfs = 20 * math.log10(peak / (2 ** (width * 8 - 1))) if peak else -120.0
        except (wave.Error, EOFError) as exc:
            raise ValueError(f'invalid WAV {wav}: {exc}') from exc
        files = [source(root, wav, True), source(root, ogg)]
        slug = re.sub(r'[^a-z0-9/]+', '-', relative.with_suffix('').as_posix().lower()).strip('-/')
        title = wav.stem.replace('_', ' ')
        pack, version = collection['id'].rsplit('@', 1)
        cards.append({'schema': collection['schema'], 'vocab': collection['vocab'],
                      'id': f'{pack}/{slug}@{version}', 'card_type': 'asset', 'status': 'tagged',
                      'title': title, 'kind': 'audio', 'subkind': 'sfx/ui', 'collection': collection['id'],
                      'describe': {'description': f'UI sound effect: {title}', 'objects': ['ui'], 'roles': ['feedback']},
                      'previews': {},
                      'source': {'files': files, 'content_hash': files[0]['sha256']},
                      'audio': {'duration_s': duration, 'sample_rate': rate, 'channels': channels,
                                'peak_dbfs': peak_dbfs, 'search_notes': f'UI SFX: {title}'},
                      'provenance': {'*': {'by': 'code', 'tool': 'caseportman-sfx@0.1', 'at': NOW,
                                           'input': 'WAV header and matching OGG filename'},
                                     'describe': {'by': 'filename', 'tool': 'caseportman-sfx@0.1', 'at': NOW,
                                                  'input': 'pack and filename'}}})
    return cards
