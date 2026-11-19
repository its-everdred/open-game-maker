"""Read GIF animation geometry and timing without decoding untrusted pixels."""
import struct
from pathlib import Path


def metadata(path: Path) -> dict:
    data = path.read_bytes()
    pos = 0

    def take(n):
        nonlocal pos
        if n < 0 or pos + n > len(data):
            raise ValueError(f'truncated GIF: {path}')
        result = data[pos:pos + n]
        pos += n
        return result

    def blocks():
        while True:
            count = take(1)[0]
            if not count:
                break
            take(count)

    if take(6) not in (b'GIF87a', b'GIF89a'):
        raise ValueError(f'invalid GIF: {path}')
    width, height, packed, _, _ = struct.unpack('<HHBBB', take(7))
    if packed & 128:
        take(3 * (2 ** ((packed & 7) + 1)))
    frames, duration, delay, alpha = 0, 0, 0, False
    while True:
        marker = take(1)[0]
        if marker == 0x3b:
            break
        if marker == 0x21:
            label = take(1)[0]
            if label == 0xf9:
                if take(1) != b'\x04':
                    raise ValueError(f'invalid GIF control block: {path}')
                control = take(4)
                alpha = alpha or bool(control[0] & 1)
                delay = int.from_bytes(control[1:3], 'little')
                if take(1) != b'\x00':
                    raise ValueError(f'invalid GIF control terminator: {path}')
            else:
                blocks()
        elif marker == 0x2c:
            descriptor = take(9)
            packed = descriptor[8]
            if packed & 128:
                take(3 * (2 ** ((packed & 7) + 1)))
            take(1)  # LZW minimum code size
            blocks()
            frames += 1
            duration += delay
            delay = 0
        else:
            raise ValueError(f'invalid GIF block: {path}')
    if not frames:
        raise ValueError(f'GIF has no frames: {path}')
    return {'width': width, 'height': height, 'frames': frames, 'has_alpha': alpha,
            'fps': frames * 100 / duration if duration else None}
