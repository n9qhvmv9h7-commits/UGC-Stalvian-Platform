"""Set (or reset) an admin password directly against the database.

The bootstrap env vars only ever create the FIRST admin — app/main.py's
_bootstrap_admin() returns early once any admin exists, so putting
BOOTSTRAP_ADMIN_PASSWORD back does nothing for an account that already exists.
Passwords are bcrypt hashes and cannot be read back, so a lost admin password
has exactly one recovery: write a new hash. That is what this does.

Run it where DATABASE_URL points at the database you mean:

    python reset_admin_password.py you@stalvian.com
    python reset_admin_password.py you@stalvian.com --password 'chosen-one'

With no --password a strong one is generated and printed once. The account is
created if missing, and is always left admin + approved so it can actually get
in. Changing the hash also invalidates every outstanding token for that account
(app/auth.py ties a token to the password via its `pwv` claim), so any stolen
session dies here too.
"""
import argparse
import asyncio
import secrets
import sys

from sqlalchemy import select

from app.auth import hash_password
from app.database import async_session
from app.models import Creator


async def reset(email: str, password: str) -> str:
    email = email.lower().strip()
    async with async_session() as db:
        creator = (
            await db.execute(select(Creator).where(Creator.email == email))
        ).scalar_one_or_none()
        if creator is None:
            db.add(
                Creator(
                    email=email,
                    password_hash=hash_password(password),
                    name=email.split("@")[0],
                    status="approved",
                    is_admin=True,
                )
            )
            action = "created"
        else:
            creator.password_hash = hash_password(password)
            # A locked-out admin is no use if the account is also suspended.
            creator.is_admin = True
            creator.status = "approved"
            action = "reset"
        await db.commit()
    return action


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email", help="Account to create or reset")
    parser.add_argument(
        "--password",
        help="Password to set. Omit to generate a strong one and print it.",
    )
    args = parser.parse_args()

    password = args.password or secrets.token_urlsafe(16)
    if len(password) < 8:
        print("Password must be at least 8 characters", file=sys.stderr)
        return 1

    action = asyncio.run(reset(args.email, password))

    print(f"\n  {action}: {args.email} (admin, approved)")
    if not args.password:
        print(f"  password: {password}")
        print("\n  Shown once — store it now, then change it in Settings.")
    print("  Any existing session for this account is now signed out.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
