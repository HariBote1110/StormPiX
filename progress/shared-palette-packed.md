# 共有paletteのpackedアニメーション

## Decision

- 1〜2フレームのindexed animationには、共有paletteと共有delta decoderを使うpacked候補を追加する。
- paletteは区間で使われる色だけに絞り、最大512色まで9bitの最初のindex幅で表現する。各フレームのdelta符号化は同じまま保持する。

## Measurement

- `astral_opening` は29,979文字から27,276文字へ2,703文字減った。
- 高色数の隣接ペアはpaletteとデコーダを重複して持たなくなり、全スクリプトの文字数上限・lossless品質は維持される。

## Constraints / Gotchas

- 512色を超える区間は候補にしない。現在のdelta index decoderはこの範囲の固定費とLua実行コストの釣り合いを基準にしている。
- packedの共有候補は内部自動再生の最大2フレームに限定する。外部フレーム番号では範囲外描画を避ける別の選択形式が必要である。
