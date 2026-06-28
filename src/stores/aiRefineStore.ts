import { create } from 'zustand';

// Hand-off channel between the create-basket form and the full-screen
// description-refinement page (app/business/refine-description.tsx). The form
// writes `input` and navigates; the page runs the Q&A loop and, on accept,
// writes the final {fr,en,ar} `result` and navigates back; the form applies the
// result on focus and clears it. Kept deliberately tiny (no persistence — this
// is a transient in-session hand-off, not state to survive a relaunch).

export type RefineTrio = { fr: string; en: string; ar: string };

interface AiRefineState {
  /** What the form hands to the page when starting a refinement. `title` is the
   *  basket name, given to the model as context for tailored questions. */
  input: { description: string; title?: string; category?: string } | null;
  /** What the page hands back when the merchant accepts a final version. */
  result: RefineTrio | null;
  setInput: (input: { description: string; title?: string; category?: string } | null) => void;
  setResult: (result: RefineTrio | null) => void;
  clear: () => void;
}

export const useAiRefineStore = create<AiRefineState>((set) => ({
  input: null,
  result: null,
  setInput: (input) => set({ input }),
  setResult: (result) => set({ result }),
  clear: () => set({ input: null, result: null }),
}));
