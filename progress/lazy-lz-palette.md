# 遅延LZパレット復号

## Decision

- LZ palette配列をLua起動時に展開せず、描画中に色が変わる場合だけpalette文字列から直接復号する。

## Measurement

- `astral_opening` は8,222文字から8,142文字へ80文字減った。
- 30フレームを単一Lua・lossless・8,192文字以内で保持できる。

## Constraints / Gotchas

- palette復号は色が切り替わるたびに実行される。文字数を優先する方式なので、実機での描画時間も確認対象とする。
