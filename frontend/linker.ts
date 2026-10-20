import { api, asArray, downloadImage } from './api';
import { confidentMatches, matchScore } from './matching';
import { Apps, Asset, accountId, overview, shortcuts } from './steam';
import { getState, setBusy, setState } from './store';
import type { GameData, GameRef, Link, Settings } from './types';

import { log } from './log';

/** The game a link points at: a Steam appid, or a Wikidata id for games that aren't on Steam. */
export function linkRef(link: Link | undefined): GameRef | undefined {
	if (link?.status !== 'linked') return undefined;
	return link.source === 'wiki' ? link.wikiId : link.steamAppId;
}

export async function loadState() {
	const { links, settings } = await api.state();
	const refs = Object.values(links)
		.map(linkRef)
		.filter((r): r is GameRef => r !== undefined);
	const gameData = refs.length ? await api.cachedGameData(refs) : {};
	setState({ links: Array.isArray(links) ? {} : links, settings, gameData: Array.isArray(gameData) ? {} : gameData, ready: true });

	// Refetch anything missing from the cache (cleared, or written by an older version).
	for (const ref of refs) {
		if (getState().gameData[ref]) continue;
		api.gameData(ref)
			.then((data) => data.ok && setState({ gameData: { ...getState().gameData, [ref]: data } }))
			.catch((e) => log('could not load data for', ref, e));
	}
}

export async function updateSettings(patch: Partial<Settings>) {
	const settings = { ...getState().settings, ...patch };
	setState({ settings });
	await api.saveSettings(settings);
}

// Steam updates a shortcut's display name a moment after SetShortcutName; re-render then.
const rerenderSoon = () => setTimeout(() => setState({}), 1500);

async function storeLink(shortcutAppId: number, link: Link | null) {
	const links = { ...getState().links };
	if (link) links[shortcutAppId] = link;
	else delete links[shortcutAppId];
	setState({ links });
	if (link) await api.saveLink(shortcutAppId, link);
	else await api.deleteLink(shortcutAppId);
}

async function setArtwork(shortcutAppId: number, url: string | undefined, asset: number, fallbackUrl?: string) {
	if (!url) return false;
	let img = await downloadImage(url);
	if (!img.ok && fallbackUrl) img = await downloadImage(fallbackUrl);
	if (!img.ok || !img.data) {
		log('artwork download failed', url, img.error);
		return false;
	}
	await Apps().SetCustomArtworkForApp(shortcutAppId, img.data, img.type === 'png' ? 'png' : 'jpg', asset);
	return true;
}

/**
 * Link a shortcut to a game and copy its name, artwork and icon onto it.
 * `ref` is a Steam appid, or a Wikidata id for games that aren't on Steam.
 */
export async function applyLink(shortcutAppId: number, ref: GameRef, refresh = false): Promise<GameData> {
	const { settings, links } = getState();
	const shortcut = overview(shortcutAppId);
	if (!shortcut) throw new Error('Shortcut not found');
	const wiki = typeof ref === 'string';

	setBusy(shortcutAppId, wiki ? 'Fetching Wikipedia data…' : 'Fetching store data…');
	try {
		const data = await api.gameData(ref, refresh);
		if (!data.ok || !data.name) throw new Error(data.error || (wiki ? `Wikidata item ${ref} was not found` : `Steam app ${ref} was not found on the store`));
		setState({ gameData: { ...getState().gameData, [ref]: data } });

		const account = accountId();
		if (settings.artwork || settings.icon) await api.backup(account, shortcutAppId);

		if (settings.artwork) {
			setBusy(shortcutAppId, 'Downloading artwork…');
			await setArtwork(shortcutAppId, data.assets.capsule, Asset.Capsule);
			await setArtwork(shortcutAppId, data.assets.hero, Asset.Hero);
			await setArtwork(shortcutAppId, data.assets.header, Asset.Header, data.assets.header_fallback);
			if (await setArtwork(shortcutAppId, data.assets.logo, Asset.Logo)) {
				const pos = data.logo_position;
				if (pos) {
					await Apps().SetCustomLogoPositionForApp(
						shortcutAppId,
						JSON.stringify({
							nVersion: 1,
							logoPosition: {
								pinnedPosition: pos.pinned_position,
								nWidthPct: Number(pos.width_pct),
								nHeightPct: Number(pos.height_pct),
							},
						}),
					);
				}
			}
		}

		if (settings.icon && data.assets.icon) {
			setBusy(shortcutAppId, 'Setting icon…');
			const image = await downloadImage(data.assets.icon);
			const icon = image.ok ? await api.saveIcon(account, shortcutAppId, image) : image;
			if (icon.ok && 'path' in icon && icon.path) Apps().SetShortcutIcon(shortcutAppId, icon.path);
			else log('icon download failed', data.assets.icon, icon.error);
		}

		const previous = links[shortcutAppId];
		const originalName = previous?.originalName ?? shortcut.display_name;
		if (settings.rename && shortcut.display_name !== data.name) {
			Apps().SetShortcutName(shortcutAppId, data.name);
			rerenderSoon();
		}

		await storeLink(shortcutAppId, {
			status: 'linked',
			source: wiki ? 'wiki' : 'steam',
			steamAppId: wiki ? undefined : ref,
			wikiId: wiki ? ref : undefined,
			steamName: data.name,
			originalName,
			updatedAt: Date.now(),
		});
		log(`Linked "${originalName}" (${shortcutAppId}) to ${data.name} (${ref})`);
		return data;
	} finally {
		setBusy(shortcutAppId, null);
	}
}

