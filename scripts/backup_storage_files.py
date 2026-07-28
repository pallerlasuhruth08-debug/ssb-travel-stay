#!/usr/bin/env python3
"""
MKN Transport & Stay -- download every uploaded ID photo and ticket file
from Supabase Storage into a local folder, mirroring the app's own layout.

Run this on YOUR OWN computer (not inside a sandboxed Claude session --
this needs open internet access to reach Supabase directly).

Usage:
    python3 backup_storage_files.py

It will ask for the email + password of a staff account (Coordinator,
Travel Desk, Accommodation Desk, or Admin) -- any of the five test accounts
in HANDOVER.md work, or your own admin login. Nothing is saved to disk;
it's only used once to get a short-lived access token.

Requires only the Python standard library -- no pip install needed.
"""
import getpass
import json
import os
import urllib.request
import urllib.error

SUPABASE_URL = "https://zbqetpvgipgagmmyupcn.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_9N-AtGZTNYsOLNAYj1W8AQ_ya6ccY6C"  # public key, same one shipped in app.js
BUCKETS = ["mkn-ids", "mkn-tickets"]
OUT_DIR = "storage-backup"


def http(method, path, token=None, body=None):
    url = SUPABASE_URL + path
    headers = {"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def sign_in(email, password):
    status, body = http("POST", "/auth/v1/token?grant_type=password", body={"email": email, "password": password})
    if status != 200:
        raise SystemExit(f"Sign-in failed ({status}): {body.decode(errors='replace')}")
    return json.loads(body)["access_token"]


def list_objects(bucket, token, prefix=""):
    status, body = http(
        "POST", f"/storage/v1/object/list/{bucket}", token=token,
        body={"prefix": prefix, "limit": 1000, "sortBy": {"column": "name", "order": "asc"}},
    )
    if status != 200:
        raise SystemExit(f"Listing {bucket}/{prefix} failed ({status}): {body.decode(errors='replace')}")
    return json.loads(body)


def download_object(bucket, path, token):
    status, body = http("GET", f"/storage/v1/object/authenticated/{bucket}/{path}", token=token)
    if status != 200:
        raise SystemExit(f"Download {bucket}/{path} failed ({status}): {body.decode(errors='replace')}")
    return body


def walk_bucket(bucket, token, prefix=""):
    """Recurse into subfolders (Supabase's list API is one level at a time)."""
    files = []
    for entry in list_objects(bucket, token, prefix):
        full_path = f"{prefix}{entry['name']}" if prefix else entry["name"]
        if entry.get("id") is None:
            # no id => this entry is a "folder" (a common path prefix), recurse into it
            files.extend(walk_bucket(bucket, token, full_path + "/"))
        else:
            files.append(full_path)
    return files


def main():
    print("MKN Transport & Stay -- Storage backup\n")
    email = input("Staff account email (e.g. travel.test@ssb.local, or your admin login): ").strip()
    password = getpass.getpass("Password: ")
    token = sign_in(email, password)
    print("Signed in OK.\n")

    total = 0
    for bucket in BUCKETS:
        print(f"Listing {bucket} ...")
        paths = walk_bucket(bucket, token)
        if not paths:
            print(f"  (empty -- nothing uploaded to {bucket} yet)\n")
            continue
        for path in paths:
            local_path = os.path.join(OUT_DIR, bucket, path)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            print(f"  downloading {bucket}/{path}")
            content = download_object(bucket, path, token)
            with open(local_path, "wb") as f:
                f.write(content)
            total += 1
        print()

    print(f"Done. {total} file(s) saved under ./{OUT_DIR}/")


if __name__ == "__main__":
    main()
