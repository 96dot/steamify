import { useEffect, useState } from 'react';
import type { GameData, Link, Settings } from './types';

export interface State {
	ready: boolean;
	links: Record<string, Link>;
	settings: Settings;
	/** Metadata for linked games, keyed by Steam appid or Wikidata id (see linkRef). */
	gameData: Record<string, GameData>;
	/** In-progress work per shortcut appid, shown in the UI. */
	busy: Record<string, string>;
}

let state: State = {
	ready: false,
	links: {},
	settings: { rename: true, artwork: true, icon: true, info_panel: true, auto_match: true, wiki_fallback: true, sgdb_key: '' },
	gameData: {},
	busy: {},
};

const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(patch: Partial<State>) {
	state = { ...state, ...patch };
	listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function useAppState(): State {
	const [snapshot, setSnapshot] = useState(state);
	useEffect(() => {
		const unsubscribe = subscribe(() => setSnapshot(state));
		setSnapshot(state);
		return () => {
			unsubscribe();
		};
	}, []);
	return snapshot;
}

export function setBusy(shortcutAppId: number, message: string | null) {
	const busy = { ...state.busy };
	if (message) busy[shortcutAppId] = message;
	else delete busy[shortcutAppId];
	setState({ busy });
}
