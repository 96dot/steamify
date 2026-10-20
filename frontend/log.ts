/** Logs to the Steam console and to millennium/data/steamify/steamify.log. */
export function log(...args: unknown[]) {
	console.log('[Steamify]', ...args);
	const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(' ');
	backend.debug_log(text).catch(() => {});
}
