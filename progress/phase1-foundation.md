# Phase 1コア基盤の設計判断

## Decision

- 描画命令の判別子は `type` とし、Stormworksの呼び出し名に合わせて `setColour`、`rectF`、`rect`、`line` の4種を持つ。
- ラスタライザはRGBAの不透明キャンバス（初期値は黒＋アルファ255）を使い、命令を順番に実行する。SSIMは11x11 Gaussian窓、Rec. 709 luma、PSNRはRGB 3チャンネルで計算する。
- Phase 1の直接Luaエミッタは完全な `onDraw` 関数を実測し、`costOf` は同じエミッタの文字列長を返す。`table` と `packed` は推測実装を避けて `NotImplementedError` にする。
- ベンチマークはバイナリ資産を持たず、4種類の合成Bitmapから行内同色ランを生成して、文字数・SSIM・PSNR・経過時間を表形式で出力する。

## Alternatives considered

- SSIMのグローバル平均は局所的な欠陥を捉えられないため採用しなかった。
- 未実装戦略のコスト推定は不変条件6を壊すため採用しなかった。

## Constraints / Gotchas

- Nodeのベンチ実行ではTypeScriptの実行時拡張子解決が必要なため、コア内部のimportには `.ts` 拡張子を付け、`allowImportingTsExtensions` を有効にしている。
