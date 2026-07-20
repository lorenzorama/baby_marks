import re

from app.auth import compute_auth_token


def test_token_is_deterministic_64_char_hex():
    a = compute_auth_token("s1")
    b = compute_auth_token("s1")
    assert a == b
    assert re.fullmatch(r"[0-9a-f]{64}", a)


def test_different_secrets_give_different_tokens():
    assert compute_auth_token("s1") != compute_auth_token("s2")


def test_matches_legacy_nextjs_token():
    # HMAC-SHA256(key="test-secret", message="baby-marks-auth-v1"), as produced
    # by the previous Next.js implementation via WebCrypto.
    import hashlib
    import hmac

    expected = hmac.new(
        b"test-secret", b"baby-marks-auth-v1", hashlib.sha256
    ).hexdigest()
    assert compute_auth_token("test-secret") == expected
