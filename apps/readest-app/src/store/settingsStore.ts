import { mergeBookshelfStates } from '@/services/bookshelves/state';
import i18n from '@/i18n/i18n';
import { create } from 'zustand';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { currentAiCredentialScope, withoutAiCredentials } from '@/services/ai/nativeCredentials';
import { initDayjs } from '@/utils/time';
import { broadcastGlobalSettings } from '@/utils/settingsSync';

export type FontPanelView = 'main-fonts' | 'custom-fonts';

interface SettingsState {
  settings: SystemSettings;
  settingsDialogBookKey: string;
  isSettingsDialogOpen: boolean;
  fontPanelView: FontPanelView;
  activeSettingsItemId: string | null;
  /**
   * Deep-link target — when set before opening the Settings dialog, the dialog
   * mounts with this panel pre-selected (instead of the lastConfigPanel from
   * localStorage). Cleared by the dialog after consumption.
   */
  requestedPanel: string | null;
  /**
   * Optional sub-page hint paired with `requestedPanel`. When the requested
   * panel renders nested sub-pages (e.g. Integrations → KOSync / Readwise /
   * Hardcover / OPDS), this string tells the panel which one to drill into.
   * Cleared by the panel after consumption. Format is panel-specific —
   * Integrations recognises 'kosync' | 'readwise' | 'hardcover' | 'opds'.
   */
  requestedSubPage: string | null;
  setSettings: (settings: SystemSettings) => void;
  saveSettings: (envConfig: EnvConfigType, settings: SystemSettings) => Promise<void>;
  setSettingsDialogBookKey: (bookKey: string) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setFontPanelView: (view: FontPanelView) => void;
  setActiveSettingsItemId: (id: string | null) => void;
  setRequestedPanel: (panel: string | null) => void;
  setRequestedSubPage: (subPage: string | null) => void;

  applyUILanguage: (uiLanguage?: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {} as SystemSettings,
  settingsDialogBookKey: '',
  isSettingsDialogOpen: false,
  fontPanelView: 'main-fonts',
  activeSettingsItemId: null,
  requestedPanel: null,
  requestedSubPage: null,
  setSettings: (settings) =>
    set((state) => ({
      // A late load from another login must never publish its key to this account.
      // Native keychain values carry an in-memory owner marker which JSON drops.
      // An unmarked key is treated as untrusted after the secure-storage migration.
      // An unrelated `{ ...settings, someField }` write carries the very state
      // already stored, so skip the merge and keep the reference stable — the
      // library memoizes whole-shelf derivations on it.
      settings: (() => {
        const incoming =
          settings.aiSettings && settings.aiSettings.credentialScope !== currentAiCredentialScope()
            ? withoutAiCredentials(settings)
            : settings;
        return state.settings.bookshelves && state.settings.bookshelves !== incoming.bookshelves
          ? {
              ...incoming,
              bookshelves: mergeBookshelfStates(state.settings.bookshelves, incoming.bookshelves),
            }
          : incoming;
      })(),
    })),
  saveSettings: async (envConfig: EnvConfigType, settings: SystemSettings) => {
    const appService = await envConfig.getAppService();
    await appService.saveSettings(settings);
    // Keep other open windows' in-memory global settings in sync so a stale
    // window doesn't clobber this write on its next save (issue #4580).
    void broadcastGlobalSettings(settings);
  },
  setSettingsDialogBookKey: (bookKey) => set({ settingsDialogBookKey: bookKey }),
  setSettingsDialogOpen: (open) => set({ isSettingsDialogOpen: open }),
  setFontPanelView: (view) => set({ fontPanelView: view }),
  setActiveSettingsItemId: (id) => set({ activeSettingsItemId: id }),
  setRequestedPanel: (panel) => set({ requestedPanel: panel }),
  setRequestedSubPage: (subPage) => set({ requestedSubPage: subPage }),

  applyUILanguage: (uiLanguage?: string) => {
    const locale = uiLanguage ? uiLanguage : navigator.language;
    i18n.changeLanguage(locale);
    initDayjs(locale);
  },
}));