/** Undo everything Steamify did to a shortcut: artwork, icon and name. */
export async function unlink(shortcutAppId: number) {
	const link = getState().links[shortcutAppId];
	setBusy(shortcutAppId, 'Restoring…');
	try {
		if (link?.status === 'linked') {
			for (const asset of [Asset.Capsule, Asset.Hero, Asset.Logo, Asset.Header]) {
				await Apps().ClearCustomArtworkForApp(shortcutAppId, asset);
			}
			await Apps().ClearCustomLogoPositionForApp?.(shortcutAppId);

			const backup = await api.readBackup(shortcutAppId);
			if (backup.ok) {
				for (const file of asArray(backup.files)) {
					await Apps().SetCustomArtworkForApp(shortcutAppId, file.data, file.type === 'png' ? 'png' : 'jpg', file.asset);
				}
				if (backup.logo_position) await Apps().SetCustomLogoPositionForApp(shortcutAppId, backup.logo_position);
				Apps().SetShortcutIcon(shortcutAppId, backup.icon ?? '');
				await api.deleteBackup(shortcutAppId);
				await api.removeIcon(accountId(), shortcutAppId);
			}
			if (link.originalName && overview(shortcutAppId)?.display_name !== link.originalName) {
				Apps().SetShortcutName(shortcutAppId, link.originalName);
				rerenderSoon();
			}
		}
		await storeLink(shortcutAppId, null);
	} finally {
		setBusy(shortcutAppId, null);
	}
}

/** Remember that this shortcut has no Steam counterpart so auto-match leaves it alone. */
export async function markNotOnSteam(shortcutAppId: number) {
	if (getState().links[shortcutAppId]?.status === 'linked') await unlink(shortcutAppId);
	await storeLink(shortcutAppId, { status: 'ignored', updatedAt: Date.now() });
}

/** Try to find a confident store match for one shortcut. Returns the Steam appid or null. */
export async function findMatch(name: string): Promise<number | null> {
	const result = await api.search(name);
	if (!result.ok) throw new Error(result.error || 'Store search failed');
	for (const candidate of confidentMatches(name, asArray(result.items)).slice(0, 3)) {
		const data = await api.gameData(candidate.id);
		if (data.ok && (!data.type || data.type === 'game')) return candidate.id as number;
	}
	return null;
}

/** "Doom (1993 video game)" -> "Doom" */
export const wikiTitle = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '');

/**
 * Find a Wikipedia article about a video game with the shortcut's name. Returns the Wikidata
 * id or null. Only articles described as a game qualify, so apps like Kodi need a manual link.
 */
export async function findWikiMatch(name: string): Promise<string | null> {
	const result = await api.searchWiki(name);
	if (!result.ok) throw new Error(result.error || 'Wikipedia search failed');
	const games = asArray(result.items).filter((i) => /\bgame\b/i.test(i.type ?? ''));
	const best = games
		.map((item) => ({ item, score: matchScore(name, wikiTitle(item.name)) }))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score)[0];
	return best ? (best.item.id as string) : null;
}

/**
 * Link every shortcut whose name confidently matches a store game, falling back to
 * Wikipedia when enabled. With retry=false, shortcuts that previously had no match are
 * skipped (unless they haven't been looked up on Wikipedia yet).
 */
export async function autoMatch(retry: boolean): Promise<{ linked: string[]; unmatched: string[] }> {
	const linked: string[] = [];
	const unmatched: string[] = [];
	for (const sc of shortcuts()) {
		const link = getState().links[sc.appid];
		if (link?.status === 'linked' || link?.status === 'ignored') continue;
		const useWiki = getState().settings.wiki_fallback;
		if (link?.status === 'nomatch' && !retry && (link.wikiChecked || !useWiki)) continue;
		setBusy(sc.appid, 'Searching the store…');
		try {
			let ref: GameRef | null = await findMatch(sc.display_name);
			if (!ref && useWiki) {
				setBusy(sc.appid, 'Searching Wikipedia…');
				ref = await findWikiMatch(sc.display_name);
			}
			if (ref) {
				const data = await applyLink(sc.appid, ref);
				linked.push(`${sc.display_name} → ${data.name}${typeof ref === 'string' ? ' (Wikipedia)' : ''}`);
			} else {
				await storeLink(sc.appid, { status: 'nomatch', wikiChecked: useWiki, updatedAt: Date.now() });
				unmatched.push(sc.display_name);
			}
		} catch (e) {
			log('auto-match failed for', sc.display_name, e);
			unmatched.push(sc.display_name);
		} finally {
			setBusy(sc.appid, null);
		}
	}
	return { linked, unmatched };
}
