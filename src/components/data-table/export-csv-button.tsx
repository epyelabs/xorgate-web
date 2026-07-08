import { DownloadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

// The standard "Export CSV" button, shared by the pagination footer and the
// footer-only (no pagination) case so every table's export looks identical.
export function ExportCsvButton({
  onClick,
  exporting = false,
  disabled = false,
}: {
  onClick: () => void
  exporting?: boolean
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5"
      onClick={onClick}
      disabled={exporting || disabled}
    >
      <DownloadIcon className="size-3.5" />
      {exporting ? "Exporting…" : "Export CSV"}
    </Button>
  )
}
