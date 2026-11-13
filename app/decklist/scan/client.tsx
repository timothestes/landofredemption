'use client';

import DeckPhotoReader from './components/DeckPhotoReader';
import HandoffBar from './components/HandoffBar';
import PhotoSteps from './components/PhotoSteps';

/** The reader's own page: the shared reader with the sticky copy / open-in-builder hand-off. */
export default function DeckScanClient({ userId }: { userId: string }) {
  return (
    <DeckPhotoReader
      userId={userId}
      intro={<PhotoSteps then="open it in the deck builder" />}
      hideTotals
      footer={({ state, dispatch, jumps }) => <HandoffBar state={state} dispatch={dispatch} jumps={jumps} />}
    />
  );
}
