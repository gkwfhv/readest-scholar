#!/usr/bin/env python3
"""Reject an iOS Simulator screenshot whose app content area is still uniform."""

import struct
import sys
import zlib
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def paeth(left: int, above: int, upper_left: int) -> int:
    prediction = left + above - upper_left
    distances = (abs(prediction - left), abs(prediction - above), abs(prediction - upper_left))
    return (left, above, upper_left)[distances.index(min(distances))]


def content_colors(path: Path) -> int:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG")
    pos = len(PNG_SIGNATURE)
    payload = bytearray()
    width = height = None
    while pos < len(data):
        size = struct.unpack_from(">I", data, pos)[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + size]
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if (bit_depth, color_type, interlace) != (8, 6, 0):
                raise ValueError("expected non-interlaced 8-bit RGBA PNG")
        elif kind == b"IDAT":
            payload.extend(chunk)
        elif kind == b"IEND":
            break
        pos += size + 12
    if width is None or height is None:
        raise ValueError("missing IHDR")

    decoded = zlib.decompress(payload)
    row_size = width * 4
    previous = bytearray(row_size)
    colors = set()
    pos = 0
    x_step = max(1, width // 24)
    y_step = max(1, height // 24)
    for y in range(height):
        filter_type = decoded[pos]
        row = bytearray(decoded[pos + 1 : pos + 1 + row_size])
        pos += row_size + 1
        if filter_type not in range(5):
            raise ValueError(f"unsupported PNG filter {filter_type}")
        for i in range(row_size):
            left = row[i - 4] if i >= 4 else 0
            above = previous[i]
            upper_left = previous[i - 4] if i >= 4 else 0
            predictor = (0, left, above, (left + above) // 2, paeth(left, above, upper_left))[
                filter_type
            ]
            row[i] = (row[i] + predictor) & 0xFF
        if height // 5 <= y < height * 4 // 5 and y % y_step == 0:
            for x in range(width // 10, width * 9 // 10, x_step):
                colors.add(bytes(row[x * 4 : x * 4 + 3]))
        previous = row
    return len(colors)


if __name__ == "__main__":
    count = content_colors(Path(sys.argv[1]))
    print(f"iOS Simulator app-content colors: {count}")
    if count < 5:
        print("iOS Simulator app content appears blank", file=sys.stderr)
        sys.exit(1)
