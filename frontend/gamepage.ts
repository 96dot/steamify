// Adds the store "game info" panel and links bar to non-Steam game pages in the desktop
// library, built from Steam's own CSS module classes so it looks like an official page.

import { detailsSection, hasDetails } from './details';
import { cx, h, sel } from './dom';
import { linkRef } from './linker';
import { isShortcut, mainWindow, mainWindowPath, openSteamUrl, overview } from './steam';
import { getState, subscribe } from './store';
import type { GameData, Link } from './types';

// Keys that identify each of Steam's CSS modules; cx() picks the module sharing the most of them,
// since generic keys like "Container" or "Label" exist in many modules.
const INFO = ['Portrait', 'Description', 'Stats', 'FeaturesList', 'SectionContainer', 'InnerContainer'];
const GAME_INFO = ['AppGameInfoContainer', 'AppDetailsCollapsed', 'AppDetailsExpanded', 'BoxArtExpanded', 'GameInfoShadow', 'Glassy'];
const INFO_TEXT = ['GameDescription', 'AssociationList', 'Association', 'Release', 'Date', 'Name'];
const BOX_ART = ['BoxArt', 'ZoomInButton', 'Portrait'];
const ASSET = ['GreyBackground', 'Image', 'Visibility', 'Visible', 'PortraitImage', 'LandscapeImage', 'CustomImage'];
const FEATURE = ['Container', 'Icon', 'ExtraMargin', 'Label'];
const SECTION = ['AppDetailsSection', 'LinksSection', 'DLCSection', 'FriendsSection', 'ScreenshotsSection'];
const SECTION_BODY = ['AppDetailsSectionContainer', 'RightColumnSection', 'AppDetailsSectionHasLabel', 'Body'];
const LINKS = ['LinksSectionBody', 'Links', 'LinkInner', 'Anchor', 'Link', 'Text'];
const COLUMNS = ['ColumnContainer', 'LeftColumn', 'RightColumn', 'Spotlights'];

const FEATURE_ICONS: Record<number, string> = {
	1: 'multiPlayer', 2: 'singlePlayer', 8: 'vac', 9: 'coop', 13: 'cc', 14: 'commentary', 15: 'stats',
	17: 'editor', 18: 'partial_controller', 22: 'achievements', 23: 'cloud', 25: 'leaderboards',
	27: 'multiPlayer', 28: 'controller', 29: 'cards', 30: 'workshop', 35: 'cart', 36: 'multiPlayer',
	38: 'coop', 41: 'remote_play', 42: 'remote_play', 43: 'remote_play', 44: 'remote_play_together',
	47: 'multiPlayer', 48: 'coop', 49: 'multiPlayer', 61: 'hdr', 62: 'familysharing',
};

/** Icons for Wikidata game modes ("Single-player", "Multiplayer", "Cooperative"…). */
function modeIcon(mode: string): string | undefined {
	const m = mode.toLowerCase();
	if (m.includes('single')) return 'singlePlayer';
	if (m.includes('co-op') || m.includes('cooperative')) return 'coop';
	if (m.includes('multi')) return 'multiPlayer';
	return undefined;
}

function storeSearchUrl(kind: 'developer' | 'publisher', name: string) {
	return `steam://openurl/https://store.steampowered.com/search/?${kind}=${encodeURIComponent(name)}`;
}

