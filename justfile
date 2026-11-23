# Markbridge local commands. `ci` follows .github/workflows/ci.yml.
# `build` is the web and extension production build. `build-native` is the
# Windows release executable scan. `build-package` creates the unsigned local
# installer without installing it. `install-app` builds that package and
# installs it for the current user. `dev` opens the native window.
#
# Windows PowerShell 5.1 captures native stderr, so cargo clippy's status
# never reaches the console and `just ci` looks stuck. cmd.exe does not.

set windows-shell := ["cmd.exe", "/c"]

# List recipes.
default:
    @just --list

# List recipes in workflow order.
help:
    @just --list --unsorted

# Install from the lockfile.
install:
    pnpm install --frozen-lockfile

# ESLint. Does not modify files.
lint:
    pnpm lint

# Strict TypeScript check.
typecheck:
    pnpm typecheck

# Vitest and Node contract tests.
test:
    pnpm test

# Playwright browser tests.
test-e2e:
    pnpm test:e2e

# Download Playwright Chromium. Does not use the daily Chrome profile.
playwright-install:
    pnpm exec playwright install chromium

# Fail when generated protocol files drift.
protocol-check:
    pnpm protocol:check

# Rewrite generated protocol files.
protocol-generate:
    pnpm protocol:generate

# Rust format check.
fmt:
    cargo fmt --all -- --check

# Rust workspace lint.
clippy:
    cargo clippy --workspace --all-targets -- -D warnings

# Rust workspace tests.
test-rust:
    cargo test --workspace --locked

# Frontend and extension production build, then artifact scan.
build:
    pnpm build

# Unpacked Chrome extension (apps/extension/dist) + portable ZIP (apps/extension/dist-extension/).
build-extension *args:
    node scripts/build-extension.mjs {{args}}

# Signed Chrome CRX3 package in apps/extension/dist-crx/ (requires local key; blocked off-store on Windows Chrome).
build-crx *args:
    node scripts/build-crx.mjs {{args}}

# Generate local gitignored CRX private key and rotate fixed extension ID across the repo.
crx-rotate-key *args:
    node scripts/build-crx.mjs --rotate-key {{args}}

# Windows release executable and scan. Does not create an installer.
build-native:
    pnpm build:native

# Unsigned local NSIS after the native build. Not a published package.
build-package:
    pnpm build:package

# Unsigned current-user install. Builds the local NSIS package first.
# Native compile progress stays on this stream, including while one crate is quiet.
install-app: build-package
    node scripts/install-app.mjs

# Native development window. Listens on 127.0.0.1, skipping a reserved port.
dev:
    node scripts/tauri-dev.mjs

# Browser-only frontend preview. This is not native IPC.
dev-web:
    pnpm --filter @markbridge/desktop dev

# GitHub Actions windows job, in the same order.
# Show stage timing and a heartbeat while a child command is quiet.
ci:
    node scripts/ci.mjs
