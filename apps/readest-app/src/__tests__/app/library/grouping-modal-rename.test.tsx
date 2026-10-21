import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import { md5Fingerprint } from '@/utils/md5';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import GroupingModal from '@/app/library/components/GroupingModal';

const saveLibraryBooks = vi.fn();
const saveSettings = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { saveLibraryBooks, saveSettings },
    envConfig: { getAppService: async () => ({ saveSettings }) },
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));

const book = (hash: string, groupName: string): Book => ({
  hash,
  title: hash,
  author: 'Writer',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  groupId: md5Fingerprint(groupName),
  groupName,
});

let library: Book[];
beforeEach(() => {
  saveSettings.mockClear();
  library = [book('direct', 'A'), book('nested', 'A/B'), book('deep', 'A/C/D'), book('other', 'X')];
  useSettingsStore.setState({
    settings: {} as ReturnType<typeof useSettingsStore.getState>['settings'],
  });
  useLibraryStore.setState({ library, groups: {} });
});
afterEach(cleanup);

// Selecting the `A` tile selects every book in its subtree.
const renameA = (onConfirm = vi.fn()) => {
  render(
    <GroupingModal
      libraryBooks={library}
      selectedBooks={['direct', 'nested', 'deep']}
      parentGroupName=''
      renameGroupName='A'
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Rename Group' }));
  fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'Z' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return onConfirm;
};
const groupNames = () => Object.fromEntries(library.map((b) => [b.hash, b.groupName]));

describe('renaming a group with nested groups', () => {
  it('renames only the group and keeps its nested structure', () => {
    renameA();
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });

  it('closes on Save, so Confirm cannot then move the subtree into one group', () => {
    // Left open, picking the renamed group and confirming flattened Z/B and Z/C/D into Z.
    const onConfirm = renameA();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(groupNames()).toEqual({ direct: 'Z', nested: 'Z/B', deep: 'Z/C/D', other: 'X' });
  });

  it('moves persisted empty descendants with a renamed parent', () => {
    useSettingsStore.setState({
      settings: { scholarCollectionPaths: ['A', 'A/Empty', 'X'] } as ReturnType<
        typeof useSettingsStore.getState
      >['settings'],
    });
    renameA();
    expect(useSettingsStore.getState().settings.scholarCollectionPaths).toEqual([
      'Z',
      'Z/Empty',
      'X',
    ]);
  });
});

describe('creating a Scholar collection', () => {
  it('persists an empty collection after the library is reloaded', async () => {
    render(
      <GroupingModal
        libraryBooks={library}
        selectedBooks={['direct']}
        parentGroupName=''
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create New Group' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(useSettingsStore.getState().settings.scholarCollectionPaths).toEqual(['Research']);
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ scholarCollectionPaths: ['Research'] }),
      ),
    );
    useLibraryStore.getState().setLibrary([]);
    expect(
      useLibraryStore
        .getState()
        .getGroups()
        .map((group) => group.name),
    ).toContain('Research');
  });
});