function gameInfoPanel(doc: Document, shortcutAppId: number, data: GameData) {
	const onSteam = data.source !== 'wiki';
	const association = (label: string, kind: 'developer' | 'publisher', names: string[] | undefined) =>
		names?.length
			? h(doc, 'div', cx('AssociationList', INFO_TEXT), [
					h(doc, 'div', cx('Label', INFO_TEXT), [label]),
					...names.map((name) =>
						h(doc, 'div', cx('Association', INFO_TEXT), [
							onSteam
								? h(doc, 'a', cx('Name', INFO_TEXT), [name], { href: '#', onClick: (e: Event) => (e.preventDefault(), openSteamUrl(storeSearchUrl(kind, name))) })
								: h(doc, 'span', cx('Name', INFO_TEXT), [name], { style: { cursor: 'default' } }),
						]),
					),
				])
			: null;
	const fact = (label: string, value: string | undefined) =>
		value ? h(doc, 'div', cx('Release', INFO_TEXT), [h(doc, 'div', cx('Label', INFO_TEXT), [label]), h(doc, 'div', cx('Date', INFO_TEXT), [value])]) : null;

	const featureItems = onSteam
		? (Array.isArray(data.categories) ? data.categories : []).map((c) => ({ label: c.description, icon: FEATURE_ICONS[c.id] }))
		: (Array.isArray(data.features) ? data.features : []).map((label) => ({ label, icon: modeIcon(label) }));
	const features = featureItems.slice(0, 8).map((c) => {
		const icon = c.icon;
		return h(doc, 'div', cx('Container', FEATURE) + ' Panel Focusable', [
			icon
				? h(doc, 'img', cx('Icon', FEATURE), [], {
						src: `https://store.akamai.steamstatic.com/public/images/v6/ico/ico_${icon}.png`,
						onError: (e: Event) => ((e.target as HTMLElement).style.visibility = 'hidden'),
					})
				: null,
			h(doc, 'div', cx('Label', FEATURE), [c.label]),
		]);
	});

	// Prefer the capsule Steam already has cached locally for this shortcut.
	const localCapsule = (window as any).appStore?.GetVerticalCapsuleURLForApp?.(overview(shortcutAppId));
	const capsule = typeof localCapsule === 'string' && localCapsule.includes('customimages') ? localCapsule : data.assets.capsule;

	// Steam animates this panel open by setting its height inline; ours is always open.
	return h(doc, 'div', `${cx('AppGameInfoContainer', GAME_INFO)} ${cx('AppDetailsExpanded', GAME_INFO)} ${cx('Glassy', GAME_INFO)}`, [
		h(doc, 'div', cx('Container', INFO), [
			h(doc, 'div', cx('InnerContainer', INFO), [
				h(doc, 'div', cx('Portrait', INFO), [
					h(doc, 'div', `${cx('Container', ASSET)} ${cx('GreyBackground', ASSET)} ${cx('PortraitImage', ASSET)} ${cx('BoxArt', BOX_ART)}`, [
						h(doc, 'img', `${cx('Image', ASSET)} ${cx('Visibility', ASSET)} ${cx('Visible', ASSET)}`, [], { src: capsule ?? '' }),
					]),
				]),
				data.description
					? h(doc, 'div', `${cx('Description', INFO)} ${cx('SectionContainer', INFO)}`, [h(doc, 'div', cx('GameDescription', INFO_TEXT), [data.description])])
					: null,
				h(doc, 'div', `${cx('Stats', INFO)} ${cx('SectionContainer', INFO)}`, [
					association('Developer:', 'developer', data.developers),
					association('Publisher:', 'publisher', data.publishers),
					fact('Release Date:', data.release_date),
					onSteam ? null : fact('Platforms:', Array.isArray(data.platforms) ? data.platforms.slice(0, 4).join(', ') : undefined),
				]),
				features.length ? h(doc, 'div', `${cx('FeaturesList', INFO)} ${cx('SectionContainer', INFO)}`, features) : null,
			]),
		]),
		h(doc, 'div', cx('GameInfoShadow', GAME_INFO)),
	], { style: { height: 'auto', ...ABOVE_PLAY_BAR_GLASS } });
}

// The play bar's glass backdrop (z-index 1, backdrop blur) extends below it and would blur our sections.
const ABOVE_PLAY_BAR_GLASS = { position: 'relative', zIndex: '2' };

// Steam dims link text until its JS has measured the bar; ours is static, so set it directly.
const LINK_TEXT = { color: 'rgba(255, 255, 255, 0.6)', textShadow: 'none', filter: 'none', opacity: '1' };

function linksBar(doc: Document, links: { label: string; onClick: () => void }[]) {
	return h(doc, 'div', `${cx('AppDetailsSection', SECTION)} ${cx('LinksSection', SECTION)} Panel`, [
		h(doc, 'div', `${cx('AppDetailsSectionContainer', SECTION_BODY)} ${cx('RightColumnSection', SECTION_BODY)} Panel`, [
			h(doc, 'div', `${cx('Body', SECTION_BODY)} ${cx('LinksSectionBody', LINKS)}`, [
				// Steam lays these out absolutely from JS-measured widths; a flex row gives the same spread.
				h(
					doc,
					'div',
					`${cx('Links', LINKS)} Panel`,
					links.map((l) =>
						h(
							doc,
							'div',
							cx('LinkInner', LINKS),
							[
								h(
									doc,
									'div',
									`${cx('Anchor', LINKS)} Panel Focusable`,
									[h(doc, 'div', cx('Link', LINKS), [h(doc, 'span', cx('Text', LINKS), [l.label], { style: LINK_TEXT })])],
									{
										onClick: l.onClick,
										onMouseEnter: (e: Event) => ((e.currentTarget as HTMLElement).querySelector('span')!.style.color = '#fff'),
										onMouseLeave: (e: Event) => ((e.currentTarget as HTMLElement).querySelector('span')!.style.color = LINK_TEXT.color),
										style: { cursor: 'pointer' },
									},
								),
							],
							{ style: { position: 'static' } },
						),
					),
					{ style: { display: 'flex', justifyContent: 'space-around', alignItems: 'center', height: 'auto' } },
				),
			]),
		]),
	], { style: ABOVE_PLAY_BAR_GLASS });
}

function storeLinks(steamAppId: number, onChange: () => void) {
	const community = (path: string) => () => openSteamUrl(`steam://openurl/https://steamcommunity.com/app/${steamAppId}/${path}`);
	return [
		{ label: 'Store Page', onClick: () => openSteamUrl(`steam://store/${steamAppId}`) },
		{ label: 'DLC', onClick: () => openSteamUrl(`steam://openurl/https://store.steampowered.com/dlc/${steamAppId}/`) },
		{ label: 'Community Hub', onClick: () => openSteamUrl(`steam://url/GameHub/${steamAppId}`) },
		{ label: 'Discussions', onClick: community('discussions/') },
		{ label: 'Guides', onClick: community('guides/') },
		{ label: 'Steamify…', onClick: onChange },
	];
}

