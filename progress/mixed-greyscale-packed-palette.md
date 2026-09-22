# mixed greyscale packed palette

## Decision

- delta packed形式のpaletteで、グレースケール色は `{r,r,r}` ではなく数値 `r` として保存する。
- paletteがグレースケールだけなら直接 `setColor(e,e,e)` を呼び、混在時だけ数値かRGB配列かを判定して復元する。

## Measurement

- `astral_opening` の高色数フレームは画素の大半と色種の約6〜7割がグレースケールだった。
- lossless出力は39,911文字から34,695文字へ5,216文字減った。全スクリプトは引き続き8,192文字以内、SSIM 1.0である。

## Constraints / Gotchas

- 色番号のdelta符号化は変更しない。paletteの表現だけを変え、デコーダで元のRGBを必ず復元する。
