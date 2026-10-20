// Helpers for building DOM that uses Steam's own (hashed) CSS module classes.

import { classMapList } from 'millennium';

const classCache = new Map<string, string>();

/** Steam's hashed class for `key` (plus the readable name for themes), from the best-matching module. */
export function cx(key: string, family: string[]): string {
	const cacheKey = key + '|' + family.join(',');
	const cached = classCache.get(cacheKey);
	if (cached !== undefined) return cached;
	let best: Record<string, string> | undefined;
	let bestScore = -1;
	let bestSize = Infinity;
	for (const mod of classMapList as Record<string, string>[]) {
		if (!mod || typeof mod[key] !== 'string') continue;
		const score = family.reduce((n, k) => n + (typeof mod[k] === 'string' ? 1 : 0), 0);
		// On a tie, the smaller module is the more specific one (e.g. the one that only has "Reset").
		const size = Object.keys(mod).length;
		if (score > bestScore || (score === bestScore && size < bestSize)) {
			best = mod;
			bestScore = score;
			bestSize = size;
		}
	}
	const value = best ? `${best[key]} ${key}` : key;
	classCache.set(cacheKey, value);
	return value;
}

export const sel = (key: string, family: string[]) => '.' + CSS.escape(cx(key, family).split(' ')[0]);

export type Child = Node | string | null | undefined | false;

export function h(doc: Document, tag: string, className: string, children: Child[] = [], props: Record<string, any> = {}) {
	const el = doc.createElement(tag);
	if (className) el.className = className;
	for (const [k, v] of Object.entries(props)) {
		if (k === 'style') Object.assign(el.style, v);
		else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
		else el.setAttribute(k, String(v));
	}
	for (const c of children) {
		if (c === null || c === undefined || c === false) continue;
		el.append(typeof c === 'string' ? doc.createTextNode(c) : c);
	}
	return el;
}
