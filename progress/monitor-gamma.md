# モニターガンマ補正

## Decision

- `ConvertOptions.gamma` は既定`false`とした。`true`ではsourceをLUTの到達可能な表示色へ最近傍写像したdevice targetを変換対象にする。
- emitted `screen.setColor` 値はdevice targetを表示するLUT入力値であり、`result.rendered`とmetricsはLUTを通過した表示値で評価する。したがってlossless SSIM 1は符号化誤差が0であることだけを表す。
- sourceとdevice targetの差は`ConvertStats.deviceMaxAbsChannelDeviation`、`deviceMeanAbsChannelDeviation`へ分離した。到達不可能な表示色によるdevice errorをSSIMへ混ぜない。

## Provenance

- LUTはstorm-kamishibaiの`src/Lut.ts`にあるOssan3作成・Steam guide 2569574227のcommunity-derived tableを転載したもの。
- この単一のcommunity sourceは本プロジェクトでは独自検証していない。`src/core/gamma.ts`の`MONITOR_DISPLAY_LUT`だけを差し替えればよい。

## Measurement

- 実資産40フレームではgamma-onが5,491文字、gamma-offが5,895文字だった。暗部のmany-to-one写像で色が併合されるため404文字減った。
- 実資産のdevice errorは最大9、平均1.336719 channel valueだった。符号化SSIMは1.000000。

## Constraints / Gotchas

- LUTの方向は`setColor(input) -> displayed value`である。逆向きに使うと内部評価だけ自己整合しても実機表示が誤るため、Lua往復後に表示LUTを通すテストを維持する。
- gamma-offの出力は既存とバイト単位で同一でなければならない。
