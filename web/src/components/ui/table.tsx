import * as React from "react"
import { cn } from "@/lib/utils"

/* ECHO / SYSTEM.md §4 (Live CRM) — header row 36px, 12px/500 fg-2 on #fafaf9, sticky inside its scroll container
   (give Table `containerClassName="max-h-[…]"` to make it scroll), bottom hairline drawn as a shadow so it travels
   with the sticky row. Body rows 44px, 14px, hairline rgb(23 21 15/.06), hover .02, selected accent .06.
   Cells pad 12×16; `numeric` right-aligns with tabular figures. */

function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom border-separate border-spacing-0 text-[14px] leading-5 text-fg",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("sticky top-0 z-10", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        "[&>tr:last-child>td]:shadow-none",
        className
      )}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-[#fafaf9] font-medium [&>tr>td]:shadow-[inset_0_1px_0_rgb(23_21_15/.08)]",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "transition-colors duration-120",
        "[tbody>&]:hover:bg-[rgb(23_21_15/.02)] [tbody>&]:has-aria-expanded:bg-[rgb(23_21_15/.02)]",
        "data-[state=selected]:bg-[rgb(23_21_15/.04)] aria-selected:bg-[rgb(23_21_15/.04)] [tbody>&]:data-[state=selected]:hover:bg-[rgb(23_21_15/.05)]",
        className
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      data-numeric={numeric || undefined}
      className={cn(
        "h-9 bg-[#fafaf9] px-4 text-left align-middle text-[12px] leading-4 font-medium whitespace-nowrap text-fg-2",
        "shadow-[inset_0_-1px_0_rgb(23_21_15/.08)]",
        "[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        numeric && "text-right tabular-nums",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      data-numeric={numeric || undefined}
      className={cn(
        "h-11 px-4 py-3 align-middle whitespace-nowrap",
        "shadow-[inset_0_-1px_0_rgb(23_21_15/.06)]",
        "[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        numeric && "text-right tabular-nums",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-3 text-[13px] leading-[18px] text-fg-3", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
