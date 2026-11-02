import clsx from 'clsx';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Position } from '@/utils/sel';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import Popup from '@/components/Popup';
import AnnotationToolButton from './AnnotationToolButton';
import AnnotationNoteEditor from './AnnotationNoteEditor';
import AnnotationNotes from './AnnotationNotes';
import HighlightOptions from './HighlightOptions';

export interface AnnotationNoteEditorTarget {
  value: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}

interface AnnotationPopupProps {
  bookKey: string;
  dir: 'ltr' | 'rtl';
  isVertical: boolean;
  buttons: Array<{
    tooltipText: string;
    Icon: React.ElementType;
    onClick: () => void;
    disabled?: boolean;
    visible?: boolean;
  }>;
  notes: BookNote[];
  /**
   * Set while the Annotate action is collecting a note for the selection. It
   * takes over the popup body: the toolbar's job is done, and the note the
   * user is typing is the only thing they care about (#5987).
   */
  noteEditor?: AnnotationNoteEditorTarget | null;
  /** Opens `noteEditor` on an existing note (the bubble's pencil). */
  onEditNote?: (note: BookNote) => void;
  position: Position;
  trianglePosition: Position;
  highlightOptionsVisible: boolean;
  selectedStyle: HighlightStyle;
  selectedColor: HighlightColor;
  popupWidth: number;
  popupHeight: number;
  globalToggleAvailable?: boolean;
  globalToggleActive?: boolean;
  onToggleGlobal?: () => void;
  onHighlight: (update?: boolean) => void;
  onDismiss: () => void;
}

