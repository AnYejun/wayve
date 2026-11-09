import * as React from "react"
import { cn } from "@/lib/utils"

/* ECHO / SYSTEM.md §1, §3 — 36px, radius 10, white, 1px rgb(23 21 15/.12) hairline (a border, so call sites that
   recolour `border-*` or pass `shadow-none` keep working). Focus = #17150f hairline + 3px rgb(23 21 15/.12) halo;
   aria-invalid = the red equivalents. 16px text below sm so iOS Safari never zooms on focus; 14px from sm up. */
const inputFieldClass = [
  "w-full min-w-0 rounded-[10px] border border-[rgb(23_21_15/.12)] bg-white text-fg",
  "text-[16px] leading-5 sm:text-[14px] placeholder:text-fg-3",
  "transition-[border-color,box-shadow,background-color] duration-120 ease-out outline-none",
  "selection:bg-[rgb(23_21_15/.12)] selection:text-fg",
  "hover:border-[rgb(23_21_15/.2)]",
  "focus-visible:border-[#17150f] focus-visible:shadow-[0_0_0_3px_rgb(23_21_15/.12)]",
  "aria-invalid:border-[#b91c1c] aria-invalid:focus-visible:border-[#b91c1c] aria-invalid:focus-visible:shadow-[0_0_0_3px_rgb(185_28_28/.16)]",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[#fafaf9] disabled:opacity-40",
].join(" ")

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputFieldClass,
        "h-9 px-3 py-0 [&[type=file]]:py-[5px] [&[type=file]]:ps-[5px] [&[type=file]]:text-[13px] [&[type=file]]:leading-6 [&[type=file]]:text-fg-2",
        "file:me-2 file:inline-flex file:h-6 file:items-center file:rounded-[6px] file:border-0 file:bg-[#f5f4f2] file:px-2 file:text-[13px] file:font-medium file:text-fg",
        className
      )}
      {...props}
    />
  )
}

export { Input, inputFieldClass }
