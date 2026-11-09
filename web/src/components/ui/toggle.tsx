import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

/* ECHO / SYSTEM.md §3 — the OpenAI segmented control, shared by Tabs (default variant) and
   ToggleGroup variant="segmented" so both read as one control:
   track #f5f4f2, radius 10, 3px padding, 32px tall; active = white radius-8 pill with the segmented shadow. */
const segmentedTrackClass =
  "inline-flex h-8 w-fit items-center gap-0 rounded-[10px] bg-[#f5f4f2] p-[3px] text-fg-2"

const segmentedItemClass = [
  "relative inline-flex h-full items-center justify-center gap-1.5 rounded-[8px] px-3",
  "text-[13px] leading-[18px] font-medium whitespace-nowrap text-fg-2 select-none",
  "transition-[background-color,color,box-shadow] duration-120 ease-out hover:text-fg",
  "data-[state=active]:bg-white data-[state=active]:text-fg data-[state=active]:shadow-[0_1px_2px_rgb(23_21_15/.06),0_1px_1px_rgb(23_21_15/.04)]",
  "data-[state=on]:bg-white data-[state=on]:text-fg data-[state=on]:shadow-[0_1px_2px_rgb(23_21_15/.06),0_1px_1px_rgb(23_21_15/.04)]",
  "outline-none focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid",
  "disabled:pointer-events-none disabled:opacity-40",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
].join(" ")

const toggleVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 rounded-[8px] font-medium whitespace-nowrap select-none text-fg-2",
    "transition-[background-color,color,box-shadow,scale] duration-120 ease-out",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
    "disabled:pointer-events-none disabled:opacity-40",
    "aria-invalid:shadow-[inset_0_0_0_1px_#b91c1c]",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-transparent hover:bg-[rgb(23_21_15/.05)] hover:text-fg active:bg-[rgb(23_21_15/.08)] data-[state=on]:bg-[rgb(23_21_15/.06)] data-[state=on]:text-fg",
        outline:
          "bg-white text-fg shadow-[inset_0_0_0_1px_rgb(23_21_15/.1),0_1px_2px_rgb(23_21_15/.04)] hover:bg-[#fafaf9] data-[state=on]:bg-[#f5f4f2]",
        segmented: segmentedItemClass,
      },
      size: {
        default: "h-9 min-w-9 px-2.5 text-[14px] leading-5",
        sm: "h-8 min-w-8 px-2 text-[13px] leading-[18px]",
        lg: "h-10 min-w-10 px-3 text-[15px] leading-5",
      },
    },
    compoundVariants: [
      /* segmented items fill the track; the track (ToggleGroup) sets the height */
      { variant: "segmented", size: "default", class: "h-[26px] min-w-0 px-3 text-[13px] leading-[18px]" },
      { variant: "segmented", size: "sm", class: "h-[22px] min-w-0 px-2.5 text-[12px] leading-4" },
      { variant: "segmented", size: "lg", class: "h-[30px] min-w-0 px-3.5 text-[14px] leading-5" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      data-variant={variant ?? "default"}
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants, segmentedTrackClass, segmentedItemClass }
