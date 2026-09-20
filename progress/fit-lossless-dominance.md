# fitとlossless候補の支配関係

## 問題

Phase 5でlosslessを既定にした後も、明示的な`mode: 'fit'`は従来の品質探索だけを実行していた。そのため、losslessの単一スクリプトが予算内に収まるケースで、fitがより長く、しかも同じか低いSSIMの結果を返していた。

## 決定

fit開始時に、同じ入力・palette・emit strategy設定でlossless単一スクリプト候補を生成する。その候補がbudget以内なら、そのままfit結果として返す。lossless単一スクリプトが収まらない場合だけ、従来の仕事量制限付き品質探索へ戻る。

これにより、lossless候補が達成するSSIM 1をfitが下回ることはなく、同じ品質なら文字数も増えない。40フレーム実アセットのようにlossless単一スクリプトが8192文字を超える場合は、従来fitの品質・文字数トレードオフを維持する。

## 検証

8x8の複数アニメーションfixtureと500/1000/8192 budgetで、lossless単一スクリプトが収まる場合に`fit.charCount <= lossless.charCount`かつ`fit.ssim >= lossless.ssim`をテストする。実アセットではfitが4/8/16/24フレームで587/1205/3539/5875文字、SSIM 1.000000となり、40フレームは7709文字・SSIM 0.402426のまま残る。
