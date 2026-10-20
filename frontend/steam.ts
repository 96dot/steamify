import type { AppOverview } from './types';

/** EAppType.Shortcut */
export const SHORTCUT_APP_TYPE = 1073741824;

/** ELibraryAssetType */
export const Asset = { Capsule: 0, Hero: 1, Logo: 2, Header: 3 } as const;

const w = window as any;

export const MAIN_WINDOW = 'SP Desktop_uid0';

export function libraryReady(): boolean {
	const steamId = w.App?.m_CurrentUser?.strSteamID;
	return !!steamId && steamId !== '0' && (w.appStore?.allApps?.length ?? 0) > 0;
}

export function overview(appid: number): AppOverview | undefined {
	return w.appStore?.GetAppOverviewByAppID?.(appid) ?? undefined;
}

export function isShortcut(appid: number): boolean {
	return overview(appid)?.app_type === SHORTCUT_APP_TYPE;
}

export function shortcuts(): AppOverview[] {
	return (w.appStore?.allApps ?? [])
		.filter((a: AppOverview) => a.app_type === SHORTCUT_APP_TYPE)
		.sort((a: AppOverview, b: AppOverview) => a.display_name.localeCompare(b.display_name));
}

/** The 32-bit account id, i.e. the userdata/<id> folder name. */
export function accountId(): string {
	const steamId = BigInt(w.App.m_CurrentUser.strSteamID);
	return (steamId - BigInt('76561197960265728')).toString();
}

export function openSteamUrl(url: string) {
	w.SteamClient.URL.ExecuteSteamURL(url);
}

export function mainWindow(): Window | undefined {
	return w.g_PopupManager?.GetExistingPopup?.(MAIN_WINDOW)?.m_popup;
}

/** Current route of the desktop library window, e.g. /library/app/3715311481. */
export function mainWindowPath(): string | undefined {
	const windows: any[] = w.SteamUIStore?.WindowStore?.SteamUIWindows ?? [];
	const win = windows.find((x) => x?.BrowserWindow?.name === MAIN_WINDOW) ?? windows[0];
	return win?.m_history?.location?.pathname;
}

export const Apps = () => w.SteamClient.Apps;
