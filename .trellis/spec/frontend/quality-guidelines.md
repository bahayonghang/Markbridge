# Frontend Quality Guidelines

No package manifest or UI tests exist. The foundation task must create commands before later tasks can report them as gates.

Validate keyboard navigation, moving, profile switching, edits, proposal review, read-only states, and conflicts. Fixtures include duplicate URLs, equal IDs across profiles, long titles, deep folders, and non-ASCII tags.

Test late preview responses, open drafts invalidated by browser edits, and disconnect during apply. Unknown results must differ from confirmed failures.

DOM tests cover state and interactions. Native Tauri runs cover remote preview isolation, focus, OS behavior, and rendering. Record viewport and runtime with screenshots. Mock IPC does not establish native correctness.

Performance evidence includes item count and machine details. Virtualization preserves selection and keyboard behavior. Avoid tests that only duplicate implementation markup.
