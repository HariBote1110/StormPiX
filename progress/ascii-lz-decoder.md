# ASCII LZ復号器

## Decision

- LuaのBase64復号をalphabet文字列の検索ではなく、ASCII値の区間計算に置換する。

## Measurement

- `astral_opening` は9,076文字から8,954文字へ122文字減った。

## Constraints / Gotchas

- `/` と `+` は英数字の区間外なので、明示的に63と62へ対応付ける。
- 長距離一致の距離・長さは、文字列検索版とASCII版で下位桁の補正が異なる。Lua往復テストで確認する。
