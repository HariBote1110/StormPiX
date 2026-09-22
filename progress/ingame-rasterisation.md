# 実機ラスタライズ規則

## 決定

- `screendraw.md` と PhySim2 の `media/raster.js` を根拠に、線を 1/256 格子上の diamond-exit 規則へ移した。端点は含まず、方向・major axis により所有する角が異なる。
- 円は §3（D2/D3/E5-E7）の `clamp(floor(abs(r)/2),8,16)` 角形、塗り円は §4 の左上標本、塗り三角形と塗り矩形は左下標本を用いる。三角形の半開区間は PhySim2 と同じ `ceil(left) <= x < ceil(right)` とし、辺上で空になった区間を反転しない。
- 矩形塗りは B6/D7 の `ceil(x)..ceil(x+w)-1` と `floor(y)..floor(y+h)-1` を用い、負サイズを鏡映し、零幅・零高を空にする。
- PhySim2 `media/raster.js`（MIT, © Shannon-Toppo）から移植した線の比較は整数有理数のまま保持した。`media/pixelFont.js`（MIT, © Shannon-Toppo）の全 printable ASCII glyph、advance 5、line height 6、折返し・配置規則も移植した。
- 全 primitive の lit pixel は両 GPU で一致した実機観測に従い CERTAIN とする。互換性のため mask API は残す。

## 検証基盤

- `tests/ingame-raster.test.ts` は PhySim2 の 62 ページ fixture と同じカード Lua を実 Lua で実行し、幅・高さ・page 32 を与え、輝度しきい値 150 の規約で比較する。fixture root は `STORMPIX_PHYSIM_ROOT` で差替え可能である。
- 未測定なのは drawMap、回転モニター、非 ASCII 文字、シーン照明とトーンマッピングによるプラットフォーム依存の明るさであり、pixel coverage ではない。
