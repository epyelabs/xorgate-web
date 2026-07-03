import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CornerDownLeftIcon,
  SearchIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { searchGlobal, type SearchResult } from "@/lib/search-api"
import { SEARCH_RESOURCES } from "@/lib/search-resources"

// Debounce before hitting the search endpoint, and the minimum query length that
// triggers a request (mirrors the backend's `q.length < 2` short-circuit).
const DEBOUNCE_MS = 200
const MIN_QUERY_LENGTH = 2

function navigateToResult(
  navigate: ReturnType<typeof useNavigate>,
  result: SearchResult
) {
  // A literal `to` per case keeps TanStack Router's params fully type-checked.
  switch (result.type) {
    case "device":
      navigate({ to: "/devices/$id", params: { id: result.id } })
      break
    case "workflow-template":
      navigate({ to: "/workflow-templates/$id", params: { id: result.id } })
      break
    case "workflow-instance":
      navigate({ to: "/workflow-instances/$id", params: { id: result.id } })
      break
  }
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-[0.625rem] font-medium text-muted-foreground [&_svg]:size-3">
      {children}
    </kbd>
  )
}

// Keyboard guide shown in the palette footer.
function SearchFooter() {
  return (
    <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="flex gap-0.5">
          <Kbd>
            <ArrowDownIcon />
          </Kbd>
          <Kbd>
            <ArrowUpIcon />
          </Kbd>
        </span>
        Navigate
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>
          <CornerDownLeftIcon />
        </Kbd>
        Select
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>ESC</Kbd>
        Close
      </span>
    </div>
  )
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const modKey = useMemo(() => {
    const isMac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPod|iPad/.test(navigator.platform)
    return isMac ? "⌘" : "Ctrl "
  }, [])

  // ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  // Debounced, race-safe fetch. The `cancelled` guard drops stale responses so a
  // slow earlier request can't overwrite a newer one.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await searchGlobal(trimmed)
        if (!cancelled) setResults(res.results)
      } catch {
        if (!cancelled) {
          setResults([])
          toast.error("Search failed. Please try again.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setQuery("")
      setResults([])
      setLoading(false)
    }
  }

  function handleSelect(result: SearchResult) {
    handleOpenChange(false)
    navigateToResult(navigate, result)
  }

  const trimmed = query.trim()
  const hasQuery = trimmed.length >= MIN_QUERY_LENGTH
  const showEmpty = hasQuery && !loading && results.length === 0

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="h-8 justify-start gap-2 px-2.5 font-normal text-muted-foreground md:w-64"
      >
        <SearchIcon />
        <span className="hidden md:inline">Search</span>
        <kbd className="ml-auto hidden items-center rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.625rem] font-medium md:inline-flex">
          {modKey}K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        shouldFilter={false}
        className="sm:max-w-2xl"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search devices, workflows…"
        />
        <CommandList className="max-h-[400px]">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Searching…
            </p>
          ) : showEmpty ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </p>
          ) : (
            SEARCH_RESOURCES.map((resource) => {
              const items = results.filter((r) => r.type === resource.type)
              if (items.length === 0) return null
              const Icon = resource.icon
              return (
                <CommandGroup key={resource.type} heading={resource.label}>
                  {items.map((item) => (
                    <CommandItem
                      key={`${item.type}:${item.id}`}
                      value={`${item.type}:${item.id}`}
                      onSelect={() => handleSelect(item)}
                    >
                      <Icon />
                      <span className="truncate">{item.title}</span>
                      {item.subtitle ? (
                        <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })
          )}
        </CommandList>
        <SearchFooter />
      </CommandDialog>
    </>
  )
}
