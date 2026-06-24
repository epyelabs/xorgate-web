import { useState } from "react"
import Editor from "@monaco-editor/react"
import { ChevronRightIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { setupMonaco } from "@/lib/monaco-setup"
import { cn } from "@/lib/utils"

setupMonaco()

// Collapsible read-only view of the full run record. The Monaco editor is only
// mounted while open so it always lays out against a sized, visible box.
export function RunRawJson({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false)
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  const text = JSON.stringify(data, null, 2)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-accent/50">
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        Raw JSON
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="h-96 border-t border-border">
          {open ? (
            <Editor
              height="100%"
              defaultLanguage="json"
              value={text}
              theme={isDark ? "vs-dark" : "light"}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbersMinChars: 3,
                folding: true,
                renderLineHighlight: "none",
              }}
            />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
