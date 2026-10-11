# Backend Quality Guidelines


Child 02 protocol behavior tests are in `crates/protocol/src/wire_tests.rs`; storage and migration tests are in `crates/core/src/storage/tests.rs`. Run the Rust tests and protocol generation against the current source. A cached exporter result alone does not establish that the current Rust source compiles. The TypeScript wire tests also invoke the Rust fixture executable and compare acceptance of shared input frames.

Use synthetic fixtures and disposable profiles. Cover identity isolation, dynamic roots, managed nodes, event gaps, lost acknowledgments, worker restart, migration failure, interrupted batch, and rollback conflicts.

Check fetch restrictions at every redirect and address resolution. A remote preview must fail to invoke protected commands.

Record timestamps, fixture size, runtime, and machine for latency claims. Compare semantic structure and order for rollback; recreated node IDs can differ.

Native Chrome, WebView isolation, secret storage, and installed behavior require native evidence. A build or mock is insufficient. Record absent environments as NOT_RUN.
