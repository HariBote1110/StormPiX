# 進捗記録

- `fit-animation-encoding-selection.md` — fitアニメーションで通常符号化と列辞書／分割符号化をスクリプト数、SSIM、文字数の順で比較する決定
- `fit-animation-last-resort-splitting.md` — fitアニメーションの単一スクリプト探索を維持し、不可能な場合だけ選択済み描画操作を分割する決定
- `column-dictionary-boundaries.md` — 可変長列辞書の区切り除去で実資産40フレームを5,536文字へ短縮し、single-use inline化を不採用とした計測
- `ingame-rasterisation.md` — Stormworks 実機 pixel coverage 規則、PhySim2 由来のラスタライズ移植とfixture検証基盤
- `monitor-gamma.md` — 交換可能なモニターLUT、device target、符号化誤差とdevice errorの分離
- `run-token-dictionary.md` — 列パターン内の縦runを第2辞書化し、実資産40フレームを5,895文字へ圧縮
- `reference-stream-rle.md` — 列辞書の隣接参照を可逆RLE化し、実資産40フレームを6,958文字へ圧縮
- `repeated-pattern-dictionary.md` — 実資産の列反復を縦ラン辞書で共有し、losslessアニメーションを単一スクリプト化
- `fit-lossless-dominance.md` — fitが予算内のlossless単一スクリプト候補を優先する決定
- `phase5-lossless-scripts.md` — lossless既定、可逆スクリプト分割、矩形ストリーム圧縮、kamishibai比較
- `deterministic-work-budget.md` — 探索の壁時計依存を仕事量上限へ置換し、負荷下の決定性を回復
- `verification-base.md` — Lua往復検証、参照ラスタライズ意味論、確実性マスク、実アセット回帰の検証基盤
- `compare-kamishibai.md` — 実資産による storm-kamishibai 比較、gamma 差、lossless 再構成欠陥の実測
- `phase4-budget.md` — 予算最適化、品質単調性、輝度パレット、高色数差分packedの設計判断
- `phase3-animation.md` — 共有パレット、フレーム間差分、tick 再生の設計判断
- `phase2-optimiser.md` — Oklab量子化、文字数コスト被覆、3戦略emit、予算探索
- `phase1-foundation.md` — Phase 1コア基盤の描画・メトリクス・エミッタ設計判断
