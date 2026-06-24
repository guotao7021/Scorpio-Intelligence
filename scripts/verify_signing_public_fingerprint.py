from __future__ import annotations

import argparse
import base64
import hashlib
from pathlib import Path


def base64url_decode(value: str) -> bytes:
    padded = value.strip().replace("-", "+").replace("_", "/")
    padded += "=" * (-len(padded) % 4)
    return base64.b64decode(padded)


def base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print the public key fingerprint expected by Cloudflare signing health."
    )
    parser.add_argument(
        "--public-key",
        default=r"D:\dev\stock\resources\commercial_signing_public.key",
        help="Path to the commercial Ed25519 public key used by the client.",
    )
    args = parser.parse_args()

    path = Path(args.public_key)
    public_text = path.read_text(encoding="utf-8").strip()
    public_key = base64url_decode(public_text)
    if len(public_key) != 32:
        raise SystemExit(f"invalid Ed25519 public key length: {len(public_key)} bytes")

    fingerprint = hashlib.sha256(base64url_encode(public_key).encode("utf-8")).hexdigest()
    print(f"public_key_file={path}")
    print(f"public_key_fingerprint=sha256:{fingerprint}")
    print("Compare this value with /v1/scorpio_v1_admin/signing/health.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
