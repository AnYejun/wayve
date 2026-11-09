import * as React from "react"
import { cn } from "@/lib/utils"

import { inputFieldClass } from "@/components/ui/input"

/* ECHO / SYSTEM.md §3 — same field material as Input (radius 10, inset hairline, blue focus halo). */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        inputFieldClass,
        "flex field-sizing-content min-h-[76px] resize-y px-3 py-2",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
