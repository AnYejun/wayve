import { cn } from "@/lib/utils"

/* ECHO / SYSTEM.md §3 — key caps: 20px, radius 5, #f5f4f2, 11px/500 fg-2. Inside a (dark) tooltip they invert. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-0.5 rounded-[5px] bg-[#f5f4f2] px-1 font-sans text-[11px] leading-none font-medium text-fg-2 tabular-nums select-none",
        "[&_svg:not([class*='size-'])]:size-3",
        "[[data-selected=true]_&]:bg-white [[data-highlighted]_&]:bg-white",
        "[[data-slot=tooltip-content]_&]:bg-white/15 [[data-slot=tooltip-content]_&]:text-white",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
