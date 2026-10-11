# Bootstrap Guidelines

## Goal

Complete the initial Markbridge coding guidelines before product planning.

## Current repository

The repository has no product implementation or package manifests. Existing evidence consists of AGENTS.md, Trellis workflow/configuration, and the local reference plan. The reference plan is ignored by Git. The bootstrap therefore records greenfield constraints and verified API boundaries; it cannot extract existing application code examples.

## Acceptance

- [x] Replace backend template prose with project-specific ownership, identity, storage, error, logging, and verification rules.
- [x] Replace frontend template prose with preview, editing, state, lifecycle, type, and UI verification contracts.
- [x] Add extension boundaries for API access, pairing, permissions, worker recovery, and receipts.
- [x] Add valid JSON contract fixtures, clearly labeled as documentation examples.
- [x] Record the absence of real source examples. Require the implementation tasks to add source/test references after code exists.
- [x] Keep indexes aligned and local links valid.
- [x] Remove template markers from the spec tree.

## Scope decision

The original generated task requested examples from existing code. No application code exists. Completing that wording literally would require inventing examples or implementing the product outside the current planning scope. The accepted bootstrap deliverable is source-honest documentation fixtures and explicit greenfield constraints. Product implementation and runtime verification remain unperformed.

## Deliverables

See [validation](validation.md) and [project baseline](../../spec/project-baseline.md). Existing thinking guides remain available. No commit or task archive is part of this completion.

## Status

Completed for the greenfield repository. Product implementation approval remains separate.
