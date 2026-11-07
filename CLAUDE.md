# Replay Player

OBS の録画を見返してクリップを作る Tauri v2 + React アプリ。詳細は README.md。

## ルール

- パッケージマネージャーは **bun** だけを使う。npm / yarn / pnpm のコマンドやロックファイル（package-lock.json など）を持ち込まない。ロックファイルは `bun.lock`。
- `src-tauri/tauri.conf.json` の beforeDevCommand / beforeBuildCommand、GitHub Actions、README の手順もすべて bun で書く。
- 返答・README・コードコメントは日本語。
- UI を変えるときは `DESIGN.md` の方向性（色・文字・言葉づかい・動き）に従う。
- 利用者は Windows。Windows 専用の処理（`#[cfg(windows)]`）を変えたら `cargo check --target x86_64-pc-windows-msvc` で型チェックする。

## よく使うコマンド

- `bun install`
- `bun run tauri dev` / `bun run tauri build`
- `bun run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml`
