import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"

// Self-host Monaco via Vite instead of the default CDN loader, so the JSON
// editor works offline and ships with the bundle. Importing this module once
// (from json-editor.tsx) wires the web workers and points @monaco-editor/react
// at the local `monaco-editor` package. The typescript worker backs the
// JavaScript language service in the Code Function editor; Python gets
// syntax highlighting only (basic-languages, no worker needed).
let configured = false

export function setupMonaco() {
  if (configured) return
  configured = true

  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") return new jsonWorker()
      if (label === "javascript" || label === "typescript") return new tsWorker()
      return new editorWorker()
    },
  }

  loader.config({ monaco })
}
