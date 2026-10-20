-- HTTP helpers shared by the metadata sources.

local http   = require("http")
local cjson  = require("json")
local base64 = require("base64")
local paths  = require("paths")

local M = {}

M.UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Steamify/1.0"

function M.present(v)
    return v ~= nil and v ~= cjson.null
end

function M.get(url, headers)
    local res, err = http.get(url, { timeout = 20, user_agent = M.UA, headers = headers })
    if not res then return nil, tostring(err) end
    if res.status ~= 200 then return nil, "HTTP " .. tostring(res.status) end
    return res
end

function M.get_json(url, headers)
    local res, err = M.get(url, headers)
    if not res then return nil, err end
    local ok, data = pcall(cjson.decode, res.body)
    if not ok then return nil, "invalid JSON from " .. url end
    return data
end

-- The http module cuts response bodies at the first NUL byte, so images are downloaded
-- straight to a file with Windows' URLDownloadToFile instead.
local urlmon
local function download_to_file(url, path)
    local ffi = require("ffi")
    if not urlmon then
        ffi.cdef([[int URLDownloadToFileA(void *caller, const char *url, const char *file, unsigned long reserved, void *callback);]])
        urlmon = ffi.load("urlmon")
    end
    local hr = urlmon.URLDownloadToFileA(nil, url, path, 0, nil)
    return hr == 0, string.format("URLDownloadToFile failed (0x%08x)", hr % 0x100000000)
end

local function image_type(data, url)
    if data:sub(1, 8) == "\137PNG\r\n\26\n" then return "png" end
    if data:sub(1, 4) == "\0\0\1\0" then return "ico" end
    if data:sub(1, 3) == "\255\216\255" then return "jpg" end
    local ext = url:match("%.(%a+)$")
    return ext and ext:lower() or "jpg"
end

-- Downloads an image for hosts that don't allow cross-origin fetches from the frontend.
function M.get_image(url)
    local tmp = paths.data_dir() .. string.format("/download-%d-%d.tmp", os.time(), math.random(1, 1e9))
    local ok, err = download_to_file(url, tmp)
    local data = ok and paths.read_file(tmp) or nil
    os.remove(tmp)
    if not data or #data == 0 then return { ok = false, error = ok and "empty download" or err } end
    return { ok = true, type = image_type(data, url), data = base64.encode(data) }
end

return M
