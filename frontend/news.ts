// Recent news for a Steam app from the public ISteamNews API, which allows cross-origin
// requests from the Steam client, so no backend round trip is needed.

export interface NewsItem {
	gid: string;
	title: string;
	/** "Patch Notes", "News", or the outlet's name for press articles. */
	label: string;
	summary: string;
	image?: string;
	date: number;
	url: string;
}

const CACHE_TTL = 60 * 60 * 1000;
const cache = new Map<number, { at: number; items: Promise<NewsItem[]> }>();

const CLAN_IMAGES = 'https://clan.akamai.steamstatic.com/images';

function firstImage(contents: string): string | undefined {
	const youtube = /\[previewyoutube=([\w-]+)/i.exec(contents);
	const m =
		/\[img(?:\s+src="([^"]+)")?\](?:([^[]+)\[\/img\])?/i.exec(contents) ??
		/<img[^>]+src="([^"]+)"/i.exec(contents);
	const src = m ? (m[1] ?? m[2])?.trim() : undefined;
	if (src) return src.replace('{STEAM_CLAN_IMAGE}', CLAN_IMAGES);
	return youtube ? `https://img.youtube.com/vi/${youtube[1]}/hqdefault.jpg` : undefined;
}

function plainText(contents: string): string {
	const el = document.createElement('div');
	// BBCode and HTML tags out, then let the browser decode entities.
	el.innerHTML = contents
		.replace(/\[(img|previewyoutube|video)[^\]]*\]([^[]*\[\/\1\])?/gi, ' ')
		.replace(/\[\/?[^\]]+\]/g, ' ')
		.replace(/<[^>]+>/g, ' ');
	return (el.textContent ?? '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
}

/** True when a title is mostly Latin script, to skip press feeds in other languages. */
function latin(text: string): boolean {
	const letters = text.match(/\p{L}/gu) ?? [];
	return letters.filter((c) => /\p{Script=Latin}/u.test(c)).length >= letters.length * 0.6;
}

async function load(appid: number): Promise<NewsItem[]> {
	const res = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=20&format=json`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const json = await res.json();
	const raw: any[] = Array.isArray(json?.appnews?.newsitems) ? json.appnews.newsitems : [];
	return raw
		.filter((n) => typeof n?.title === 'string' && (n.feed_type === 1 || latin(n.title)))
		.map((n): NewsItem => {
			const official = n.feed_type === 1;
			const tags: string[] = Array.isArray(n.tags) ? n.tags : [];
			return {
				gid: String(n.gid),
				title: n.title,
				label: tags.includes('patchnotes') ? 'Patch Notes' : official ? 'News' : String(n.feedlabel ?? 'News'),
				summary: plainText(String(n.contents ?? '')).slice(0, 400),
				image: firstImage(String(n.contents ?? '')),
				date: Number(n.date) * 1000,
				url: official ? `https://store.steampowered.com/news/app/${appid}/view/${n.gid}` : String(n.url),
			};
		});
}

/** The app's latest news, newest first. Cached for an hour; failures resolve to []. */
export function getNews(appid: number): Promise<NewsItem[]> {
	const hit = cache.get(appid);
	if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;
	const items = load(appid).catch((): NewsItem[] => {
		cache.delete(appid);
		return [];
	});
	cache.set(appid, { at: Date.now(), items });
	return items;
}
