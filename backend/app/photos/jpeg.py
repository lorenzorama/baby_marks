"""Minimal JPEG header reader.

Used to (a) confirm an upload really is a JPEG rather than trusting the
client's Content-Type, and (b) record the image dimensions. Hand-rolled on
purpose: a full imaging library would be a heavy dependency for 30 lines of
header walking.
"""

# Start-Of-Frame markers, excluding DHT (0xC4), JPG (0xC8) and DAC (0xCC),
# which share the 0xCn range but are not frame headers.
_SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
_STANDALONE = {0xD8, 0xD9, *range(0xD0, 0xD8)}  # SOI, EOI, RSTn: no length field


class InvalidJpeg(ValueError):
    """Raised when the payload is not a JPEG we can read dimensions from."""


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    """Return (width, height) from the first Start-Of-Frame segment."""
    if len(data) < 4 or data[0] != 0xFF or data[1] != 0xD8:
        raise InvalidJpeg("missing JPEG start-of-image marker")

    i = 2
    while i + 1 < len(data):
        if data[i] != 0xFF:
            raise InvalidJpeg("expected a segment marker")
        marker = data[i + 1]
        if marker == 0xFF:  # fill byte, keep scanning
            i += 1
            continue
        if marker in _STANDALONE:
            i += 2
            continue
        if i + 3 >= len(data):
            raise InvalidJpeg("truncated segment header")
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        if length < 2:
            raise InvalidJpeg("invalid segment length")
        if marker in _SOF_MARKERS:
            if i + 9 > len(data):
                raise InvalidJpeg("truncated frame header")
            height = int.from_bytes(data[i + 5 : i + 7], "big")
            width = int.from_bytes(data[i + 7 : i + 9], "big")
            if width == 0 or height == 0:
                raise InvalidJpeg("zero-sized image")
            return width, height
        i += 2 + length

    raise InvalidJpeg("no frame header found")
