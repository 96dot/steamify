-- Metadata for games that aren't on Steam: Wikidata (facts), Wikipedia (description and
-- cover) and, when the user has added an API key, SteamGridDB (library artwork).

local logger     = require("logger")
local millennium = require("millennium")
local utils      = require("utils")
local cjson      = require("json")
local paths      = require("paths")
local net        = require("net")

local present, get_json = net.present, net.get_json

local CACHE_TTL = 7 * 24 * 60 * 60
local SGDB_API  = "https://www.steamgriddb.com/api/v2"
local WIKI_API  = "https://en.wikipedia.org/w/api.php"

local P = {
    developer = "P178", publisher = "P123", date = "P577", genre = "P136", mode = "P404",
    platform = "P400", website = "P856", steam = "P1733", sgdb = "P6278", pcgw = "P6337", igdb = "P5794",
}

local MONTHS = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" }

local function sgdb_key()
    local settings = millennium.config.get("settings")
    local key = type(settings) == "table" and settings.sgdb_key or nil
    if type(key) == "string" and key:match("%S") then return (key:gsub("%s", "")) end
    return nil
end

local function normalize(s)
    return (s or ""):lower():gsub("[^%w]+", " "):gsub("^%s+", ""):gsub("%s+$", "")
end

-- Claim values for one property, skipping deprecated statements.
local function claims(entity, prop)
    local out = {}
    local list = entity.claims and entity.claims[prop]
    if type(list) ~= "table" then return out end
    for _, c in ipairs(list) do
        local dv = c.rank ~= "deprecated" and c.mainsnak and c.mainsnak.datavalue
        if type(dv) == "table" and present(dv.value) then out[#out + 1] = dv.value end
    end
    return out
end

local function item_ids(entity, prop)
    local out = {}
    for _, v in ipairs(claims(entity, prop)) do
        if type(v) == "table" and v.id then out[#out + 1] = v.id end
    end
    return out
end

local function first_string(entity, prop)
    local v = claims(entity, prop)[1]
    return type(v) == "string" and v or nil
end

-- An item's English label. Wikidata keeps many names only under "mul" (all languages).
local function label_of(entity)
    local l = type(entity) == "table" and entity.labels
    if type(l) ~= "table" then return nil end
    local v = (type(l.en) == "table" and l.en) or (type(l.mul) == "table" and l.mul)
    return v and v.value or nil
end

-- English labels for a list of Wikidata items, in one request per 50 ids.
local function labels(ids)
    local out, batch = {}, {}
    local function flush()
        if #batch == 0 then return end
        local url = "https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=en%7Cmul&format=json&ids="
            .. utils.url_encode(table.concat(batch, "|"))
        local data = get_json(url)
        if data and type(data.entities) == "table" then
            for id, e in pairs(data.entities) do
                out[id] = label_of(e)
            end
        end
        batch = {}
    end
    for _, id in ipairs(ids) do
        batch[#batch + 1] = id
        if #batch == 50 then flush() end
    end
    flush()
    return out
end

-- The earliest release date at the best precision Wikidata has, e.g. "Nov 11, 2005".
local function release_date(entity)
    local best, best_precision
    for _, v in ipairs(claims(entity, P.date)) do
        if type(v) == "table" and type(v.time) == "string" then
            local precision = tonumber(v.precision) or 9
            local t = v.time:gsub("^%+", "")
            if not best or precision > best_precision or (precision == best_precision and t < best) then
                best, best_precision = t, precision
            end
        end
    end
    if not best then return nil end
    local y, m, d = best:match("^(%d+)%-(%d+)%-(%d+)")
    y, m, d = tonumber(y), tonumber(m), tonumber(d)
    if not y then return nil end
    if best_precision >= 11 and m and m > 0 and d and d > 0 then return string.format("%s %d, %d", MONTHS[m], d, y) end
    if best_precision >= 10 and m and m > 0 then return string.format("%s %d", MONTHS[m], y) end
    return tostring(y)
end

-- The first sentences of a Wikipedia extract, about as long as a store short description.
local function short_description(text)
    if type(text) ~= "string" then return nil end
    text = text:gsub("%s+", " ")
    if #text <= 360 then return text end
    local out, pos = "", 1
    while true do
        local stop = text:find(". ", pos, true)
        local sentence = text:sub(pos, stop or #text)
        if out ~= "" and #out + #sentence > 360 then break end
        out = out .. sentence
        if not stop then break end
        pos = stop + 2
        out = out .. " "
    end
    return (out:gsub("%s+$", ""))
end

local function names_of(ids, map)
    local out = {}
    for _, id in ipairs(ids) do
        if map[id] then out[#out + 1] = map[id] end
    end
    return out
end

-- "single-player video game" -> "Single-player"
local function mode_name(label)
    label = label:gsub(" video games?$", ""):gsub(" game$", "")
    return label:sub(1, 1):upper() .. label:sub(2)
end

local function strip_tracking(url)
    return url and (url:gsub("%?utm_.*$", "")) or nil
end

local function sgdb_first(path, key)
    local data = get_json(SGDB_API .. path, { Authorization = "Bearer " .. key })
    if data and data.success and type(data.data) == "table" and type(data.data[1]) == "table" then
        return data.data[1]
    end
    return nil
end

-- Library artwork from SteamGridDB: the community's top-voted image of each kind.
local function sgdb_assets(out, game_id, name)
    local key = sgdb_key()
    if not key then return end
    out.sgdb = true

    if not game_id and name then
        local data = get_json(SGDB_API .. "/search/autocomplete/" .. utils.url_encode(name), { Authorization = "Bearer " .. key })
        local results = data and data.success and data.data
        if type(results) == "table" then
            for _, r in ipairs(results) do
                if normalize(r.name) == normalize(name) then game_id = r.id break end
            end
            if not game_id and results[1] then game_id = results[1].id end
        end
    end
    if not game_id then return end
    out.sgdb_id = tonumber(game_id)

    local id = tostring(game_id)
    local filters = "types=static&nsfw=false&humor=false"
    local capsule = sgdb_first("/grids/game/" .. id .. "?dimensions=600x900,342x482,660x930&" .. filters, key)
    local header  = sgdb_first("/grids/game/" .. id .. "?dimensions=920x430,460x215&" .. filters, key)
    local hero    = sgdb_first("/heroes/game/" .. id .. "?" .. filters, key)
    local logo    = sgdb_first("/logos/game/" .. id .. "?" .. filters, key)
    local icon    = sgdb_first("/icons/game/" .. id .. "?" .. filters, key)
    out.assets.capsule = capsule and capsule.url or nil
    out.assets.header  = header and header.url or nil
    out.assets.hero    = hero and hero.url or nil
    out.assets.logo    = logo and logo.url or nil
    out.assets.icon    = icon and icon.url or nil
end

local function fetch_wiki_data(qid)
    local out = { ok = false, id = qid, source = "wiki", appid = 0, assets = {}, links = {}, fetched = os.time() }

    local data, err = get_json("https://www.wikidata.org/wiki/Special:EntityData/" .. qid .. ".json")
    if not data or type(data.entities) ~= "table" then
        out.error = err or "Wikidata lookup failed"
        return out
    end
    -- Merged items redirect, so take whichever entity came back.
    local entity
    for _, e in pairs(data.entities) do entity = e break end
    if type(entity) ~= "table" then
        out.error = "Wikidata item not found"
        return out
    end

    out.name = label_of(entity)

    local devs, pubs = item_ids(entity, P.developer), item_ids(entity, P.publisher)
    local genres, modes, platforms = item_ids(entity, P.genre), item_ids(entity, P.mode), item_ids(entity, P.platform)
    local all = {}
    for _, list in ipairs({ devs, pubs, genres, modes, platforms }) do
        for _, id in ipairs(list) do all[#all + 1] = id end
    end
    local map = labels(all)
    out.developers = names_of(devs, map)
    out.publishers = names_of(pubs, map)
    out.genres     = names_of(genres, map)
    out.platforms  = names_of(platforms, map)
    out.features   = {}
    for _, label in ipairs(names_of(modes, map)) do out.features[#out.features + 1] = mode_name(label) end
    out.release_date = release_date(entity)
    out.website      = first_string(entity, P.website)
    out.steam_appid  = tonumber(first_string(entity, P.steam) or "")

    local enwiki = type(entity.sitelinks) == "table" and type(entity.sitelinks.enwiki) == "table" and entity.sitelinks.enwiki.title
    if enwiki then
        local title = enwiki:gsub(" ", "_")
        out.links[#out.links + 1] = { label = "Wikipedia", url = "https://en.wikipedia.org/wiki/" .. utils.url_encode(title) }
        local summary = get_json("https://en.wikipedia.org/api/rest_v1/page/summary/" .. utils.url_encode(title))
        if type(summary) == "table" then
            out.name = out.name or summary.title
            out.description = short_description(summary.extract)
            local img = summary.originalimage
            if type(img) == "table" and present(img.source) then
                local w, h = tonumber(img.width) or 0, tonumber(img.height) or 0
                -- Box art is portrait; a wide image is a screenshot that can serve as the hero.
                if h >= w * 1.2 then out.assets.capsule = strip_tracking(img.source)
                elseif w >= 1280 and w >= h * 1.6 then out.assets.hero = strip_tracking(img.source) end
                out.cover = strip_tracking(img.source)
            end
        end
    end

    local pcgw = first_string(entity, P.pcgw)
    if pcgw then out.links[#out.links + 1] = { label = "PCGamingWiki", url = "https://www.pcgamingwiki.com/wiki/" .. utils.url_encode(pcgw) } end
    local igdb = first_string(entity, P.igdb)
    if igdb then out.links[#out.links + 1] = { label = "IGDB", url = "https://www.igdb.com/games/" .. utils.url_encode(igdb) } end
    if out.website then out.links[#out.links + 1] = { label = "Official Site", url = out.website } end

    local wiki_assets = out.assets
    out.assets = {}
    local ok, sgdb_err = pcall(sgdb_assets, out, first_string(entity, P.sgdb), out.name)
    if not ok then logger:warn("SteamGridDB lookup failed for " .. qid .. ": " .. tostring(sgdb_err)) end
    for k, v in pairs(wiki_assets) do
        if not out.assets[k] then out.assets[k] = v end
    end
    if out.sgdb_id then
        out.links[#out.links + 1] = { label = "SteamGridDB", url = "https://www.steamgriddb.com/game/" .. tostring(out.sgdb_id) }
    end

    out.ok = out.name ~= nil
    return out
end

---@ffi
--- Search Wikipedia for a game that isn't on Steam.
---@param term string
---@return string
function search_wiki(term)
    local url = WIKI_API .. "?action=query&format=json&formatversion=2&generator=search&gsrlimit=10"
        .. "&prop=pageprops%7Cdescription%7Cpageimages&ppprop=wikibase_item&piprop=thumbnail&pithumbsize=200&pilicense=any"
        .. "&gsrsearch=" .. utils.url_encode(term)
    local data, err = get_json(url)
    if not data then return cjson.encode({ ok = false, error = err }) end
    local pages = data.query and data.query.pages
    local items = {}
    if type(pages) == "table" then
        table.sort(pages, function(a, b) return (a.index or 0) < (b.index or 0) end)
        for _, p in ipairs(pages) do
            local qid = type(p.pageprops) == "table" and p.pageprops.wikibase_item
            if qid then
                items[#items + 1] = {
                    id = qid,
                    name = p.title,
                    type = present(p.description) and p.description or nil,
                    image = type(p.thumbnail) == "table" and strip_tracking(p.thumbnail.source) or nil,
                }
            end
        end
    end
    return cjson.encode({ ok = true, items = items })
end

---@ffi
--- Metadata and artwork for a Wikidata item (cached for a week).
---@param qid string
---@param refresh boolean
---@return string
function get_wiki_data(qid, refresh)
    qid = tostring(qid or "")
    if not qid:match("^Q%d+$") then return cjson.encode({ ok = false, error = "invalid Wikidata id" }) end

    local cache = paths.read_json(paths.cache_file()) or {}
    local cached = cache[qid]
    local fresh = type(cached) == "table" and cached.ok and (os.time() - (cached.fetched or 0)) < CACHE_TTL
    -- Refetch once a SteamGridDB key is added so the artwork shows up.
    if fresh and not refresh and (cached.sgdb or not sgdb_key()) then return cjson.encode(cached) end

    local ok, result = pcall(fetch_wiki_data, qid)
    if not ok then
        logger:error("get_wiki_data(" .. qid .. ") failed: " .. tostring(result))
        if type(cached) == "table" then return cjson.encode(cached) end
        return cjson.encode({ ok = false, error = tostring(result) })
    end
    if result.ok then
        cache[qid] = result
        paths.write_json(paths.cache_file(), cache)
    end
    return cjson.encode(result)
end
