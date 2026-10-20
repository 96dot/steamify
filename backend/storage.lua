-- Persistent plugin state (links + settings) and backups of the user's own artwork.

local logger     = require("logger")
local millennium = require("millennium")
local fs         = require("fs")
local utils      = require("utils")
local cjson      = require("json")
local paths      = require("paths")
local base64     = require("base64")

local DEFAULT_SETTINGS = {
    rename = true,      -- rename the shortcut to the official store name
    artwork = true,     -- capsule, hero, logo, wide capsule
    icon = true,        -- official client icon
    info_panel = true,  -- store info + links on the game page
    auto_match = true,  -- link new shortcuts automatically when the name matches exactly
    wiki_fallback = true, -- use Wikipedia/Wikidata for games that aren't on Steam
    sgdb_key = "",      -- optional SteamGridDB API key for artwork of games that aren't on Steam
}

local function load_table(key)
    local v = millennium.config.get(key)
    if type(v) == "table" then return v end
    return {}
end

---@ffi
---@return string
function get_state()
    local settings = load_table("settings")
    for k, v in pairs(DEFAULT_SETTINGS) do
        if settings[k] == nil then settings[k] = v end
    end
    return cjson.encode({ links = load_table("links"), settings = settings })
end

---@ffi
---@param settings_json string
---@return boolean
function save_settings(settings_json)
    local ok, err = millennium.config.set("settings", cjson.decode(settings_json))
    if not ok then logger:error("save_settings failed: " .. tostring(err)) end
    return ok == true
end

---@ffi
--- Store (or replace) the link record for one shortcut.
---@param shortcut_appid number
---@param link_json string
---@return boolean
function save_link(shortcut_appid, link_json)
    local links = load_table("links")
    links[paths.idstr(shortcut_appid)] = cjson.decode(link_json)
    local ok, err = millennium.config.set("links", links)
    if not ok then logger:error("save_link failed: " .. tostring(err)) end
    return ok == true
end

---@ffi
---@param shortcut_appid number
---@return boolean
function delete_link(shortcut_appid)
    local links = load_table("links")
    links[paths.idstr(shortcut_appid)] = nil
    local ok = millennium.config.set("links", links)
    return ok == true
end

-- Grid file name patterns Steam uses for custom artwork, keyed by ELibraryAssetType.
local function grid_kind(name, id)
    local function is_img(ext) return ext == "png" or ext == "jpg" or ext == "jpeg" or ext == "webp" end
    local stem, ext = name:match("^(.+)%.(%w+)$")
    if not stem then return nil end
    ext = ext:lower()
    if stem == id .. "p" and is_img(ext) then return "capsule", 0 end
    if stem == id .. "_hero" and is_img(ext) then return "hero", 1 end
    if stem == id .. "_logo" and is_img(ext) then return "logo", 2 end
    if stem == id and is_img(ext) then return "header", 3 end
    if stem == id and ext == "json" then return "logo_position", nil end
    return nil
end

local function int32le(n)
    n = tonumber(n) % 4294967296
    local b = {}
    for i = 1, 4 do
        b[i] = string.char(n % 256)
        n = math.floor(n / 256)
    end
    return table.concat(b)
end

-- Reads the "icon" field of one shortcut from the binary shortcuts.vdf.
local function shortcut_icon(account_id, shortcut_appid)
    local vdf = paths.read_file(paths.shortcuts_vdf(account_id))
    if not vdf then return nil end
    local marker = "\2appid\0" .. int32le(shortcut_appid)
    local start = vdf:find(marker, 1, true)
    if not start then return nil end
    local next_entry = vdf:find("\2appid\0", start + #marker, true) or #vdf
    local icon_key = "\1icon\0"
    local s, e = vdf:find(icon_key, start, true)
    if not s or s > next_entry then return nil end
    local value_end = vdf:find("\0", e + 1, true)
    if not value_end then return nil end
    return vdf:sub(e + 1, value_end - 1)
end

---@ffi
--- Copy the shortcut's current artwork and icon path aside, once, before Steamify replaces them.
---@param account_id string
---@param shortcut_appid number
---@return string
function backup_artwork(account_id, shortcut_appid)
    local dir = paths.backup_dir(shortcut_appid)
    if fs.exists(dir .. "/meta.json") then
        return cjson.encode({ ok = true, created = false })
    end
    fs.create_directories(dir)
    local id = paths.idstr(shortcut_appid)
    local grid = paths.grid_dir(account_id)
    local copied = {}
    for _, entry in ipairs(fs.list(grid) or {}) do
        if entry.is_file and grid_kind(entry.name, id) then
            fs.copy(entry.path, dir .. "/" .. entry.name)
            copied[#copied + 1] = entry.name
        end
    end
    local meta = { icon = shortcut_icon(account_id, shortcut_appid) or "", files = copied, created = os.time() }
    paths.write_json(dir .. "/meta.json", meta)
    logger:info("Backed up " .. #copied .. " artwork file(s) for shortcut " .. id)
    return cjson.encode({ ok = true, created = true })
end

---@ffi
--- Return the backed-up artwork (base64) so the frontend can put it back through SteamClient.
---@param shortcut_appid number
---@return string
function read_backup(shortcut_appid)
    local dir = paths.backup_dir(shortcut_appid)
    local meta = paths.read_json(dir .. "/meta.json")
    if not meta then return cjson.encode({ ok = false, error = "no backup" }) end
    local id = paths.idstr(shortcut_appid)
    local out = { ok = true, icon = meta.icon, files = {} }
    for _, name in ipairs(meta.files or {}) do
        local kind, asset = grid_kind(name, id)
        local data = paths.read_file(dir .. "/" .. name)
        if data and kind == "logo_position" then
            out.logo_position = data
        elseif data and asset then
            local ext = name:match("%.(%w+)$"):lower()
            out.files[#out.files + 1] = {
                asset = asset,
                type = (ext == "png") and "png" or "jpg",
                data = base64.encode(data),
            }
        end
    end
    return cjson.encode(out)
end

---@ffi
---@param shortcut_appid number
---@return boolean
function delete_backup(shortcut_appid)
    fs.remove_all(paths.backup_dir(shortcut_appid))
    return true
end

---@ffi
--- Delete the icon Steamify saved for a shortcut (after the original was restored).
---@param account_id string
---@param shortcut_appid number
---@return boolean
function remove_icon(account_id, shortcut_appid)
    local base = paths.grid_dir(account_id) .. "/steamify_" .. paths.idstr(shortcut_appid) .. "_icon."
    for _, ext in ipairs({ "ico", "png", "jpg" }) do
        if fs.exists(base .. ext) then fs.remove(base .. ext) end
    end
    return true
end

---@ffi
--- Append a line to millennium/data/steamify/steamify.log (kept under 512 KB).
---@param message string
---@return boolean
function debug_log(message)
    local path = paths.data_dir() .. "/steamify.log"
    local size = fs.exists(path) and fs.file_size(path) or 0
    if size and size > 512 * 1024 then fs.remove(path) end
    utils.append_file(path, os.date("%Y-%m-%d %H:%M:%S ") .. message .. "\n")
    logger:info(message)
    return true
end
