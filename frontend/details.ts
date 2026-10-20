// Fills the game page's left column, which Steam leaves empty for non-Steam games: recent news
// for games linked to a Steam app, and gameplay, story and reception from Wikipedia otherwise.

import { cx, h } from './dom';
import { getNews, type NewsItem } from './news';
import { openSteamUrl } from './steam';
import type { GameData } from './types';

const SECTION = ['AppDetailsSection', 'LinksSection', 'DLCSection', 'FriendsSection', 'ScreenshotsSection'];
const SECTION_BODY = ['AppDetailsSectionContainer', 'RightColumnSection', 'AppDetailsSectionHasLabel', 'Body'];
const HEADER = ['SectionHeader', 'PadLeft', 'HeaderStyles', 'Label', 'LabelText', 'Reset'];
const ACTIVITY = ['AppActivityDay', 'AppActivityDate', 'Rule', 'Event', 'FetchMoreContainer'];

const NEWS_SHOWN = 4;
/** Text longer than this (in characters) is clipped to CLIPPED_HEIGHT until "Read more". */
const COLLAPSE_AT = 700;
const CLIPPED_HEIGHT = '160px';

const TEXT = { color: '#acb2b8', fontSize: '14px', lineHeight: '1.6' };
const LINK = { color: '#1a9fff', cursor: 'pointer' };

const open = (url: string) => () => openSteamUrl(`steam://openurl/${url}`);

/** An empty section shaped like Steam's own ("Activity", "Notes"…), returning its body. */
function section(doc: Document, title: string): { root: HTMLElement; body: HTMLElement } {
	const body = h(doc, 'div', cx('Body', SECTION_BODY), [], { style: { display: 'flex', flexDirection: 'column' } });
	const root = h(doc, 'div', `${cx('AppDetailsSection', SECTION)} Panel`, [
		h(doc, 'h2', `${cx('Reset', HEADER)} ${cx('SectionHeader', HEADER)} ${cx('PadLeft', HEADER)}`, [
			h(doc, 'div', cx('Label', HEADER), [h(doc, 'div', cx('LabelText', HEADER), [title])]),
		]),
		h(doc, 'div', `${cx('AppDetailsSectionContainer', SECTION_BODY)} ${cx('AppDetailsSectionHasLabel', SECTION_BODY)} Panel`, [body]),
	]);
	return { root, body };
}

/** A small heading with a rule after it, like the activity feed's day headings. */
function subheading(doc: Document, text: string) {
	// Steam only styles the date heading inside its day container.
	return h(doc, 'div', cx('AppActivityDay', ACTIVITY), [
		h(doc, 'h4', `${cx('Reset', HEADER)} ${cx('AppActivityDate', ACTIVITY)}`, [text, h(doc, 'div', cx('Rule', ACTIVITY))]),
	]);
}

function button(doc: Document, label: string, onClick: () => void) {
	return h(doc, 'button', `${cx('FetchMoreContainer', ACTIVITY)} DialogButton _DialogLayout Secondary Focusable`, [label], {
		type: 'button',
		onClick,
	});
}

function textLink(doc: Document, label: string, onClick: () => void) {
	return h(doc, 'span', '', [label], { onClick, style: LINK });
}

function hoverable(el: HTMLElement, normal: string, hover: string) {
	el.style.background = normal;
	el.addEventListener('mouseenter', () => (el.style.background = hover));
	el.addEventListener('mouseleave', () => (el.style.background = normal));
	return el;
}

// --- News (games on Steam) ---

