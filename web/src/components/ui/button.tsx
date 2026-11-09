import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/* ECHO / SYSTEM.md §3 + §6 — OpenAI-platform buttons with Apple detail:
   primary = ink, secondary/outline = white + hairline, ghost = quiet fg-2.
   Press = scale .98 for 120ms; focus-visible = 2px #17150f outline, 2px offset; disabled = .4. */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none",
    "transition-[background-color,color,box-shadow,opacity,scale] duration-120 ease-out",
    "active:scale-[.98] motion-reduce:active:scale-100",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
    "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40",
    "aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-destructive aria-invalid:outline-solid",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-[#17150f] text-white hover:bg-[#2c2922] active:bg-[#3A3A3C]",
        destructive: "bg-[#b91c1c] text-white hover:bg-[#991b1b] active:bg-[#B00011]",
        outline:
          "bg-white text-fg shadow-[inset_0_0_0_1px_rgb(23_21_15/.1),0_1px_2px_rgb(23_21_15/.04)] hover:bg-[#fafaf9] active:bg-[#f0efec]",
        secondary:
          "bg-white text-fg shadow-[inset_0_0_0_1px_rgb(23_21_15/.1),0_1px_2px_rgb(23_21_15/.04)] hover:bg-[#fafaf9] active:bg-[#f0efec]",
        ghost:
          "text-fg-2 hover:bg-[rgb(23_21_15/.05)] hover:text-fg active:bg-[rgb(23_21_15/.08)] aria-expanded:bg-[rgb(23_21_15/.05)] aria-expanded:text-fg",
        link: "text-[#17150f] underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-3.5 text-[14px] leading-5 has-[>svg]:px-3",
        xs: "h-7 gap-1 px-2.5 text-[12px] leading-4 has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3 text-[13px] leading-[18px] has-[>svg]:px-2.5",
        lg: "h-10 px-4 text-[15px] leading-5 has-[>svg]:px-3.5",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-[18px]",
      },
      shape: {
        default: "",
        pill: "rounded-full",
      },
    },
    compoundVariants: [
      { shape: "default", size: ["default", "lg", "icon", "icon-lg"], class: "rounded-[10px]" },
      { shape: "default", size: ["xs", "sm", "icon-xs", "icon-sm"], class: "rounded-[8px]" },
      { shape: "pill", size: "default", class: "px-4 has-[>svg]:px-3.5" },
      { shape: "pill", size: "sm", class: "px-3.5 has-[>svg]:px-3" },
      { shape: "pill", size: "lg", class: "px-5 has-[>svg]:px-4" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  shape = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-shape={shape}
      className={cn(buttonVariants({ variant, size, shape, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
