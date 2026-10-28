# fairway-credit-gate. Everything except `compile` and `devnet-*` needs only Node 22.
#
#   make test      contract tests on the in-memory simulator + signing service tests
#   make demo      narrated end-to-end run (simulator lane, synthetic data, no keys)
#   make compile   recompile the contract with the pinned Compact compiler (--skip-zk)
#   make ci        what GitHub Actions runs, minus the toolchain install
#
# Compiler: uses the `compact` CLI by default (`compact update 0.31.1` first).
# To call a compactc binary directly instead: make compile COMPACTC=/path/to/compactc

COMPACT_VERSION := 0.31.1
CONTRACT        := contract/sacco-credit-gate.compact
OUT             := contract/managed/sacco-credit-gate
COMPACTC        ?=

.PHONY: help install test demo typecheck compile compile-zk check-generated ci attestation monorepo clean

help:
	@grep -E '^#   make' Makefile | sed 's/^#   //'

# npm ci, not npm install: the committed lockfile sidesteps an npm 10 resolver
# crash on vitest 4's optional peers, and keeps CI and laptops on one tree.
node_modules/.package-lock.json: package.json package-lock.json
	npm ci
	@touch $@

install: node_modules/.package-lock.json

test: install
	npx vitest run

demo: install
	npx tsx demo/demo.ts

typecheck: install
	npx tsc --noEmit -p .

compile:
ifeq ($(strip $(COMPACTC)),)
	@command -v compact >/dev/null || { echo "compact CLI not found. Install: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh && compact update $(COMPACT_VERSION)"; exit 1; }
	@compact compile --version | grep -q '$(COMPACT_VERSION)' || { echo "expected compiler $(COMPACT_VERSION), got $$(compact compile --version). Run: compact update $(COMPACT_VERSION)"; exit 1; }
	compact compile --skip-zk $(CONTRACT) $(OUT)
else
	@$(COMPACTC) --version | grep -q '$(COMPACT_VERSION)' || { echo "expected compiler $(COMPACT_VERSION), got $$($(COMPACTC) --version)"; exit 1; }
	$(COMPACTC) --skip-zk $(CONTRACT) $(OUT)
endif

# Full compile with proving keys: only needed for the devnet lane (onchain/).
compile-zk:
	compact compile $(CONTRACT) $(OUT)

# The --skip-zk output is committed so tests run without the compiler. This
# fails if the committed copy no longer matches what the pinned compiler emits.
check-generated: compile
	git diff --exit-code -- $(OUT) || { echo "contract/managed is stale: commit the recompiled output"; exit 1; }

ci: check-generated typecheck test demo

# The SACCO signing service on :4000 (ephemeral key unless PROVIDER_SECRET_KEY is set).
attestation: install
	npx tsx attestation-api/index.ts

# Copy this repo into a midnight-examples checkout for the devnet lane.
monorepo:
	@test -n "$(MONOREPO)" || { echo "usage: make monorepo MONOREPO=/path/to/midnight-examples"; exit 1; }
	./scripts/into-monorepo.sh "$(MONOREPO)"

clean:
	rm -rf node_modules $(OUT)/keys
