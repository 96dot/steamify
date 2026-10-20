-- Binary-safe base64. Millennium's native string helpers stop at the first NUL byte,
-- which corrupts image data, so artwork bytes only ever pass through this module.

local bit = require("bit")
local band, bor, lshift, rshift = bit.band, bit.bor, bit.lshift, bit.rshift
local byte, char, concat = string.byte, string.char, table.concat

local ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local ENC, DEC = {}, {}
for i = 1, 64 do
    local c = ALPHABET:sub(i, i)
    ENC[i - 1] = c
    DEC[byte(c)] = i - 1
end

local M = {}

function M.encode(data)
    local out, n = {}, 0
    local len = #data
    for i = 1, len - 2, 3 do
        local a, b, c = byte(data, i, i + 2)
        local v = bor(lshift(a, 16), lshift(b, 8), c)
        n = n + 1
        out[n] = ENC[rshift(v, 18)] .. ENC[band(rshift(v, 12), 63)] .. ENC[band(rshift(v, 6), 63)] .. ENC[band(v, 63)]
    end
    local rest = len % 3
    if rest == 1 then
        local v = lshift(byte(data, len), 16)
        out[n + 1] = ENC[rshift(v, 18)] .. ENC[band(rshift(v, 12), 63)] .. "=="
    elseif rest == 2 then
        local a, b = byte(data, len - 1, len)
        local v = bor(lshift(a, 16), lshift(b, 8))
        out[n + 1] = ENC[rshift(v, 18)] .. ENC[band(rshift(v, 12), 63)] .. ENC[band(rshift(v, 6), 63)] .. "="
    end
    return concat(out)
end

function M.decode(text)
    text = text:gsub("[^%w%+/]", "")
    local out, n = {}, 0
    local len = #text
    for i = 1, len, 4 do
        local a, b, c, d = byte(text, i, i + 3)
        local v = lshift(DEC[a] or 0, 18) + lshift(DEC[b] or 0, 12) + lshift(DEC[c] or 0, 6) + (DEC[d] or 0)
        local bytes = (c and 1 or 0) + (d and 1 or 0) + 1
        n = n + 1
        if bytes == 3 then
            out[n] = char(rshift(v, 16), band(rshift(v, 8), 255), band(v, 255))
        elseif bytes == 2 then
            out[n] = char(rshift(v, 16), band(rshift(v, 8), 255))
        else
            out[n] = char(rshift(v, 16))
        end
    end
    return concat(out)
end

return M
