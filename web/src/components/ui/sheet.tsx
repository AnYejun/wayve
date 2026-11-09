import * as React from "react"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { closeButtonClass, descriptionClass, overlayClass, titleClass } from "@/components/ui/dialog"

/* ECHO / SYSTEM.md §2 — sheets are .mat-float with radius 16 on the inner edge only, padding 24.
   Enter is a 320ms expo-out slide (spring-like), exit 200ms ease-in. */

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(overlayClass, className)}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "mat-float fixed z-(--z-sheet) flex flex-col gap-5 p-6 text-fg outline-none",
          "data-[state=open]:animate-in data-[state=open]:duration-[320ms] data-[state=open]:ease-[cubic-bezier(.16,1,.3,1)]",
          "data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=closed]:ease-[cubic-bezier(.5,0,.75,0)]",
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 rounded-l-[16px] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-[400px]",
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 rounded-r-[16px] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-[400px]",
          side === "top" &&
            "inset-x-0 top-0 h-auto max-h-[85dvh] rounded-b-[16px] data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto max-h-[85dvh] rounded-t-[16px] pb-[calc(24px+var(--safe-b,0px))] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          showCloseButton && "[&>[data-slot=sheet-header]]:pe-10",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" className={closeButtonClass}>
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(titleClass, className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn(descriptionClass, className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
