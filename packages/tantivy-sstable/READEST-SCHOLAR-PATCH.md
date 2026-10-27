# Readest Scholar patch

Source: `tantivy-sstable` 0.7.0 from crates.io, archive SHA-256
`8a2cfc3ac5164cbadc28965ffb145a8f47582a60ae5897859ad8d4316596c606`.
The upstream project is [Tantivy](https://github.com/quickwit-oss/tantivy).
Its MIT license is retained in `LICENSE`.

Local changes:

- Require `zstd` 0.14.3 instead of 0.13, which resolves to `zstd-safe`
  8.2.0 and `zstd-sys` 2.1.2 in the root lockfile.
- Add a compressed SSTable fixture written by upstream 0.7.0 with zstd
  0.13.3, plus a test that the patched reader can open it.

Keep this fork only until an upstream release moves the dependency and
passes the same old-data compatibility test.
