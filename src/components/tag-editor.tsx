import { useState } from "react"
import { XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  MAX_TAGS_PER_TEMPLATE,
  MAX_TAG_LENGTH,
  normalizeTag,
} from "@/lib/workflow-schemas"

// Type a tag, press Enter (or comma, or Tab) to commit it; Backspace on an
// empty field removes the last one. Values are normalized here with the same
// rules the API applies, so what the chip shows is what will be stored, and a
// value that can never be a tag is refused inline rather than at the round trip.
export function TagEditor({
  tags,
  onChange,
  disabled,
  id = "tag-editor",
}: {
  tags: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  id?: string
}) {
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const full = tags.length >= MAX_TAGS_PER_TEMPLATE

  const commit = (raw: string): boolean => {
    const value = raw.trim()
    if (value === "") return true
    const tag = normalizeTag(value)
    if (tag === null) {
      setError(
        `"${value}" is not a valid tag: lowercase letters, digits, ".", "_" and "-", up to ${MAX_TAG_LENGTH} characters.`
      )
      return false
    }
    if (tags.includes(tag)) {
      // Already there; treat it as accepted so the field still clears.
      setError(null)
      return true
    }
    if (full) {
      setError(`A template can carry at most ${MAX_TAGS_PER_TEMPLATE} tags.`)
      return false
    }
    setError(null)
    onChange([...tags, tag])
    return true
  }

  const remove = (tag: string) => {
    setError(null)
    onChange(tags.filter((t) => t !== tag))
  }

  return (
    <div className="flex flex-col gap-2">
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1" data-testid="tag-editor-chips">
          {tags.map((tag) => (
            <Badge key={tag} variant="outline" className="pr-1">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground"
                disabled={disabled}
                onClick={() => remove(tag)}
              >
                <XIcon className="size-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <Input
        id={id}
        value={draft}
        disabled={disabled || full}
        maxLength={MAX_TAG_LENGTH}
        placeholder={
          full
            ? `At most ${MAX_TAGS_PER_TEMPLATE} tags`
            : "Add a tag, then press Enter"
        }
        onChange={(e) => {
          const value = e.target.value
          // A typed comma is a separator, matching how the filter is spelled.
          if (value.includes(",")) {
            if (commit(value.slice(0, value.indexOf(",")))) setDraft("")
            return
          }
          setDraft(value)
          if (error) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") {
            if (draft.trim() === "") return
            e.preventDefault()
            if (commit(draft)) setDraft("")
            return
          }
          if (e.key === "Backspace" && draft === "" && tags.length > 0) {
            remove(tags[tags.length - 1])
          }
        }}
        onBlur={() => {
          if (commit(draft)) setDraft("")
        }}
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Tags are how a program finds this template through the API. Lowercase,
          up to {MAX_TAGS_PER_TEMPLATE}.
        </p>
      )}
    </div>
  )
}
