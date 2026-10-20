export type LinkStatus = 'linked' | 'nomatch' | 'ignored';

/** A Steam appid, or a Wikidata item id ("Q123") for games that aren't on Steam. */
export type GameRef = number | string;

/** What Steamify remembers about one non-Steam shortcut. */
export interface Link {
	status: LinkStatus;
	/** 'wiki' when linked to Wikidata/Wikipedia instead of a Steam store page. */
	source?: 'steam' | 'wiki';
	steamAppId?: number;
	wikiId?: string;
	/** Name of the linked game (store or Wikipedia title). */
	steamName?: string;
	/** Set once a 'nomatch' shortcut has also been searched on Wikipedia. */
	wikiChecked?: boolean;
	/** The shortcut's name before Steamify renamed it, restored on unlink. */
	originalName?: string;
	updatedAt: number;
}

export interface Settings {
	rename: boolean;
	artwork: boolean;
	icon: boolean;
	info_panel: boolean;
	auto_match: boolean;
	wiki_fallback: boolean;
	sgdb_key: string;
}

export interface GameData {
	ok: boolean;
	error?: string;
	source?: 'steam' | 'wiki';
	appid: number;
	/** Wikidata id for source 'wiki'. */
	id?: string;
	name?: string;
	type?: string;
	description?: string;
	developers?: string[];
	publishers?: string[];
	genres?: string[];
	release_date?: string;
	metacritic?: number;
	website?: string;
	categories?: { id: number; description: string }[];
	/** Game modes from Wikidata, e.g. "Single-player". */
	features?: string[];
	platforms?: string[];
	links?: { label: string; url: string }[];
	assets: {
		capsule?: string;
		hero?: string;
		logo?: string;
		header?: string;
		header_fallback?: string;
		icon?: string;
	};
	logo_position?: { pinned_position: string; width_pct: string | number; height_pct: string | number };
}

export interface SearchItem {
	id: GameRef;
	name: string;
	type?: string;
	image?: string;
}

/** The subset of Steam's app overview object Steamify reads. */
export interface AppOverview {
	appid: number;
	display_name: string;
	app_type: number;
}
