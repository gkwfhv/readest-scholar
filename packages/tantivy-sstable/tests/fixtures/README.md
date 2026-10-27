# Legacy zstd fixture

`zstd-0.13.3.sstable` was generated from the unmodified `tantivy-sstable`
0.7.0 crates.io package (SHA-256 `8a2cfc3ac5164cbadc28965ffb145a8f47582a60ae5897859ad8d4316596c606`),
with `zstd-compression` enabled and `zstd` 0.13.3. The writer inserted 10,000
`term-{ordinal:05}` keys with the corresponding `u64` ordinal values into
`Dictionary<MonotonicU64SSTable>`. The file contains a zstd frame and exercises
reading a persisted index after upgrading the compression library.

The reverse check (old 0.13.3 reader opening the new 0.14.3 output) was performed
in the server compatibility probe; the fixture test intentionally pins the
migration direction needed by installed users.
