-- StormPiX モニターガンマ校正パターン
--
-- 目的: screen.setColor(i) が実機で実際に表示される明るさを確かめる。
-- 使い方: 3x3 (96x96) 以上のモニターに接続したマイコンへ貼り付け、画面を撮影する。
--
-- 読み方:
--   中央のディザ帯は黒と白の市松模様で、離れて見ると両者の平均の明るさになる。
--   この帯と同じ明るさに見えるパッチの番号が答え。
--     16 か 32 に見える  -> LUT は正しい (setColor は大きく持ち上がる)
--     128 に見える       -> LUT は誤り  (setColor がほぼそのまま表示される)
--
-- 各パッチの下の数字が setColor に渡した値。
local S = screen
local V = {0, 1, 2, 4, 8, 16, 32, 64, 96, 128, 192, 255}

function onDraw()
	local W, H = S.getWidth(), S.getHeight()
	S.setColor(0, 0, 0)
	S.drawClear()

	local cols = 6
	local cw = math.floor(W / cols)
	local ph = math.floor((H - 26) / 4)
	if ph < 6 then ph = 6 end

	-- 上段 6 パッチ (V[1..6]) と下段 6 パッチ (V[7..12])
	for row = 0, 1 do
		local top = row * (ph + 8)
		for c = 0, cols - 1 do
			local v = V[row * cols + c + 1]
			S.setColor(v, v, v)
			S.drawRectF(c * cw, top, cw - 1, ph)
			S.setColor(160, 160, 160)
			S.drawText(c * cw + 1, top + ph + 1, tostring(v))
		end
	end

	-- 中央: 黒白の市松ディザ帯。離れて見ると両者の平均の明るさになる。
	local dy = 2 * (ph + 8) + 2
	local dh = H - dy - 8
	if dh > 0 then
		for y = dy, dy + dh - 1 do
			for x = 0, W - 1 do
				if (x + y) % 2 == 0 then
					S.setColor(255, 255, 255)
				else
					S.setColor(0, 0, 0)
				end
				S.drawRectF(x, y, 1, 1)
			end
		end
		S.setColor(0, 0, 0)
		S.drawRectF(0, dy + dh, W, 8)
		S.setColor(200, 200, 200)
		S.drawText(1, dy + dh + 1, "DITHER =?")
	end
end
