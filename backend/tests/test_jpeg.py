import pytest

from app.photos.jpeg import InvalidJpeg, jpeg_dimensions


def sof0(width: int, height: int, prefix: bytes = b"") -> bytes:
    """A minimal but structurally valid JPEG: SOI, optional segments, SOF0, EOI."""
    sof = (
        b"\xff\xc0"
        + (17).to_bytes(2, "big")  # segment length
        + b"\x08"  # 8-bit precision
        + height.to_bytes(2, "big")
        + width.to_bytes(2, "big")
        + b"\x03"  # 3 components
        + b"\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    )
    return b"\xff\xd8" + prefix + sof + b"\xff\xd9"


def app0() -> bytes:
    """A JFIF APP0 segment, the kind browsers put before the SOF."""
    body = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    return b"\xff\xe0" + (len(body) + 2).to_bytes(2, "big") + body


def test_reads_dimensions_from_sof0():
    assert jpeg_dimensions(sof0(320, 240)) == (320, 240)


def test_skips_leading_segments():
    assert jpeg_dimensions(sof0(1280, 720, prefix=app0())) == (1280, 720)


def test_handles_progressive_sof2():
    data = bytearray(sof0(800, 600))
    data[2:4] = b"\xff\xc2"  # SOF2 (progressive) instead of SOF0
    assert jpeg_dimensions(bytes(data)) == (800, 600)


def test_tolerates_fill_bytes_before_a_marker():
    data = sof0(320, 240, prefix=b"\xff\xff")
    assert jpeg_dimensions(data) == (320, 240)


def test_rejects_non_jpeg():
    for blob in (b"", b"\x89PNG\r\n\x1a\n", b"not an image at all"):
        with pytest.raises(InvalidJpeg):
            jpeg_dimensions(blob)


def test_rejects_jpeg_without_sof():
    with pytest.raises(InvalidJpeg):
        jpeg_dimensions(b"\xff\xd8" + app0() + b"\xff\xd9")


def test_rejects_truncated_sof():
    truncated = sof0(320, 240)[:8]
    with pytest.raises(InvalidJpeg):
        jpeg_dimensions(truncated)


def test_rejects_zero_dimension():
    with pytest.raises(InvalidJpeg):
        jpeg_dimensions(sof0(0, 240))


def test_rejects_bogus_segment_length():
    data = bytearray(sof0(320, 240, prefix=app0()))
    data[4:6] = b"\x00\x00"  # APP0 length of 0 would loop forever
    with pytest.raises(InvalidJpeg):
        jpeg_dimensions(bytes(data))
