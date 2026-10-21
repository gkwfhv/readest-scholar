import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BookMetadata } from '@/libs/document';
import { useMetadataEdit } from '@/components/metadata/useMetadataEdit';

const metadata = { title: 'Paper', author: 'Researcher', language: 'en' } as BookMetadata;
const noTags: string[] = [];

describe('useMetadataEdit DOI field', () => {
  it('includes DOI in Lock All so a later source cannot replace a manual value', () => {
    const { result } = renderHook(() => useMetadataEdit(metadata, noTags));

    act(() => result.current.handleFieldChange('doi', '10.1000/example'));
    act(() => result.current.handleLockAll());

    expect(result.current.lockedFields['doi']).toBe(true);
    act(() => result.current.handleFieldChange('doi', '10.1000/other'));
    expect(result.current.editedMeta.doi).toBe('10.1000/example');
  });
});
