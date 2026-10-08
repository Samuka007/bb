import type { PickerOption } from "./OptionPicker";

/** A model option can expose a distinct runtime route beside its friendly name. */
export interface ModelPickerOption extends PickerOption<string> {
  routeProviderId?: string;
  /**
   * The option is not in the active provider directory (selected-only pool).
   * Deployments that fail such dispatches closed label it in the picker
   * instead of rendering it as an ordinary runnable choice (#486).
   */
  unavailable?: boolean;
}
