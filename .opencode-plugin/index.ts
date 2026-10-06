import adapter from "../scripts/opencode-plugin.js";

// The V2 plugin definition is a plain object. Keeping this adapter dependency-
// free lets a Git checkout load without installing a second OpenCode runtime.
export default { id: "pm", setup: adapter.setup };