const AnnotationPopup: React.FC<AnnotationPopupProps> = ({
  bookKey,
  dir,
  isVertical,
  buttons,
  notes,
  noteEditor,
  onEditNote,
  position,
  trianglePosition,
  highlightOptionsVisible,
  selectedStyle,
  selectedColor,
  popupWidth,
  popupHeight,
  globalToggleAvailable,
  globalToggleActive,
  onToggleGlobal,
  onHighlight,
  onDismiss,
}) => {
  // The note card replaces the 44px toolbar body; 1.5× the doubled toolbar
  // footprint (the size users first asked for) leaves room to write a note.
  const noteEditorSize = useResponsiveSize(540);
  // The popup's own box, with the vertical-writing swap already applied — the
  // same values AnnotationNotes and HighlightOptions are handed.
  const boxWidth = isVertical ? popupHeight : popupWidth;
  const boxHeight = isVertical ? popupWidth : popupHeight;
  // The card overgrows the toolbar box towards the free side of the selection,
  // so measure the reader cell to keep it on screen: the growth axis is capped
  // by the room between the toolbar and the cell edge, the cross axis by the
  // cell extent, flipping the card's anchored edge when it would overflow.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => setCell({ width: wrap.clientWidth, height: wrap.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);
  const pad = useResponsiveSize(10);
  const cellWidth = cell.width || Number.POSITIVE_INFINITY;
  const cellHeight = cell.height || Number.POSITIVE_INFINITY;
  const growthRoom =
    trianglePosition.dir === 'up'
      ? position.point.y + boxHeight - pad
      : trianglePosition.dir === 'down'
        ? cellHeight - position.point.y - pad
        : trianglePosition.dir === 'left'
          ? position.point.x + boxWidth - pad
          : cellWidth - position.point.x - pad;
  const shortSide = Math.min(noteEditorSize, growthRoom);
  const crossSide = isVertical
    ? Math.min(3 * boxHeight, cellHeight - 2 * pad)
    : Math.min(3 * boxWidth, cellWidth - 2 * pad);
  const crossAnchoredAtStart = isVertical
    ? position.point.y + crossSide <= cellHeight - pad
    : position.point.x + crossSide <= cellWidth - pad;
  return (
    // The toolbar opens against the selection, which is where the range
    // editors' handles hang: the two overlap by design, and whichever layer
    // wins owns those pixels. The handles are grab targets, so they take it —
    // under the toolbar their covered part stops dragging and fires whichever
    // tool button it landed on instead. Hence z-[43], below the handle layer
    // (z-[44]) but still above the paragraph/TTS chrome (z-40) and the
    // footnote popup (z-[42]), whose text this toolbar also opens against
    // (#6145). Every popup opened *from* the toolbar stays at z-50 and above
    // the handles, so the wrapper is only here to put this one at 43.
    //
    // `absolute`, never `fixed`: `position` is in the book cell's coordinate
    // space (Annotator subtracts `#gridcell-<bookKey>`'s rect), and the cell
    // is the popup's `relative` ancestor. A fixed wrapper re-anchors the popup
    // to the viewport, which drops it `cell.left` px to the left of the
    // selection the moment the cell leaves the viewport origin — sidebar open,
    // or any book past the first in a split view. Inset to the cell, this
    // still makes the stacking context without moving anything.
    // `pointer-events-none` keeps the cell-covering wrapper from swallowing
    // the taps outside the popup that dismiss it.
    <div dir={dir} ref={wrapRef} className='pointer-events-none absolute inset-0 z-[43]'>
      <Popup
        width={boxWidth}
        height={boxHeight}
        minHeight={boxHeight}
        position={position}
        trianglePosition={trianglePosition}
        className={clsx(
          'selection-popup pointer-events-auto',
          (notes.length > 0 || noteEditor) && 'bg-transparent',
        )}
        onDismiss={onDismiss}
      >
        <div className={clsx('flex h-full gap-4', isVertical ? 'flex-row' : 'flex-col')}>
          <div
            className={clsx(
              'selection-buttons flex h-full w-full items-center justify-between p-2',
              isVertical ? 'flex-col overflow-y-auto' : 'flex-row overflow-x-auto',
              (notes.length > 0 || noteEditor) && 'hidden',
            )}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {buttons.map((button, index) => {
              if (button.visible === false) return null;
              return (
                <AnnotationToolButton
                  key={index}
                  showTooltip={!highlightOptionsVisible}
                  tooltipText={button.tooltipText}
                  Icon={button.Icon}
                  onClick={button.onClick}
                  disabled={button.disabled}
                />
              );
            })}
          </div>
          {noteEditor ? (
            <AnnotationNoteEditor
              value={noteEditor.value}
              isVertical={isVertical}
              // Same chrome recipe as Popup's own container, so the editor
              // reads as a panel over the page rather than a shadowless block
              // in the page's own colour.
              className={clsx(
                'annotation-note-editor popup-container text-base-content absolute rounded-lg border',
                'not-eink:border-base-content/20 not-eink:shadow-2xl',
                'bg-base-300 theme-dark:bg-base-100',
              )}
              // Anchored to the popup's triangle edge and grown away from it,
              // exactly like AnnotationNotes, so the editor covers the toolbar
              // instead of drifting off the selection.
              style={
                isVertical
                  ? {
                      right: trianglePosition.dir === 'left' ? 0 : undefined,
                      left: trianglePosition.dir === 'right' ? 0 : undefined,
                      top: crossAnchoredAtStart ? 0 : undefined,
                      bottom: crossAnchoredAtStart ? undefined : 0,
                      height: `${crossSide}px`,
                      width: `${shortSide}px`,
                    }
                  : {
                      top: trianglePosition.dir === 'down' ? 0 : undefined,
                      bottom: trianglePosition.dir === 'up' ? 0 : undefined,
                      left: crossAnchoredAtStart ? 0 : undefined,
                      right: crossAnchoredAtStart ? undefined : 0,
                      width: `${crossSide}px`,
                      height: `${shortSide}px`,
                    }
              }
              onSave={noteEditor.onSave}
              onCancel={noteEditor.onCancel}
            />
          ) : notes.length > 0 ? (
            <AnnotationNotes
              bookKey={bookKey}
              isVertical={isVertical}
              notes={notes}
              onEditNote={onEditNote}
              toolsVisible={false}
              triangleDir={trianglePosition.dir!}
              popupWidth={boxWidth}
              popupHeight={boxHeight}
              onDismiss={onDismiss}
            />
          ) : (
            highlightOptionsVisible && (
              <HighlightOptions
                compact={buttons.filter((button) => button.visible !== false).length <= 4}
                isVertical={isVertical}
                triangleDir={trianglePosition.dir!}
                popupWidth={boxWidth}
                popupHeight={boxHeight}
                selectedStyle={selectedStyle}
                selectedColor={selectedColor}
                globalToggleAvailable={globalToggleAvailable}
                globalToggleActive={globalToggleActive}
                onToggleGlobal={onToggleGlobal}
                onHandleHighlight={onHighlight}
                onDismiss={onDismiss}
              />
            )
          )}
        </div>
      </Popup>
    </div>
  );
};

export default AnnotationPopup;
