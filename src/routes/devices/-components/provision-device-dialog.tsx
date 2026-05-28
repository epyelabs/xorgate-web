import { useEffect, useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const INSTALL_COMMAND = `curl -s https://api.xorgate.ai/get/jwto2tvevik5iu5d -o install.sh
sudo bash install.sh`

export function ProvisionDeviceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND)
      setCopied(true)
    } catch {
      toast.error("Failed to copy to clipboard")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Provision device</DialogTitle>
          <DialogDescription>
            SSH into the remote device and run the commands below. The agent
            will register itself and appear in this list once it phones home.
          </DialogDescription>
        </DialogHeader>
        <div className="relative min-w-0">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 pr-10 font-mono text-xs/relaxed text-foreground">
            <code className="break-all whitespace-pre-wrap">
              {INSTALL_COMMAND}
            </code>
          </pre>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-2"
            onClick={handleCopy}
            aria-label="Copy install command"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Requires sudo. The installer pulls the latest agent build and
          configures it to talk to your workspace.
        </p>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
