#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f $1 ]]; then
  echo "Usage: $0 <scholar.deb>" >&2
  exit 2
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run this rehearsal as root in an isolated runner" >&2
  exit 2
fi

candidate=$(realpath "$1")
package=$(dpkg-deb --field "$candidate" Package)
version=$(dpkg-deb --field "$candidate" Version)
if [[ $package != readest-scholar || -z $version ]]; then
  echo "Unexpected candidate package identity: $package $version" >&2
  exit 1
fi
older_version="${version}~scholar-smoke1"
dpkg --compare-versions "$older_version" lt "$version"

work=$(mktemp -d)
trap 'dpkg --remove "$package" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
dpkg-deb --raw-extract "$candidate" "$work/root"
sed -i "s/^Version: .*/Version: $older_version/" "$work/root/DEBIAN/control"
dpkg-deb --build --root-owner-group "$work/root" "$work/older.deb" >/dev/null
test "$(dpkg-deb --field "$work/older.deb" Version)" = "$older_version"

install_and_check() {
  local file=$1 expected=$2 actual
  dpkg -i "$file"
  actual=$(dpkg-query -W -f='${Version}' "$package")
  if [[ $actual != "$expected" || ! -x /usr/bin/readest-scholar ]]; then
    echo "Package transition failed: expected $expected, got $actual" >&2
    exit 1
  fi
  echo "Installed $package $actual"
}

install_and_check "$work/older.deb" "$older_version"
install_and_check "$candidate" "$version"
install_and_check "$work/older.deb" "$older_version"
dpkg --remove "$package"
if [[ -e /usr/bin/readest-scholar ]]; then
  echo "Scholar executable remained after final removal" >&2
  exit 1
fi
echo "Synthetic package upgrade and rollback passed; application data compatibility was not tested"
