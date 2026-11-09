"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Separator as SeparatorPrimitive } from "radix-ui"

/* ECHO / SYSTEM.md §1 — hairline rgb(23 21 15/.08), drawn at 0.5px (rgb(23 21 15/.14)) on 2× screens like Apple. */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-[rgb(23_21_15/.08)] data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        "[@media(min-resolution:2dppx)]:bg-[rgb(23_21_15/.14)] [@media(min-resolution:2dppx)]:data-[orientation=horizontal]:h-[0.5px] [@media(min-resolution:2dppx)]:data-[orientation=vertical]:w-[0.5px]",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
