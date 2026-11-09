"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Avatar as AvatarPrimitive } from "radix-ui"

/* ECHO / SYSTEM.md §0 (Monogram) — flat circles, no orbs. tone="neutral" = #eeede9 with fg-2 initials;
   tone="ink" = #17150f with white (the "self/account" monogram, as on OpenAI).
   Sizes: sm 24, default 32, lg 40, xl 48. AvatarBadge = the 8px #58a069 live dot with a 2px white ring. */

function Avatar({
  className,
  size = "default",
  tone = "neutral",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg" | "xl"
  tone?: "neutral" | "ink"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-tone={tone}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6 data-[size=xl]:size-12",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full rounded-full object-cover", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center overflow-hidden rounded-full bg-[#eeede9] text-[12px] leading-none font-semibold tracking-[-0.01em] text-fg-2 tabular-nums",
        "group-data-[tone=ink]/avatar:bg-[#17150f] group-data-[tone=ink]/avatar:text-white",
        "group-data-[size=sm]/avatar:text-[10px] group-data-[size=lg]/avatar:text-[14px] group-data-[size=xl]/avatar:text-[17px]",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute -right-px -bottom-px z-10 inline-flex items-center justify-center rounded-full bg-[#58a069] text-white ring-2 ring-white select-none",
        "group-data-[size=sm]/avatar:size-1.5 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2 group-data-[size=default]/avatar:[&>svg]:hidden",
        "group-data-[size=lg]/avatar:size-2.5 group-data-[size=lg]/avatar:[&>svg]:size-2",
        "group-data-[size=xl]/avatar:size-3 group-data-[size=xl]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-white",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f5f4f2] text-[12px] font-medium text-fg-2 tabular-nums ring-2 ring-white group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 group-has-data-[size=xl]/avatar-group:size-12 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
}
