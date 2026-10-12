# Markbridge local commands. `ci` follows .github/workflows/ci.yml.
# `build` is the web and extension production build. `build-native` is the
# Windows release executable scan. `dev` opens the native window.

set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

# List recipes.
default:
    @just --list

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

# Windows release executable and scan. Does not create an installer.
build-native:
    pnpm build:native

# Unsigned local NSIS after the native build. Not a published package.
build-package:
    pnpm build:package

# Native development window. Listens on 127.0.0.1, skipping a reserved port.
dev:
    node scripts/tauri-dev.mjs

# Browser-only frontend preview. This is not native IPC.
dev-web:
    pnpm --filter @markbridge/desktop dev

# GitHub Actions windows job, in the same order.
ci: install lint typecheck build protocol-check test fmt clippy test-rust build-native playwright-install test-e2e
