import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/* ECHO / SYSTEM.md §1, §3 — 22px tags, radius 6, 12px/500. Tinted fills, never outlines-on-colour.
   `dot` adds a 6px leading dot (live = #d07a70, success = #58a069); `dot="pulse"` adds the live ping
   (the one looping motion SYSTEM.md allows). */
const badgeVariants = cva(
  [
    "inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[6px] px-2",
    "text-[12px] leading-4 font-medium whitespace-nowrap tabular-nums",
    "transition-[color,background-color,box-shadow] duration-120",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
    "aria-invalid:shadow-[inset_0_0_0_1px_#b91c1c]",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
    "has-data-[slot=badge-dot]:pl-[7px]",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-[#f5f4f2] text-fg-2 [a&]:hover:bg-[#eeede9]",
        secondary:
          "bg-white text-fg shadow-[inset_0_0_0_1px_rgb(23_21_15/.1)] [a&]:hover:bg-[#fafaf9]",
        outline:
          "bg-white text-fg shadow-[inset_0_0_0_1px_rgb(23_21_15/.1)] [a&]:hover:bg-[#fafaf9]",
        new: "bg-[#eee7ff] text-[#6a578b] [a&]:hover:bg-[#e6dcff]",
        live: "bg-[#fee4e1] text-[#b91c1c] [a&]:hover:bg-[#fcd9d4] [&>[data-slot=badge-dot]]:bg-[#d07a70]",
        demo: "bg-[#fee6d5] text-[#86552e] [a&]:hover:bg-[#fcdcc4]",
        success:
          "bg-[#dcf2df] text-[#376c45] [a&]:hover:bg-[#DFF3E5] [&>[data-slot=badge-dot]]:bg-[#58a069]",
        ink: "bg-[#17150f] text-white [a&]:hover:bg-[#2c2922]",
        destructive: "bg-[#b91c1c] text-white [a&]:hover:bg-[#991b1b]",
        ghost: "bg-transparent text-fg-2 [a&]:hover:bg-[rgb(23_21_15/.05)] [a&]:hover:text-fg",
        link: "bg-transparent px-0 text-[#17150f] underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  dot = false,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
    /** Leading status dot. `"pulse"` adds the live ping ring. */
    dot?: boolean | "pulse"
  }) {
  const Comp = asChild ? Slot.Root : "span"
  const dotEl = dot ? (
    <span
      data-slot="badge-dot"
      aria-hidden="true"
      className="relative size-1.5 shrink-0 rounded-full bg-current"
    >
      {dot === "pulse" && (
        <span className="absolute inset-0 rounded-full bg-inherit animate-live-ping motion-reduce:hidden" />
      )}
    </span>
  ) : null

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {dotEl}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Badge, badgeVariants }
