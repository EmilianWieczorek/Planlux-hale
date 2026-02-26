import { useSyncExternalStore } from "react";
import { offerDraftStore } from "./offerDraftStore";

export function useOfferDraft() {
  const snapshot = useSyncExternalStore(
    offerDraftStore.subscribe,
    offerDraftStore.getSnapshot,
    offerDraftStore.getSnapshot
  );
  return { ...snapshot, actions: offerDraftStore };
}
