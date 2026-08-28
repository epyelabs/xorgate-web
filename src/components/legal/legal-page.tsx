import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { XorgateLogo } from "@/components/xorgate-logo"
import { AccentField } from "@/components/accent-field"
import { LEGAL } from "./legal-facts"

export interface LegalSection {
  id: string
  title: string
  body: ReactNode
}

const DOCS = [
  { to: "/terms", label: "Terms of Service" },
  { to: "/privacy", label: "Privacy Policy" },
] as const

// Chrome-free page used by /privacy and /terms. It renders identically for
// signed-out visitors and signed-in users (the root layout skips the app
// shell for these routes), so the document reads the same from the login
// page footer as it does from a bookmarked link.
export function LegalPage({
  title,
  summary,
  current,
  sections,
}: {
  title: string
  summary: string
  current: (typeof DOCS)[number]["to"]
  sections: LegalSection[]
}) {
  return (
    <div className="relative isolate min-h-svh bg-shell">
      <AccentField variant="grid-tr" />
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 pt-8 md:px-10">
        <a href="/" aria-label="xorgate">
          <XorgateLogo className="h-6 w-auto text-brand" />
        </a>
        <nav aria-label="Legal documents" className="flex gap-4 text-sm">
          {DOCS.map((doc) => (
            <Link
              key={doc.to}
              to={doc.to}
              className={
                doc.to === current
                  ? "font-medium text-foreground"
                  : "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              }
              aria-current={doc.to === current ? "page" : undefined}
            >
              {doc.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-12 md:px-10 md:py-16">
        <article>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Effective {LEGAL.effectiveDate}
          </p>
          <p className="mt-6 text-base leading-7 text-muted-foreground">
            {summary}
          </p>

          <nav
            aria-label="Contents"
            className="mt-8 rounded-lg border bg-card p-5 text-sm"
          >
            <p className="font-medium">Contents</p>
            <ol className="mt-3 grid list-decimal gap-1.5 pl-5 md:grid-cols-2">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-10 space-y-10">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-8"
                aria-labelledby={`${section.id}-heading`}
              >
                <h2
                  id={`${section.id}-heading`}
                  className="text-xl font-semibold tracking-tight"
                >
                  {index + 1}. {section.title}
                </h2>
                <div className="legal-prose mt-3 space-y-3 text-[15px] leading-7 text-foreground/90 [&_a]:underline [&_a]:underline-offset-4 [&_h3]:mt-5 [&_h3]:font-medium [&_h3]:text-foreground [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6">
                  {section.body}
                </div>
              </section>
            ))}
          </div>
        </article>

        <footer className="mt-16 border-t pt-6 text-sm text-muted-foreground">
          <p>
            Questions about this document? Email{" "}
            <a
              href={`mailto:${LEGAL.contactEmail}`}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {LEGAL.contactEmail}
            </a>
            .
          </p>
          <p className="mt-2">
            &copy; {new Date().getFullYear()} {LEGAL.company}. All rights
            reserved.
          </p>
        </footer>
      </main>
    </div>
  )
}
