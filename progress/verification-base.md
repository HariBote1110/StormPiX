# 検証基盤（Phase 8）

## Decision

- 生成 Lua は、テスト用の `ShellLuaExecutor` が一時 harness を生成して PATH の `lua` を実行し、metatable の `screen.*` を呼び出し記録へ変換する。実行器の契約は `LuaExecutor` に分離し、将来 Lua 5.3 WASM 実行器へ差し替えられるようにした。
- harness は通常フレームでは `onTick()` の後に `onDraw()` を呼び、アニメーション往復では初期 `onDraw()` の後に `ticksPerFrame` 回の tick と draw を繰り返す。これでフレームカウンタと差分フレームの実行を検証する。Lua 不在時は `SKIP` を表示して失敗にしない。
- 検証環境の Lua は `/opt/homebrew/bin/lua` の Lua 5.5。Stormworks の Lua 5.3 でも使われる構文・標準 API だけを生成しているが、厳密な実行器の差は将来 5.3 WASM で再確認する。
- `renderWithMask` は既存の `render` と同じ opaque rectangle 経路を維持しつつ、`certainty`/`mask` を追加する。整数軸平行矩形と塗りの厳密な内部を `CERTAIN=1`、線・三角形・円の境界帯を `UNCERTAIN=0` とする。`ssimMasked`/`psnrMasked` は uncertain pixel を除外し、既存の `ssim`/`psnr` は後方互換のまま残した。
- alpha は premultiplied src-over で処理し、opaque (`a` 未指定または255) の既存 RGB 出力は変更しない。`DrawOp` には `triangle`/`triangleF`/`circle`/`circleF`/`text` と `setColour.a` を追加したが、オプティマイザと既存 emit 戦略は新 primitive を生成しない。
- 円は Rust 参照の既定値 `16` を採用し、`CIRCLE_SEGMENT_TABLE` に集約した。開発者バグトラッカー #25012 の r=15 octagon 報告、radius-tiered 8/12/16 実装、Rust の16分割が矛盾するため、結論は出さず編集可能な証拠点として残した。
- 指定された参照元は依頼文の直下パスには存在しなかったが、同一 owner repo の `/Users/yuki/GitHub/storm-lua-runner/rust/lua-runtime-core/src/screen_raster.rs` を読み取り専用で確認できたため、floor/DDA、scanline、16角形、glyph、premultiplied blend をその意味論へ合わせた。
- `pnpm bench` の最後に `/Users/yuki/doc/al/pngX` を直接読み、4/8/16/24/40 frame subset の lossless character count と budget 8192 の one-script 結果を表示する。PNG は比較ベンチの `readPng` を再利用し、資産不在時は skip する。

## Alternatives considered

- Lua VM の npm 依存追加はせず、既存 PATH の Lua と shell harness を採用した。依存を増やさず、生成文字列そのものを実行できるためである。
- 不確実な非矩形境界を GPU ごとに一つの正解へ寄せる処理は追加しなかった。境界を mask で除外し、厳密に保証できる矩形・内部だけを将来の品質評価対象にする。
- 参照 Rust が欠落しているため、別実装の circle tier table を採用して既成事実化することは避けた。既定値は依頼どおり Rust の16分割とした。

## Constraints / Gotchas

- `screen.setColor` はゲーム API の綴りを保ち、内部コメント・ログは British English を使用する。
- `replayLuaFrames` は captured frame を累積してから `render` する。keyframe-diff の未変更画素を毎フレーム黒へ戻さないためである。
- 既存ベンチの character count は、矩形のみの `render` opaque path、emitter 文字列、metrics の unmasked path を変更しないことで固定する。
- 2026-09-21 の既存値は flat-32 74、gradient-32 6372、quadrants-96 214、checker-32 1222、photo-96 7626、budget sweep 60→47/100→75/200→128/300→128/500→128/1000→966/2000→1837/4000→3861/8192→7626。今回の実行でも一致した。
- 実アセットの追加表は `4→lossless 723 / 8192 723 (SSIM 1.000000)`、`8→1497 / 1497 (1.000000)`、`16→7165 / 7165 (1.000000)`、`24→12426 / 8172 (0.945913)`、`40→23970 / 7709 (0.402426)` だった。
- glyph の 95 件は参照 Rust の `TINY_FONT` と機械比較し、ASCII 0x20..0x7E の全行が一致した。
