import { cn } from "@/lib/utils"

// Ported from xorgate-landing/components/section.tsx. Geometric accents:
// quiet marks mixed from the muted-foreground token, so they carry in both
// themes without ever spending the brand-accent budget. Always aria-hidden,
// and each one bleeds off a corner (or vignettes the whole surface) behind a
// radial mask so it dissolves before it reaches the content.
export type Accent =
  | "dots-tr"
  | "dots-bl"
  | "hatch-tr"
  | "hatch-bl"
  | "grid-tr"
  | "grid-bl"
  | "grid-br"
  | "grid-full"

// Written out in full on purpose: Tailwind extracts class names statically,
// so a helper that builds these strings would generate no CSS at all.
const patterns = {
  dots: "[background-image:radial-gradient(color-mix(in_oklab,var(--muted-foreground)_55%,transparent)_1px,transparent_1px)] [background-size:22px_22px]",
  hatch:
    "[background-image:repeating-linear-gradient(45deg,color-mix(in_oklab,var(--muted-foreground)_20%,transparent)_0_1px,transparent_1px_11px)]",
  grid: "[background-image:repeating-linear-gradient(to_right,color-mix(in_oklab,var(--muted-foreground)_4%,transparent)_0_1px,transparent_1px_16px),repeating-linear-gradient(to_bottom,color-mix(in_oklab,var(--muted-foreground)_4%,transparent)_0_1px,transparent_1px_16px)]",
}

const masks = {
  tr: "[mask-image:radial-gradient(42rem_28rem_at_100%_0%,black,transparent_70%)]",
  bl: "[mask-image:radial-gradient(42rem_28rem_at_0%_100%,black,transparent_70%)]",
  br: "[mask-image:radial-gradient(38rem_20rem_at_100%_100%,black,transparent_72%)]",
  full: "[mask-image:radial-gradient(120%_110%_at_50%_40%,black_25%,transparent_85%)]",
}

export function AccentField({ variant }: { variant: Accent }) {
  const [pattern, corner] = variant.split("-") as [
    keyof typeof patterns,
    keyof typeof masks,
  ]

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10",
        patterns[pattern],
        masks[corner]
      )}
    />
  )
}
