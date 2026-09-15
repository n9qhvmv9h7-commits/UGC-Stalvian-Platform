"""Encryption for credentials we hold on someone else's behalf.

Social OAuth tokens are the first real secrets this application stores: unlike
every other credential here, they are not ours — they belong to the creator,
and they grant access to their account. They do not belong in plain columns.

What this protects against, honestly: a database dump, a leaked backup, a
read replica, a log spill. It does NOT protect against the application being
compromised, because the running process necessarily holds the key. That is
the normal trade, but it should be stated rather than assumed.

Three rules that matter as much as the encryption:
  - tokens never appear in an API response,
  - never in a log line,
  - never in an audit `detail` blob.

Key rotation is deliberately boring. SOCIAL_TOKEN_KEYS is a comma-separated
list, newest first: new values encrypt under the first key, old ciphertexts
still decrypt under any. Prepend a key, redeploy, and rows rewrite themselves
as tokens refresh — TikTok rotates its refresh token on every use, so a day or
two of normal operation re-encrypts everything. Then drop the old key. No
rotation job, no key_id column, no migration.
"""
from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config import settings


class TokenCryptoUnavailable(RuntimeError):
    """No usable key configured. Callers must fail closed, never store plaintext."""


def _cipher() -> MultiFernet:
    raw = [k.strip() for k in (settings.SOCIAL_TOKEN_KEYS or "").split(",") if k.strip()]
    if not raw:
        raise TokenCryptoUnavailable(
            "SOCIAL_TOKEN_KEYS is not set — refusing to store social tokens"
        )
    try:
        return MultiFernet([Fernet(k) for k in raw])
    except (ValueError, TypeError) as exc:
        raise TokenCryptoUnavailable(f"SOCIAL_TOKEN_KEYS is malformed: {exc}") from exc


def available() -> bool:
    """Whether tokens can be stored at all — drives the 503 on the connect route."""
    try:
        _cipher()
    except TokenCryptoUnavailable:
        return False
    return True


def encrypt(value: str | None) -> str | None:
    if value is None:
        return None
    return _cipher().encrypt(value.encode()).decode()


def decrypt(value: str | None) -> str | None:
    """None on any failure, so a key that no longer decrypts an old row reads as
    'this connection needs reauthorising' rather than crashing a sync job."""
    if value is None:
        return None
    try:
        return _cipher().decrypt(value.encode()).decode()
    except (InvalidToken, TokenCryptoUnavailable):
        return None


def generate_key() -> str:
    """A fresh key, for `python -c 'from app.services.crypto import generate_key;
    print(generate_key())'` when setting SOCIAL_TOKEN_KEYS."""
    return Fernet.generate_key().decode()
