import * as React from "react"
import { cn } from "@/lib/utils"

/* ECHO / SYSTEM.md §1, §4 — cards are opaque white, radius 12, 1px rgb(23 21 15/.1) border, no drop shadow.
   Header/content/footer pad 20px. CardGrid = the OpenAI "one card split by hairlines" KPI grid. */

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-4 rounded-[12px] border border-[rgb(23_21_15/.1)] bg-white py-5 text-fg",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 px-5 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:border-[rgb(23_21_15/.08)] [.border-b]:pb-4",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-[15px] leading-5 font-semibold tracking-[-0.01em] text-fg",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-[13px] leading-[18px] text-fg-2", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-5 text-[14px] leading-5", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center gap-2 px-5 [.border-t]:border-[rgb(23_21_15/.08)] [.border-t]:pt-4",
        className
      )}
      {...props}
    />
  )
}

/* ── CardGrid — one bordered card split into cells by hairlines that never double.
   The inner grid overhangs the card by 1px on the right and bottom, so the last column's right line and the
   last row's bottom line fall outside and are clipped by the card's overflow. Works for any column count,
   responsive columns and ragged last rows. */
const cardGridCols = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
} as const

function CardGrid({
  className,
  gridClassName,
  cols = 3,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Column count at the widest breakpoint (responsive steps are built in). */
  cols?: keyof typeof cardGridCols
  /** Override the inner grid's classes, e.g. `grid-cols-3` for a fixed grid. */
  gridClassName?: string
}) {
  return (
    <div
      data-slot="card-grid"
      className={cn(
        "overflow-hidden rounded-[12px] border border-[rgb(23_21_15/.1)] bg-white text-fg",
        className
      )}
      {...props}
    >
      <div
        data-slot="card-grid-inner"
        className={cn("-me-px -mb-px grid", cardGridCols[cols], gridClassName)}
      >
        {children}
      </div>
    </div>
  )
}

function CardGridItem({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-grid-item"
      className={cn(
        "min-w-0 border-e border-b border-[rgb(23_21_15/.08)] p-5",
        "[@media(min-resolution:2dppx)]:border-e-[0.5px] [@media(min-resolution:2dppx)]:border-b-[0.5px] [@media(min-resolution:2dppx)]:border-[rgb(23_21_15/.14)]",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  CardGrid,
  CardGridItem,
}
