# Readest Scholar patch

Source: `tauri-plugin-updater` 2.11.0 from crates.io, archive SHA-256
`b28d8cabdeb0564f03ae261963de4bc3d98321cd3d213e76a81b7d344e5df606`.
The upstream project is [Tauri plugins](https://github.com/tauri-apps/plugins-workspace).
Its Apache-2.0 OR MIT license is retained in `LICENSE_APACHE-2.0`,
`LICENSE_MIT`, and the upstream `LICENSE.spdx`.

Local change: require `zip` 9 instead of 4 for the Windows update archive
extractor. The root lockfile resolves 9.1.1 and removes vulnerable zip 4.6.1.
The fork rejects options that disable TLS certificate or hostname validation
and always uses the normal request validation path. This retains updater
support while applying the upstream zip security fixes.
Remove this fork when a compatible upstream updater release uses zip 9.
