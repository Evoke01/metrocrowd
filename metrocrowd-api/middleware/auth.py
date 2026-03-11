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
