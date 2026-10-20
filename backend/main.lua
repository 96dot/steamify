local logger     = require("logger")
local millennium = require("millennium")

require("store")
require("wiki")
require("storage")

local function on_load()
    logger:info("Steamify loaded (Millennium " .. millennium.version() .. ")")
    millennium.ready()
end

local function on_unload()
    logger:info("Steamify unloaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
    on_frontend_loaded = function() end,
}
