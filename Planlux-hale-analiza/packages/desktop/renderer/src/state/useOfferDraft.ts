import { useSyncExternalStore } from "react";
import { offerDraftStore } from "./offerDraftStore";

export function useOfferDraft() {
  const state = useSyncExternalStore(
    offerDraftStore.subscribe,
    () => offerDraftStore.getState(),
    () => offerDraftStore.getState()
  );
  return { ...state, actions: offerDraftStore };
}
