'use client';

import DeckPhotoReader from './components/DeckPhotoReader';
import HandoffBar from './components/HandoffBar';

/** The reader's own page: the shared reader with the sticky copy / open-in-builder hand-off. */
export default function DeckScanClient({ userId }: { userId: string }) {
  return (
    <DeckPhotoReader
      userId={userId}
      footer={({ state, dispatch }) => <HandoffBar state={state} dispatch={dispatch} />}
    />
  );
}
