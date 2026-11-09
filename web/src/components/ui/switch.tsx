import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

/* ECHO / SYSTEM.md §3 — maru switch: 40×24 (sm 32×20), on ink, off #e4e3df, white thumb with
   0 1px 2px rgb(23 21 15/.2), 200ms spring-ish ease. Focus = 2px #17150f outline, 2px offset. */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5",
        "transition-[background-color] duration-200 ease-[cubic-bezier(.25,1,.5,1)]",
        "data-[state=checked]:bg-[#17150f] data-[state=unchecked]:bg-[#e4e3df] data-[state=unchecked]:hover:bg-[#d5d5d4]",
        "data-[size=default]:h-6 data-[size=default]:w-10 data-[size=sm]:h-5 data-[size=sm]:w-8",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-[0_1px_2px_rgb(23_21_15/.2),0_0_0_.5px_rgb(23_21_15/.04)]",
          "transition-transform duration-200 ease-[cubic-bezier(.34,1.36,.64,1)] motion-reduce:transition-none",
          "group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-4",
          "data-[state=unchecked]:translate-x-0 group-data-[size=default]/switch:data-[state=checked]:translate-x-4 group-data-[size=sm]/switch:data-[state=checked]:translate-x-3"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