/** Links for games linked to Wikipedia: Wikipedia, PCGamingWiki, IGDB, official site, SteamGridDB. */
function wikiLinks(data: GameData | undefined, onChange: () => void) {
	return [
		...(Array.isArray(data?.links) ? data.links : []).map((l) => ({ label: l.label, onClick: () => openSteamUrl(`steam://openurl/${l.url}`) })),
		{ label: 'Steamify…', onClick: onChange },
	];
}

/** Hide the "detailed information is unavailable for non-Steam games" notice. */
function hideNonSteamNotice(root: Element, name: string) {
	const left = root.querySelector(sel('LeftColumn', COLUMNS));
	if (!left) return;
	for (const section of Array.from(left.querySelectorAll(sel('AppDetailsSection', SECTION)))) {
		const el = section as HTMLElement;
		if (el.closest('[data-steamify]')) continue;
		const text = el.textContent ?? '';
		if (!el.querySelector('button, img, a') && text.includes(name) && text.length < 600) {
			el.style.display = 'none';
			el.dataset.steamifyHidden = '1';
		}
	}
}

function visible(el: Element) {
	return (el as HTMLElement).offsetParent !== null;
}

export interface GamePageHandlers {
	openLinkDialog: (shortcutAppId: number, win: Window) => void;
}

export function startGamePageInjector(handlers: GamePageHandlers): () => void {
	let observer: MutationObserver | null = null;
	let observedDoc: Document | null = null;
	let scheduled = false;

	const render = () => {
		scheduled = false;
		const win = mainWindow();
		const doc = observedDoc;
		if (!win || !doc) return;

		const match = /^\/library\/app\/(\d+)/.exec(mainWindowPath() ?? '');
		const appid = match ? Number(match[1]) : 0;
		const injected = Array.from(doc.querySelectorAll<HTMLElement>('[data-steamify]'));
		if (!appid || !isShortcut(appid)) {
			injected.forEach((el) => el.remove());
			return;
		}

		const { links, settings, gameData } = getState();
		const link: Link | undefined = links[appid];
		const ref = linkRef(link);
		const data = ref !== undefined ? gameData[ref] : undefined;
		const mode = link?.status === 'ignored' ? 'none' : data && settings.info_panel ? 'info' : ref !== undefined ? 'linksOnly' : 'unlinked';
		const showDetails = settings.details && mode !== 'unlinked' && !!data && hasDetails(data);
		const key = `${appid}:${mode}:${ref ?? ''}:${link?.updatedAt ?? ''}:${data?.fetched ?? ''}:${showDetails}`;

		const columns = Array.from(doc.querySelectorAll(sel('ColumnContainer', COLUMNS))).find(visible);
		if (!columns || mode === 'none') {
			injected.forEach((el) => el.remove());
			return;
		}
		const leftColumn = columns.querySelector(sel('LeftColumn', COLUMNS));
		const wantDetails = showDetails && !!leftColumn;
		const current = injected.filter((el) => el.dataset.steamify === key);
		const hasTop = current.some((el) => el.nextElementSibling === columns);
		const hasDetailsSection = current.some((el) => el.parentElement === leftColumn);
		if (hasTop && hasDetailsSection === wantDetails) return;
		injected.forEach((el) => el.remove());

		const openDialog = () => handlers.openLinkDialog(appid, win);
		const linkList = link?.source === 'wiki' ? wikiLinks(data, openDialog) : typeof ref === 'number' ? storeLinks(ref, openDialog) : [];
		const wrapper = h(doc, 'div', '', [], { 'data-steamify': key, style: { display: 'contents' } });
		if (mode === 'info' && data) {
			wrapper.append(gameInfoPanel(doc, appid, data), linksBar(doc, linkList));
		} else if (mode === 'linksOnly') {
			wrapper.append(linksBar(doc, linkList));
		} else {
			wrapper.append(linksBar(doc, [{ label: 'Find this game on Steam or Wikipedia (Steamify)', onClick: openDialog }]));
		}
		if (mode === 'info' || wantDetails) hideNonSteamNotice(columns.parentElement ?? doc.body, overview(appid)?.display_name ?? '');
		if (wantDetails && data && leftColumn) {
			const details = detailsSection(doc, data);
			details.dataset.steamify = key;
			leftColumn.prepend(details);
		}
		columns.parentElement?.insertBefore(wrapper, columns);
	};

	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		setTimeout(render, 50);
	};

	const attach = () => {
		const doc = mainWindow()?.document;
		if (doc && doc !== observedDoc && doc.body) {
			observer?.disconnect();
			observer = new MutationObserver(schedule);
			observer.observe(doc.body, { childList: true, subtree: true });
			observedDoc = doc;
		}
		schedule();
	};

	attach();
	const timer = setInterval(attach, 1000);
	const unsubscribe = subscribe(schedule);
	return () => {
		clearInterval(timer);
		unsubscribe();
		observer?.disconnect();
		observedDoc?.querySelectorAll('[data-steamify]').forEach((el) => el.remove());
	};
}
