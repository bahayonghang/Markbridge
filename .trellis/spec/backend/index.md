# Backend Guidelines

Read [Project baseline](../project-baseline.md) first. Child 01 provides the Rust workspace and startup IPC. Child 02 adds shared protocol and the SQLite storage worker. Browser mutations remain child 06 contracts. Runtime acceptance results belong in child evidence.

| Guide | Scope |
|---|---|
| [Directory structure](directory-structure.md) | Runtime ownership |
| [Database](database-guidelines.md) | Identity, metadata, transactions |
| [Errors](error-handling.md) | Validation, conflicts, uncertain writes |
| [Logging](logging-guidelines.md) | Diagnostic fields and redaction |
| [Quality](quality-guidelines.md) | Contract-specific evidence |
| [Extension](../extension/index.md) | Browser adapter and transport |
