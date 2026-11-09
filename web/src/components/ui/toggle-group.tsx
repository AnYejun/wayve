"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { toggleVariants } from "@/components/ui/toggle"

/* ECHO / SYSTEM.md §3 — variant="segmented" is the OpenAI range control (Live · 10m · All):
   grey track, white raised pill. Identical to the default Tabs list. */

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
  }
>({
  size: "default",
  variant: "default",
  spacing: 0,
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
  }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-[10px] data-[variant=outline]:rounded-[8px]",
        "data-[spacing=0]:data-[variant=outline]:shadow-[0_1px_2px_rgb(23_21_15/.04)]",
        /* segmented track — same tokens as segmentedTrackClass in toggle.tsx */
        "data-[variant=segmented]:inline-flex data-[variant=segmented]:gap-0 data-[variant=segmented]:bg-[#f5f4f2] data-[variant=segmented]:p-[3px]",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)
  const v = context.variant || variant

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={v}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        toggleVariants({
          variant: v,
          size: context.size || size,
        }),
        "w-auto shrink-0 focus:z-10 focus-visible:z-10",
        v !== "segmented" && "min-w-0 px-3",
        /* joined (spacing 0) outline groups read as one bordered bar: square inner corners and single
           hairlines between items (each item draws top/bottom/right, the first also its left).
           Default (ghost) and segmented items keep their own radius-8 pills. */
        v === "outline" &&
          "data-[spacing=0]:rounded-none data-[spacing=0]:first:rounded-l-[8px] data-[spacing=0]:last:rounded-r-[8px] data-[spacing=0]:shadow-[inset_0_1px_0_rgb(23_21_15/.1),inset_0_-1px_0_rgb(23_21_15/.1),inset_-1px_0_0_rgb(23_21_15/.1)] data-[spacing=0]:first:shadow-[inset_0_0_0_1px_rgb(23_21_15/.1)]",
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
