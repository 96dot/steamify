import type { GameData, GameRef, Link, SearchItem, Settings } from './types';

// The Lua backend returns JSON strings, which Millennium's IPC may already have decoded.
// Lua can't tell an empty array from an empty object, hence asArray().
const parse = <T,>(raw: unknown): T => (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
export const asArray = <T,>(v: T[] | Record<string, never> | undefined | null): T[] => (Array.isArray(v) ? v : []);

interface Result {
	ok: boolean;
	error?: string;
}

export interface ImageResult extends Result {
	type?: string;
	data?: string;
}

export interface BackupResult extends Result {
	icon?: string;
	logo_position?: string;
	files?: { asset: number; type: string; data: string }[];
}

export const api = {
	search: async (term: string) => parse<Result & { items?: SearchItem[] }>(await backend.search_store(term)),
	searchWiki: async (term: string) => parse<Result & { items?: SearchItem[] }>(await backend.search_wiki(term)),
	gameData: async (ref: GameRef, refresh = false) =>
		parse<GameData>(typeof ref === 'string' ? await backend.get_wiki_data(ref, refresh) : await backend.get_game_data(ref, refresh)),
	cachedGameData: async (refs: GameRef[]) => parse<Record<string, GameData>>(await backend.get_cached_game_data(JSON.stringify(refs))),
	saveIcon: async (accountId: string, shortcutAppId: number, image: ImageResult) =>
		parse<Result & { path?: string }>(await backend.save_icon(accountId, shortcutAppId, image.data ?? '', image.type ?? 'ico')),

	state: async () => parse<{ links: Record<string, Link>; settings: Settings }>(await backend.get_state()),
	saveSettings: (settings: Settings) => backend.save_settings(JSON.stringify(settings)),
	saveLink: (shortcutAppId: number, link: Link) => backend.save_link(shortcutAppId, JSON.stringify(link)),
	deleteLink: (shortcutAppId: number) => backend.delete_link(shortcutAppId),

	backup: async (accountId: string, shortcutAppId: number) => parse<Result>(await backend.backup_artwork(accountId, shortcutAppId)),
	readBackup: async (shortcutAppId: number) => parse<BackupResult>(await backend.read_backup(shortcutAppId)),
	deleteBackup: (shortcutAppId: number) => backend.delete_backup(shortcutAppId),
	removeIcon: (accountId: string, shortcutAppId: number) => backend.remove_icon(accountId, shortcutAppId),
};

function imageType(url: string, contentType: string): string {
	const ct = contentType.toLowerCase();
	if (ct.includes('png')) return 'png';
	if (ct.includes('icon')) return 'ico';
	if (ct.includes('jp')) return 'jpg';
	const ext = /\.(\w+)(?:\?|$)/.exec(url)?.[1]?.toLowerCase();
	return ext === 'jpeg' || !ext ? 'jpg' : ext;
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

/**
 * Download an image as base64. Steam's and Wikimedia's CDNs allow cross-origin fetches;
 * for hosts that don't, the backend downloads it instead.
 */
export async function downloadImage(url: string): Promise<ImageResult> {
	try {
		const res = await fetch(url);
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
		const bytes = new Uint8Array(await res.arrayBuffer());
		if (!bytes.length) return { ok: false, error: 'empty response' };
		return { ok: true, type: imageType(url, res.headers.get('content-type') ?? ''), data: toBase64(bytes) };
	} catch (e) {
		// A TypeError here is usually a blocked cross-origin request.
		const viaBackend = parse<ImageResult>(await backend.fetch_image(url));
		return viaBackend.ok ? viaBackend : { ok: false, error: `${e} / ${viaBackend.error}` };
	}
}
