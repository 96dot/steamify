import { DialogButton, Field, ModalRoot, TextField, ToggleField, showModal } from 'millennium';
import { useEffect, useState } from 'react';
import { api, asArray } from './api';
import { applyLink, autoMatch, linkRef, markNotOnSteam, unlink, updateSettings, wikiTitle } from './linker';
import { confidentMatches } from './matching';
import { mainWindow, overview, shortcuts } from './steam';
import { useAppState } from './store';
import type { GameRef, Link, SearchItem } from './types';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const rowStyle = { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0' } as const;
const buttonStyle = { width: 'auto', minWidth: '0', padding: '0 14px', flexShrink: 0 } as const;
const activeTabStyle = { background: '#1a9fff', color: '#fff' } as const;

type Source = 'steam' | 'wiki';

/** Search the Steam store (or Wikipedia, for games that aren't on Steam) and link the chosen result. */
export function SearchPanel({ shortcutAppId, onDone }: { shortcutAppId: number; onDone: () => void }) {
	const state = useAppState();
	const link = state.links[shortcutAppId];
	const name = overview(shortcutAppId)?.display_name ?? '';
	const [source, setSource] = useState<Source>(link?.source === 'wiki' || link?.status === 'ignored' ? 'wiki' : 'steam');
	const [term, setTerm] = useState(link?.originalName ?? name);
	const [results, setResults] = useState<SearchItem[] | null>(null);
	const [manualId, setManualId] = useState('');
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);

	const search = async (from: Source = source) => {
		if (!term.trim()) return;
		setResults(null);
		setStatus('Searching…');
		try {
			const res = from === 'wiki' ? await api.searchWiki(term.trim()) : await api.search(term.trim());
			if (!res.ok) throw new Error(res.error || 'Search failed');
			const items = asArray(res.items);
			// Put confident matches first, keep the source's order otherwise.
			const comparable = from === 'wiki' ? items.map((i) => ({ ...i, name: wikiTitle(i.name) })) : items;
			const bestIds = new Set(confidentMatches(term, comparable).map((i) => i.id));
			setResults([...items.filter((i) => bestIds.has(i.id)), ...items.filter((i) => !bestIds.has(i.id))]);
			if (items.length) setStatus('');
			else if (from === 'wiki') setStatus("No Wikipedia articles found. Try the game's full title.");
			else setStatus('No store results. Try a shorter name, enter the AppID from the store page URL, or search Wikipedia.');
		} catch (e) {
			setStatus(errorText(e));
		}
	};

	useEffect(() => {
		search();
	}, []);

	const switchTo = (next: Source) => {
		if (next === source) return;
		setSource(next);
		search(next);
	};

	const pick = async (ref: GameRef) => {
		setBusy(true);
		setStatus(typeof ref === 'string' ? 'Applying Wikipedia data…' : 'Applying store data…');
		try {
			await applyLink(shortcutAppId, ref, true);
			onDone();
		} catch (e) {
			setStatus(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const dontLink = async () => {
		setBusy(true);
		try {
			await markNotOnSteam(shortcutAppId);
			onDone();
		} finally {
			setBusy(false);
		}
	};

	const tab = (value: Source, label: string) => (
		<DialogButton style={{ ...buttonStyle, ...(source === value ? activeTabStyle : {}) }} disabled={busy} onClick={() => switchTo(value)}>
			{label}
		</DialogButton>
	);

	const thumb =
		source === 'wiki'
			? { width: '45px', height: '60px', objectFit: 'cover', borderRadius: '2px', flexShrink: 0 }
			: { width: '120px', height: '45px', objectFit: 'cover', borderRadius: '2px', flexShrink: 0 };

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
				{tab('steam', 'Steam store')}
				{tab('wiki', 'Wikipedia (not on Steam)')}
			</div>

			<div style={rowStyle}>
				<div style={{ flex: 1 }}>
					<TextField
						label={source === 'wiki' ? 'Search Wikipedia' : 'Search the Steam store'}
						value={term}
						disabled={busy}
						onChange={(e) => setTerm(e.target.value)}
						onKeyDown={(e) => e.key === 'Enter' && search()}
					/>
				</div>
				<DialogButton style={{ ...buttonStyle, alignSelf: 'flex-end' }} disabled={busy} onClick={() => search()}>
					Search
				</DialogButton>
			</div>

			{status && <div style={{ color: '#b8bcbf', fontSize: '13px' }}>{status}</div>}

			<div style={{ maxHeight: '320px', overflowY: 'auto' }}>
				{results?.slice(0, 10).map((item) => (
					<div key={item.id} style={rowStyle}>
						{item.image ? <img src={item.image} style={thumb as any} /> : source === 'wiki' ? <div style={thumb as any} /> : null}
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
							<div style={{ color: '#8b929a', fontSize: '12px' }}>{source === 'wiki' ? item.type ?? item.id : `AppID ${item.id}`}</div>
						</div>
						<DialogButton style={buttonStyle} disabled={busy} onClick={() => pick(item.id)}>
							Use this
						</DialogButton>
					</div>
				))}
			</div>

			{source === 'steam' && (
				<div style={rowStyle}>
					<div style={{ flex: 1 }}>
						<TextField label="Or enter a Steam AppID" value={manualId} mustBeNumeric disabled={busy} onChange={(e) => setManualId(e.target.value.replace(/\D/g, ''))} />
					</div>
					<DialogButton style={{ ...buttonStyle, alignSelf: 'flex-end' }} disabled={busy || !manualId} onClick={() => pick(Number(manualId))}>
						Link AppID
					</DialogButton>
				</div>
			)}

			<div style={{ ...rowStyle, justifyContent: 'flex-end' }}>
				<DialogButton style={buttonStyle} disabled={busy} onClick={dontLink}>
					Don't link this game
				</DialogButton>
			</div>
		</div>
	);
}

const linkLabel = (link: Link) => (link.source === 'wiki' ? 'Wikipedia' : `AppID ${link.steamAppId}`);

export function LinkDialog({ shortcutAppId, closeModal }: { shortcutAppId: number; closeModal?: () => void }) {
	const state = useAppState();
	const link = state.links[shortcutAppId];
	const close = () => closeModal?.();
	return (
		<ModalRoot closeModal={close} onCancel={close}>
			<div style={{ fontSize: '22px', color: '#fff', marginBottom: '4px' }}>Steamify</div>
			<div style={{ color: '#b8bcbf', marginBottom: '12px' }}>
				{link?.status === 'linked'
					? `"${overview(shortcutAppId)?.display_name}" is linked to ${link.steamName} (${linkLabel(link)}). Pick another game, or unlink to restore the original.`
					: `Find "${overview(shortcutAppId)?.display_name}" on the Steam store, or on Wikipedia if it isn't on Steam.`}
			</div>
			<SearchPanel shortcutAppId={shortcutAppId} onDone={close} />
			{link?.status === 'linked' && (
				<div style={{ ...rowStyle, justifyContent: 'flex-end' }}>
					<DialogButton style={buttonStyle} onClick={() => unlink(shortcutAppId).then(close)}>
						Unlink and restore original
					</DialogButton>
				</div>
			)}
		</ModalRoot>
	);
}

function statusText(link: Link | undefined, busy: string | undefined) {
	if (busy) return busy;
	switch (link?.status) {
		case 'linked':
			return `Linked to ${link.steamName} (${linkLabel(link)})`;
		case 'nomatch':
			return 'No exact match found. Search manually.';
		case 'ignored':
			return 'Not linked (by choice)';
		default:
			return 'Not linked';
	}
}

function ShortcutRow({ appid, name }: { appid: number; name: string }) {
	const state = useAppState();
	const link = state.links[appid];
	const busy = state.busy[appid];
	const [error, setError] = useState('');

	const run = (fn: () => Promise<unknown>) => {
		setError('');
		fn().catch((e) => setError(errorText(e)));
	};

	const ref = linkRef(link);
	return (
		<Field
			label={name}
			childrenLayout="below"
			description={
				<>
					{statusText(link, busy)}
					{error && <div style={{ color: '#e06c6c' }}>{error}</div>}
				</>
			}
		>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
				<DialogButton style={buttonStyle} disabled={!!busy} onClick={() => openLinkDialog(appid)}>
					{ref !== undefined ? 'Change' : 'Find game'}
				</DialogButton>
				{ref !== undefined && (
					<DialogButton style={buttonStyle} disabled={!!busy} onClick={() => run(() => applyLink(appid, ref, true))}>
						Re-apply
					</DialogButton>
				)}
				{link && (
					<DialogButton style={buttonStyle} disabled={!!busy} onClick={() => run(() => unlink(appid))}>
						{link.status === 'linked' ? 'Unlink' : 'Reset'}
					</DialogButton>
				)}
			</div>
		</Field>
	);
}

/** Open the search dialog over the library window (or the given window). */
export function openLinkDialog(shortcutAppId: number, win: Window | undefined = mainWindow()) {
	showModal(<LinkDialog shortcutAppId={shortcutAppId} />, win, { strTitle: 'Steamify', bNeverPopOut: true });
}

/** The SteamGridDB key is saved when the field loses focus, not on every keystroke. */
function SteamGridDBKeyField({ value }: { value: string }) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const save = () => {
		if (draft.trim() !== value) updateSettings({ sgdb_key: draft.trim() });
	};
	return (
		<TextField
			label="SteamGridDB API key (optional)"
			description="Adds high-resolution cover, hero, logo and icon artwork for games linked to Wikipedia. Get a free key at steamgriddb.com → Preferences → API, then Re-apply those games."
			bIsPassword
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={save}
			onKeyDown={(e) => e.key === 'Enter' && save()}
		/>
	);
}

export function SettingsPanel() {
	const state = useAppState();
	const [summary, setSummary] = useState('');
	const [running, setRunning] = useState(false);
	const list = shortcuts();

	if (!state.ready) return <Field label="Steamify" description="Waiting for your library to load…" />;

	const runAutoMatch = async () => {
		setRunning(true);
		setSummary('Matching…');
		try {
			const { linked, unmatched } = await autoMatch(true);
			setSummary(
				[linked.length ? `Linked: ${linked.join(', ')}.` : 'No new matches.', unmatched.length ? `No match: ${unmatched.join(', ')}.` : '']
					.filter(Boolean)
					.join(' '),
			);
		} catch (e) {
			setSummary(errorText(e));
		} finally {
			setRunning(false);
		}
	};

	const s = state.settings;
	return (
		<>
			<ToggleField label="Use the official name" description="Rename the shortcut to its store name." checked={s.rename} onChange={(v) => updateSettings({ rename: v })} />
			<ToggleField
				label="Copy library artwork"
				description="Cover, hero, logo (with official placement) and wide capsule. Your previous custom art is backed up and restored on unlink."
				checked={s.artwork}
				onChange={(v) => updateSettings({ artwork: v })}
			/>
			<ToggleField label="Copy the game icon" checked={s.icon} onChange={(v) => updateSettings({ icon: v })} />
			<ToggleField
				label="Show store info on the game page"
				description="Box art, description, developer, publisher, release date, features and store links."
				checked={s.info_panel}
				onChange={(v) => updateSettings({ info_panel: v })}
			/>
			<ToggleField
				label="Show news and game details on the game page"
				description="Recent news for games on Steam. Gameplay, story and reviews from Wikipedia for other games."
				checked={s.details}
				onChange={(v) => updateSettings({ details: v })}
			/>
			<ToggleField
				label="Auto-link new non-Steam games"
				description="On startup, link shortcuts whose name matches a store game."
				checked={s.auto_match}
				onChange={(v) => updateSettings({ auto_match: v })}
			/>
			<ToggleField
				label="Use Wikipedia for games not on Steam"
				description="Description, cover, developer, publisher, release date and platforms from Wikipedia and Wikidata."
				checked={s.wiki_fallback}
				onChange={(v) => updateSettings({ wiki_fallback: v })}
			/>
			<SteamGridDBKeyField value={s.sgdb_key ?? ''} />
			<Field label="Match all unlinked games" description={summary || 'Searches the store (and Wikipedia) for every shortcut that is not linked yet.'}>
				<DialogButton style={buttonStyle} disabled={running} onClick={runAutoMatch}>
					{running ? 'Working…' : 'Auto-match'}
				</DialogButton>
			</Field>
			{list.length === 0 && <Field label="No non-Steam games in your library" />}
			{list.map((app) => (
				<ShortcutRow key={app.appid} appid={app.appid} name={app.display_name} />
			))}
		</>
	);
}
