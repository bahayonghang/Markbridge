# Backend Quality Guidelines

No Cargo manifest or product tests exist. Bootstrap can verify only documents and task structure.

The foundation task must establish gates. Proposed commands are `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace --locked`. These commands become runnable after scaffolding.

Use synthetic fixtures and disposable profiles. Cover identity isolation, dynamic roots, managed nodes, event gaps, lost acknowledgments, worker restart, migration failure, interrupted batch, and rollback conflicts.

Check fetch restrictions at every redirect and address resolution. A remote preview must fail to invoke protected commands.

Record timestamps, fixture size, runtime, and machine for latency claims. Compare semantic structure and order for rollback; recreated node IDs can differ.

Native Chrome, WebView isolation, secret storage, and installed behavior require native evidence. A build or mock is insufficient. Record absent environments as NOT_RUN.
