-- Filesystem locations and small JSON file helpers shared by the backend modules.

local millennium = require("millennium")
local fs         = require("fs")
local cjson      = require("json")

local M = {}

-- Appids of non-Steam shortcuts exceed 2^31, so never format them with %d.
function M.idstr(n)
    return string.format("%.0f", tonumber(n) or 0)
end

local function steam_path()
    return (millennium.steam_path():gsub("\\", "/"))
end

function M.data_dir()
    local dir = steam_path() .. "/millennium/data/steamify"
    fs.create_directories(dir)
    return dir
end

function M.cache_file()
    return M.data_dir() .. "/store-cache.json"
end

function M.backup_dir(shortcut_appid)
    return M.data_dir() .. "/backup/" .. M.idstr(shortcut_appid)
end

-- account_id is the 32-bit SteamID3 account number (the userdata folder name).
function M.grid_dir(account_id)
    local dir = steam_path() .. "/userdata/" .. tostring(account_id) .. "/config/grid"
    fs.create_directories(dir)
    return dir
end

function M.shortcuts_vdf(account_id)
    return steam_path() .. "/userdata/" .. tostring(account_id) .. "/config/shortcuts.vdf"
end

function M.read_file(path)
    local f = io.open(path, "rb")
    if not f then return nil end
    local data = f:read("*a")
    f:close()
    return data
end

function M.write_file(path, data)
    local f, err = io.open(path, "wb")
    if not f then return false, err end
    f:write(data)
    f:close()
    return true
end

function M.read_json(path)
    local raw = M.read_file(path)
    if not raw or raw == "" then return nil end
    local ok, data = pcall(cjson.decode, raw)
    if ok and type(data) == "table" then return data end
    return nil
end

function M.write_json(path, value)
    return M.write_file(path, cjson.encode(value))
end

return M
