import type { SearchItem } from './types';

// Words that only distinguish editions of the same game, so "Dragon Age: Origins" may
// auto-link to "Dragon Age: Origins - Ultimate Edition".
const EDITION_WORDS = new Set([
	'edition', 'ultimate', 'complete', 'definitive', 'deluxe', 'gold', 'goty',
	'remastered', 'remaster', 'enhanced', 'directors', 'director', 'cut', 'anniversary', 'special', 'legendary',
	'collection', 'hd', 'classic', 'premium', 'standard',
]);

export function normalize(name: string): string {
	return name
		.toLowerCase()
		.replace(/[™®©]/g, '')
		.replace(/&/g, ' and ')
		.replace(/game of the year/g, 'goty')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/^the /, '');
}

function onlyEditionWords(rest: string): boolean {
	const words = rest.split(' ').filter(Boolean);
	return words.length > 0 && words.every((w) => EDITION_WORDS.has(w));
}

/** How sure we are that a store result is the same game: 2 = same name, 1 = same game, other edition. */
export function matchScore(shortcutName: string, storeName: string): number {
	const a = normalize(shortcutName);
	const b = normalize(storeName);
	if (!a || !b) return 0;
	if (a === b) return 2;
	if (b.startsWith(a + ' ') && onlyEditionWords(b.slice(a.length))) return 1;
	if (a.startsWith(b + ' ') && onlyEditionWords(a.slice(b.length))) return 1;
	return 0;
}

/** Store results that confidently match the shortcut name, best first. */
export function confidentMatches(shortcutName: string, items: SearchItem[]): SearchItem[] {
	return items
		.map((item, index) => ({ item, index, score: matchScore(shortcutName, item.name) }))
		.filter((x) => x.score > 0)
		.sort((x, y) => y.score - x.score || x.index - y.index)
		.map((x) => x.item);
}
