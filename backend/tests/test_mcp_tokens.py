from app.mcp.tokens import mint_access_token, verify_access_token, new_refresh_token, hash_refresh_token, TokenError
import pytest, time

SECRET = "test-jwt-secret"

def test_mint_and_verify_roundtrip():
    claims = verify_access_token(mint_access_token(SECRET), SECRET)
    assert claims["sub"] == "mcp" and claims["scope"] == "mcp"
    assert claims["exp"] - claims["iat"] == 3600

def test_wrong_secret_rejected():
    with pytest.raises(TokenError): verify_access_token(mint_access_token(SECRET), "other")

def test_expired_rejected():
    tok = mint_access_token(SECRET, ttl_seconds=-1)
    with pytest.raises(TokenError): verify_access_token(tok, SECRET)

def test_tampered_header_rejected():
    import base64, json
    h = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    _, payload, sig = mint_access_token(SECRET).split(".")
    with pytest.raises(TokenError): verify_access_token(f"{h}.{payload}.{sig}", SECRET)

def test_garbage_rejected():
    for bad in ["", "a.b", "a.b.c.d", "not-a-token"]:
        with pytest.raises(TokenError): verify_access_token(bad, SECRET)

def test_refresh_token_entropy_and_hash():
    t1, t2 = new_refresh_token(), new_refresh_token()
    assert t1 != t2 and len(t1) >= 43
    assert hash_refresh_token(t1, SECRET) != hash_refresh_token(t2, SECRET)
    assert len(hash_refresh_token(t1, SECRET)) == 64

def test_refresh_token_hash_is_keyed_by_secret():
    # Same token, different secrets -> different hash. This is the property
    # that makes rotating MCP_JWT_SECRET revoke stored refresh-token hashes:
    # an unkeyed hash would be invariant under secret rotation.
    token = new_refresh_token()
    assert hash_refresh_token(token, SECRET) != hash_refresh_token(token, "other-secret")