function dayLabel(time: number) {
	const date = new Date(time);
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

function newsCard(doc: Document, item: NewsItem, fallbackImage: string | undefined) {
	const img = h(doc, 'img', '', [], {
		src: item.image ?? fallbackImage ?? '',
		style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
		onError: (e: Event) => {
			const el = e.target as HTMLImageElement;
			if (fallbackImage && el.src !== fallbackImage) el.src = fallbackImage;
			else el.style.visibility = 'hidden';
		},
	});
	const card = h(
		doc,
		'div',
		`${cx('Event', ACTIVITY)} Panel Focusable`,
		[
			h(doc, 'div', '', [img], { style: { flex: '0 0 38%', aspectRatio: '16 / 9', overflow: 'hidden', background: 'rgba(0, 0, 0, 0.3)' } }),
			h(doc, 'div', '', [
				h(doc, 'div', '', [item.label], { style: { color: '#8b929a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' } }),
				h(doc, 'div', '', [item.title], { style: { color: '#fff', fontSize: '18px', lineHeight: '1.3', margin: '4px 0 8px' } }),
				h(doc, 'div', '', [item.summary], {
					style: { ...TEXT, color: '#8b929a', display: '-webkit-box', webkitLineClamp: '3', webkitBoxOrient: 'vertical', overflow: 'hidden' },
				}),
			], { style: { flex: '1', minWidth: '0' } }),
		],
		{ onClick: open(item.url), style: { display: 'flex', gap: '16px', padding: '12px', cursor: 'pointer', marginBottom: '16px' } },
	);
	return hoverable(card, 'rgba(255, 255, 255, 0.04)', 'rgba(255, 255, 255, 0.08)');
}

function newsSection(doc: Document, steamAppId: number, data: GameData) {
	const { root, body } = section(doc, 'News');
	body.append(h(doc, 'div', '', ['Loading news…'], { style: { ...TEXT, color: '#8b929a' } }));
	getNews(steamAppId).then((items) => {
		body.replaceChildren();
		if (!items.length) {
			root.style.display = 'none';
			return;
		}
		let day = '';
		for (const item of items.slice(0, NEWS_SHOWN)) {
			const label = dayLabel(item.date);
			if (label !== day) body.append(subheading(doc, (day = label)));
			body.append(newsCard(doc, item, data.assets.header));
		}
		body.append(button(doc, 'View All News', open(`https://store.steampowered.com/news/app/${steamAppId}`)));
	});
	return root;
}

// --- About (games linked to Wikipedia) ---

/** Paragraphs clipped to a few lines with a fade, like the store's "About This Game", plus "Read more". */
function paragraphs(doc: Document, list: string[]) {
	const box = h(doc, 'div', '', list.map((text) => h(doc, 'p', '', [text], { style: { ...TEXT, margin: '0 0 12px' } })));
	if (list.join(' ').length < COLLAPSE_AT) return [box];
	const fade = 'linear-gradient(to bottom, #000 55%, transparent)';
	Object.assign(box.style, { maxHeight: CLIPPED_HEIGHT, overflow: 'hidden', maskImage: fade, webkitMaskImage: fade });
	const more = h(doc, 'p', '', [], { style: { ...TEXT, margin: '0 0 12px' } });
	more.append(
		textLink(doc, 'Read more', () => {
			Object.assign(box.style, { maxHeight: '', overflow: '', maskImage: '', webkitMaskImage: '' });
			more.remove();
		}),
	);
	return [box, more];
}

function facts(doc: Document, data: GameData) {
	const rows = [
		['Genre', Array.isArray(data.genres) ? data.genres.slice(0, 3).join(', ') : ''],
		['Series', Array.isArray(data.series) ? data.series.join(', ') : ''],
	].filter(([, v]) => v);
	if (!rows.length) return null;
	return h(
		doc,
		'div',
		'',
		rows.map(([k, v]) => h(doc, 'div', '', [h(doc, 'span', '', [`${k}: `], { style: { color: '#8b929a' } }), v], { style: { color: '#dcdedf' } })),
		{ style: { fontSize: '13px', lineHeight: '1.7', marginBottom: '12px' } },
	);
}

function reviewScores(doc: Document, data: GameData) {
	const reviews = Array.isArray(data.reviews) ? data.reviews.slice(0, 6) : [];
	if (!reviews.length) return null;
	return h(
		doc,
		'div',
		'',
		reviews.map((r) =>
			h(doc, 'div', '', [h(doc, 'span', '', [r.source], { style: { color: '#8b929a' } }), ' ', h(doc, 'b', '', [r.score], { style: { color: '#fff' } })], {
				style: { background: 'rgba(255, 255, 255, 0.06)', padding: '4px 10px', fontSize: '13px' },
			}),
		),
		{ style: { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '0 0 16px' } },
	);
}

function aboutSection(doc: Document, data: GameData) {
	const { root, body } = section(doc, 'About This Game');
	const factList = facts(doc, data);
	if (factList) body.append(factList);

	const article = Array.isArray(data.article) ? data.article : [];
	const scores = reviewScores(doc, data);
	for (const sec of article) {
		const list = Array.isArray(sec.paragraphs) ? sec.paragraphs : [];
		body.append(subheading(doc, sec.title));
		if (sec.title === 'Reception' && scores) body.append(scores);
		if (sec.spoilers) {
			const hidden = h(doc, 'div', '', paragraphs(doc, list), { style: { display: 'none' } });
			const reveal = h(doc, 'p', '', [textLink(doc, 'Show the story (contains spoilers)', () => ((hidden.style.display = ''), reveal.remove()))], {
				style: { ...TEXT, margin: '0 0 12px' },
			});
			body.append(reveal, hidden);
		} else {
			body.append(...paragraphs(doc, list));
		}
	}
	if (scores && !article.some((s) => s.title === 'Reception')) body.append(subheading(doc, 'Reception'), scores);

	if (data.article_url && article.length) {
		body.append(
			h(doc, 'p', '', ['Text from ', textLink(doc, 'Wikipedia', open(data.article_url)), ', available under ', textLink(doc, 'CC BY-SA 4.0', open('https://creativecommons.org/licenses/by-sa/4.0/')), '.'], {
				style: { color: '#8b929a', fontSize: '12px', margin: '4px 0 0' },
			}),
		);
	}
	return root;
}

/** Whether there is anything to show in the left column for this game. */
export function hasDetails(data: GameData): boolean {
	if (data.source !== 'wiki') return true;
	return (Array.isArray(data.article) && data.article.length > 0) || (Array.isArray(data.reviews) && data.reviews.length > 0);
}

/** The left-column section for a linked game (call only when hasDetails is true). */
export function detailsSection(doc: Document, data: GameData): HTMLElement {
	return data.source === 'wiki' ? aboutSection(doc, data) : newsSection(doc, data.appid, data);
}
