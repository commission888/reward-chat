import type { ReactNode } from "react";

// The one page header. Before this, 12 of 13 routes hand-rolled the identical
// `<div><h1 class="text-2xl font-semibold">…</h1><p class="text-muted-foreground">…</p></div>`,
// and three of them wrapped it in their own flex row to hang a button off the
// right. Same markup, twelve chances to drift.
//
// The rule underneath is not decoration — it is the page's first structural
// line. It states where the header ends and content begins at the same x-edges
// as everything below it, which is what lets the rest of the page drop its
// card-shaped outlines: structure comes from alignment and rules, not from
// wrapping every region in a bordered box.
//
// Takes rendered nodes, not translation keys: `t()` needs a hook, and callers
// already hold it. That also lets CustomerDetailPage pass DB values (a customer
// name is data, not chrome — never translated).
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  // Right-hand controls that belong to the page as a whole (New shop, Upload).
  // Wraps under the title on narrow screens rather than squeezing it.
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-border pb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle ? <p className="mt-1 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
