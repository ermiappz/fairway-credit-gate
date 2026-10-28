#!/usr/bin/env bash
# Install this repo as examples/sacco-credit-gate inside a midnight-examples
# checkout, for the devnet lane (real proofs, local node + indexer + proof
# server in Docker). The standalone npm setup cannot run that lane: its wallet
# harness (@midnight-ntwrk/example-fast-sync) is a private workspace package
# of the monorepo, not published to npm.
#
# usage: scripts/into-monorepo.sh /path/to/midnight-examples
set -euo pipefail

mono="${1:?usage: $0 /path/to/midnight-examples}"
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="$mono/examples/sacco-credit-gate"

if ! grep -q '"name": "mn-examples"' "$mono/package.json" 2>/dev/null; then
  echo "error: $mono does not look like a midnight-examples checkout" >&2
  exit 1
fi
if [ -e "$dest" ]; then
  echo "error: $dest already exists; remove it first" >&2
  exit 1
fi

mkdir -p "$dest"
# Source only: no node_modules, no git history, no npm lockfile (yarn owns the
# monorepo's dependency tree).
tar -C "$here" --exclude=./node_modules --exclude=./.git --exclude=./package-lock.json -cf - . | tar -C "$dest" -xf -
cp "$here/onchain/monorepo/package.json"     "$dest/package.json"
cp "$here/onchain/monorepo/tsconfig.json"    "$dest/tsconfig.json"
cp "$here/onchain/monorepo/vitest.config.ts" "$dest/vitest.config.ts"

cat <<NEXT
Installed into $dest

Next:
  cd $mono && corepack enable && yarn install
  cd examples/sacco-credit-gate
  yarn compile          # full compile, with proving keys (a few minutes)
  yarn test:sim         # simulator + signing tests, same as 'make test'
  yarn env:up           # node :9944, indexer :8088, proof server :6300
  yarn wait:dust
  yarn test:local       # deploy and call the contract with real proofs
  yarn env:down
NEXT
