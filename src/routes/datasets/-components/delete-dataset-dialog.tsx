import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { DestroyDialog } from "@/components/destroy-dialog"
import { deleteDataset } from "@/lib/models-api"
import { xgMessage } from "@/lib/xorgate"
import type { DatasetDetail } from "@/lib/models-schemas"
import { useInvalidateModels } from "@/queries/models"

// Deleting a dataset drains every object under its prefix (items and every
// version's copies) and cascades the rows. Models trained from it keep their
// own files and their lineage names a dataset that no longer exists.
export function DeleteDatasetDialog({
  dataset,
  open,
  onOpenChange,
}: {
  dataset: DatasetDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const invalidate = useInvalidateModels()
  return (
    <DestroyDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete this dataset?"
      description={
        <>
          <span className="font-medium">{dataset.name}</span> has {dataset.itemCount} item
          {dataset.itemCount === 1 ? "" : "s"} and {dataset.versionCount} version
          {dataset.versionCount === 1 ? "" : "s"}.
        </>
      }
      warning="Every frame, annotation and version is deleted for good. Models already trained from it are kept."
      confirmText={dataset.slug}
      confirmLabel="Delete dataset"
      pendingLabel="Deleting…"
      onConfirm={async () => {
        try {
          await deleteDataset(dataset.id)
          toast.success("Dataset deleted")
          invalidate.datasets()
          navigate({ to: "/datasets" })
        } catch (err) {
          toast.error(xgMessage(err))
        }
      }}
    />
  )
}
