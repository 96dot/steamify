-- Steam store lookups: search, per-app metadata and artwork downloads.
-- Every RPC returns a JSON string; the frontend parses it.

local logger = require("logger")
local utils  = require("utils")
local cjson  = require("json")
local paths  = require("paths")
local base64 = require("base64")
local net    = require("net")

-- Encode empty Lua tables as [] so list fields stay arrays for the frontend.
pcall(cjson.encode_empty_table_as_object, false)

local ASSET_CDN  = "https://shared.steamstatic.com/store_item_assets/steam/apps/"
local ICON_CDN   = "https://shared.steamstatic.com/community_assets/images/apps/"
local CACHE_TTL  = 7 * 24 * 60 * 60

local present, get_json = net.present, net.get_json

local function names(list, field)
    local out = {}
    if type(list) ~= "table" then return out end
    for _, item in ipairs(list) do
        local v = field and item[field] or item
        if present(v) then out[#out + 1] = v end
    end
    return out
end

-- Picks the English variant of a library_assets_full image map, else any language.
local function pick_lang(images)
    if type(images) ~= "table" then return nil end
    if present(images.english) then return images.english end
    for _, v in pairs(images) do
        if type(v) == "string" then return v end
    end
    return nil
end

local function asset_url(appid, file)
    if not file then return nil end
    return ASSET_CDN .. appid .. "/" .. file
end

-- library_assets_full (PICS appinfo, mirrored by api.steamcmd.net) has the exact hashed
-- paths the Steam library itself uses, plus the official logo position.
local function assets_from_appinfo(appid, out)
    local info = get_json("https://api.steamcmd.net/v1/info/" .. appid)
    local app = info and present(info.data) and info.data[tostring(appid)]
    local common = app and app.common
    if type(common) ~= "table" then return end

    if not out.name and present(common.name) then out.name = common.name end
    if present(common.clienticon) then
        out.assets.icon = ICON_CDN .. appid .. "/" .. common.clienticon .. ".ico"
    end

    local full = common.library_assets_full
    if type(full) == "table" then
        local function img(key, prefer2x)
            local entry = full[key]
            if type(entry) ~= "table" then return nil end
            local file = (prefer2x and pick_lang(entry.image2x)) or pick_lang(entry.image)
            return asset_url(appid, file)
        end
        out.assets.capsule = img("library_capsule", true)
        out.assets.hero    = img("library_hero", false)
        out.assets.logo    = img("library_logo", true)
        out.assets.header  = img("library_header", true)
        if type(full.library_logo) == "table" and type(full.library_logo.logo_position) == "table" then
            out.logo_position = full.library_logo.logo_position
        end
    end

    -- Older apps only list languages under library_assets and use the unhashed file names.
    local legacy = common.library_assets
    if type(legacy) == "table" then
        if not out.logo_position and type(legacy.logo_position) == "table" then
            out.logo_position = legacy.logo_position
        end
        if not out.assets.capsule and present(legacy.library_capsule) then
            out.assets.capsule = asset_url(appid, "library_600x900_2x.jpg")
        end
        if not out.assets.hero and present(legacy.library_hero) then
            out.assets.hero = asset_url(appid, "library_hero.jpg")
        end
        if not out.assets.logo and present(legacy.library_logo) then
            out.assets.logo = asset_url(appid, "logo.png")
        end
    end
end

-- Fallback when the appinfo mirror is unavailable: the store's own item API.
local function assets_from_store(appid, out)
    local input = cjson.encode({
        ids = { { appid = appid } },
        context = { language = "english", country_code = "US" },
        data_request = { include_assets = true },
    })
    local data = get_json("https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=" .. utils.url_encode(input))
    local item = data and data.response and type(data.response.store_items) == "table" and data.response.store_items[1]
    local a = item and item.assets
    if type(a) ~= "table" or not present(a.asset_url_format) then return end

    local function fmt(file)
        if not present(file) then return nil end
        return "https://shared.steamstatic.com/store_item_assets/" .. a.asset_url_format:gsub("%${FILENAME}", file)
    end
    out.assets.capsule = out.assets.capsule or fmt(a.library_capsule_2x) or fmt(a.library_capsule)
    out.assets.hero    = out.assets.hero or fmt(a.library_hero)
    out.assets.header  = out.assets.header or fmt(a.header)
    if not out.assets.icon and present(a.community_icon) then
        out.assets.icon = ICON_CDN .. appid .. "/" .. a.community_icon .. ".jpg"
    end
end

local function fetch_game_data(appid)
    local key = tostring(appid)
    local out = { appid = appid, assets = {}, fetched = os.time() }

    local details = get_json("https://store.steampowered.com/api/appdetails?appids=" .. appid .. "&l=english&cc=US")
    local d = details and details[key]
    if d and d.success == true and type(d.data) == "table" then
        local ad = d.data
        out.name        = ad.name
        out.type        = ad.type
        out.description = present(ad.short_description) and ad.short_description or nil
        out.developers  = names(ad.developers)
        out.publishers  = names(ad.publishers)
        out.genres      = names(ad.genres, "description")
        out.website     = present(ad.website) and ad.website or nil
        if type(ad.release_date) == "table" and present(ad.release_date.date) then
            out.release_date = ad.release_date.date
        end
        if type(ad.metacritic) == "table" and present(ad.metacritic.score) then
            out.metacritic = ad.metacritic.score
        end
        out.categories = {}
        if type(ad.categories) == "table" then
            for _, c in ipairs(ad.categories) do
                out.categories[#out.categories + 1] = { id = c.id, description = c.description }
            end
        end
        if present(ad.header_image) then out.assets.header_fallback = ad.header_image end
    end

    local ok, err = pcall(assets_from_appinfo, appid, out)
    if not ok then logger:warn("appinfo lookup failed for " .. key .. ": " .. tostring(err)) end
    if not out.assets.capsule or not out.assets.hero then
        ok, err = pcall(assets_from_store, appid, out)
        if not ok then logger:warn("store asset lookup failed for " .. key .. ": " .. tostring(err)) end
    end

    out.assets.capsule = out.assets.capsule or asset_url(appid, "library_600x900_2x.jpg")
    out.assets.hero    = out.assets.hero or asset_url(appid, "library_hero.jpg")
    out.assets.logo    = out.assets.logo or asset_url(appid, "logo.png")
    out.assets.header  = out.assets.header or out.assets.header_fallback or asset_url(appid, "header.jpg")

    out.ok = out.name ~= nil
    return out
end

---@ffi
--- Search the Steam store by name.
---@param term string
---@return string
function search_store(term)
    local url = "https://store.steampowered.com/api/storesearch/?cc=US&l=english&term=" .. utils.url_encode(term)
    local data, err = get_json(url)
    if not data then return cjson.encode({ ok = false, error = err }) end
    local items = {}
    if type(data.items) == "table" then
        for _, it in ipairs(data.items) do
            items[#items + 1] = { id = it.id, name = it.name, type = it.type, image = it.tiny_image }
        end
    end
    return cjson.encode({ ok = true, items = items })
end

---@ffi
--- Store metadata + library artwork URLs for a Steam app (cached for a week).
---@param appid number
---@param refresh boolean
---@return string
function get_game_data(appid, refresh)
    appid = math.floor(tonumber(appid) or 0)
    if appid <= 0 then return cjson.encode({ ok = false, error = "invalid appid" }) end

    local cache = paths.read_json(paths.cache_file()) or {}
    local key = tostring(appid)
    local cached = cache[key]
    if not refresh and type(cached) == "table" and cached.ok and (os.time() - (cached.fetched or 0)) < CACHE_TTL then
        return cjson.encode(cached)
    end

    local ok, result = pcall(fetch_game_data, appid)
    if not ok then
        logger:error("get_game_data(" .. key .. ") failed: " .. tostring(result))
        if type(cached) == "table" then return cjson.encode(cached) end
        return cjson.encode({ ok = false, error = tostring(result) })
    end
    if result.ok then
        cache[key] = result
        paths.write_json(paths.cache_file(), cache)
    end
    return cjson.encode(result)
end

---@ffi
--- Cached metadata for several Steam apps / Wikidata items at once, without network access.
---@param appids_json string
---@return string
function get_cached_game_data(appids_json)
    local ids = cjson.decode(appids_json)
    local cache = paths.read_json(paths.cache_file()) or {}
    local out = {}
    for _, id in ipairs(ids) do
        -- Steam appids are numbers, Wikidata ids are strings like "Q42".
        local key = type(id) == "number" and paths.idstr(id) or tostring(id)
        local entry = cache[key]
        if type(entry) == "table" then out[key] = entry end
    end
    return cjson.encode(out)
end

---@ffi
--- Write an icon (downloaded by the frontend) into the user's grid folder and return its path.
---@param account_id string
---@param shortcut_appid number
---@param data_base64 string
---@param ext string
---@return string
function save_icon(account_id, shortcut_appid, data_base64, ext)
    ext = (ext or ""):lower()
    if ext ~= "ico" and ext ~= "png" and ext ~= "jpg" then ext = "ico" end
    local path = paths.grid_dir(account_id) .. "/steamify_" .. paths.idstr(shortcut_appid) .. "_icon." .. ext
    local ok, err = paths.write_file(path, base64.decode(data_base64))
    if not ok then return cjson.encode({ ok = false, error = tostring(err) }) end
    return cjson.encode({ ok = true, path = (path:gsub("/", "\\")) })
end

---@ffi
--- Download an image in the backend, for image hosts that block cross-origin fetches.
---@param url string
---@return string
function fetch_image(url)
    if type(url) ~= "string" or not url:match("^https://") then
        return cjson.encode({ ok = false, error = "invalid url" })
    end
    local ok, result = pcall(net.get_image, url)
    if not ok then return cjson.encode({ ok = false, error = tostring(result) }) end
    return cjson.encode(result)
end
