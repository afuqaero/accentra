# Evaluation harness

Phase 1 establishes the contract and a place for the golden set. Add redacted fixtures under `eval/fixtures/` with expected `ExtractedDocument` JSON before connecting a vision provider. The launch gate from the plan is measured per field, not by a single document-level score.

Each fixture should record:

- source family and MIME type;
- expected value, raw text, and page for each labelled field;
- whether the field is intentionally unreadable;
- the reader version used to produce the result.
