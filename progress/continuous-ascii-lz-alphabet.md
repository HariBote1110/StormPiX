# 連続ASCII LZ alphabet

## 決定

- LZ専用alphabetをASCII 48〜90と96〜116の連続範囲で構成し、Lua側の復号を二分岐の減算だけにする。

## 計測

- `astral_opening` は8,142文字から8,111文字へ、31文字減った。

## 制約

- `!` は長距離一致トークン用なのでalphabetに含めない。
- Lua文字列リテラルを壊す `"` と `\\` はalphabetに含めない。
