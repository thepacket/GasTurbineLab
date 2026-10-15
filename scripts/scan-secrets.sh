#!/usr/bin/env bash
# Pinned, checksum-verified scanner; no global install and no credentials required.
set -euo pipefail
cd "$(dirname "$0")/.."
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin_arm64; checksum=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  Darwin-x86_64) platform=darwin_x64; checksum=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
  Linux-x86_64) platform=linux_x64; checksum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  Linux-aarch64) platform=linux_arm64; checksum=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  *) echo 'Unsupported platform; install Gitleaks 8.30.1 manually.' >&2; exit 1 ;;
esac
scan_tmp=$(mktemp -d)
trap 'rm -rf "$scan_tmp"' EXIT
archive="gitleaks_8.30.1_${platform}.tar.gz"
curl --fail --silent --show-error --location --retry 3 "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/$archive" -o "$scan_tmp/$archive"
(cd "$scan_tmp" && printf '%s  %s\n' "$checksum" "$archive" | shasum -a 256 -c -)
tar -xzf "$scan_tmp/$archive" -C "$scan_tmp" gitleaks
"$scan_tmp/gitleaks" git --redact=100 --log-opts='--all' .
# Also scan pending additions/edits, without copying ignored local environments.
python3 - "$scan_tmp/tree" <<'PY'
import pathlib, shutil, subprocess, sys
out = pathlib.Path(sys.argv[1]); out.mkdir()
for raw in subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard']).split(b'\0'):
    if not raw:
        continue
    src = pathlib.Path(raw.decode())
    if src.is_symlink():
        raise SystemExit(f'Review symlink before scanning: {src}')
    if src.is_file():
        dst = out / src
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
PY
"$scan_tmp/gitleaks" dir --redact=100 "$scan_tmp/tree"
