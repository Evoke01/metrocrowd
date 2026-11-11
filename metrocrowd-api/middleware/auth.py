# ══════════════════════════════════════════════════════════════
#  middleware/auth.py — JWT verification with pinned algorithm
#  Checklist item 1.1 + 1.2: algorithm ALWAYS pinned to HS256.
#  Never derived from token header.
# ══════════════════════════════════════════════════════════════
import os, logging
from fastapi import Request, HTTPException
import jwt  # PyJWT

log = logging.getLogger(__name__)

# Secret from environment ONLY — never hardcoded
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

def verify_supabase_jwt(token: str) -> dict:
    """
    Verify a Supabase-issued JWT.
    Algorithm is PINNED to HS256 — never read from token header.
    Raises HTTPException 401 on any failure.
    """
    if not SUPABASE_JWT_SECRET:
        raise HTTPException(status_code=500, detail="Auth not configured")
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],           # PINNED — never jwt.get_unverified_header()
            options={
                "verify_exp": True,
                "verify_aud": False,        # Supabase doesn't set aud on anon keys
            },
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidAlgorithmError:
        raise HTTPException(status_code=401, detail="Invalid token algorithm")
    except jwt.InvalidTokenError as e:
        log.warning(f"JWT verification failed: {type(e).__name__}")
        raise HTTPException(status_code=401, detail="Invalid token")


def get_token_from_request(request: Request) -> str | None:
    """Extract Bearer token from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def require_auth(request: Request) -> dict:
    """Dependency: raises 401 if request has no valid JWT."""
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    return verify_supabase_jwt(token)


def require_supabase_user(request: Request) -> dict:
    """Validate an access token with Supabase Auth (supports current signing keys)."""
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    # Ask Supabase Auth directly. This works with both legacy JWT keys and the
    # newer sb_secret_/sb_publishable_ keys and any token signing algorithm,
    # and doesn't depend on the supabase-py client's key-format checks.
    import requests
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        log.error("SUPABASE_URL / SUPABASE_KEY not set; cannot validate users")
        raise HTTPException(status_code=500, detail="Server auth is not configured")
    try:
        resp = requests.get(
            f"{url}/auth/v1/user",
            headers={"apikey": key, "Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except requests.RequestException as exc:
        log.warning("Supabase Auth unreachable: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Auth service unreachable, try again")
    if resp.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Session expired, please sign in again")
    if resp.status_code != 200:
        log.error("Supabase Auth returned %s: %s", resp.status_code, resp.text[:200])
        raise HTTPException(status_code=502, detail=f"Auth check failed ({resp.status_code})")
    user = resp.json() or {}
    if not user.get("id"):
        raise HTTPException(status_code=401, detail="Session expired, please sign in again")
    return {
        "sub": str(user["id"]),
        "email": user.get("email"),
        "is_anonymous": bool(user.get("is_anonymous", False)),
    }
