import { cn } from "@/lib/utils"

/* ECHO / SYSTEM.md §6 — #f5f4f2, radius 6, soft pulse; static under reduced motion.
   Size it to the final layout so nothing shifts when data lands. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-[6px] bg-[#f5f4f2] motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
