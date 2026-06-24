import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"

// Self-host Monaco via Vite instead of the default CDN loader, so the JSON
// editor works offline and ships with the bundle. Importing this module once
// (from json-editor.tsx) wires the web workers and points @monaco-editor/react
// at the local `monaco-editor` package.
let configured = false

export function setupMonaco() {
  if (configured) return
  configured = true

  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") return new jsonWorker()
      return new editorWorker()
    },
  }

  loader.config({ monaco })
}
