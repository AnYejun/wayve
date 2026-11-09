"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/* ECHO / SYSTEM.md §2 — toasts are .mat-float: white .86 + blur(24px) saturate(180%), 0.5px edge, e3 shadow,
   radius 12, 14px. Status glyphs in Apple system colours. Sonner injects its own unlayered CSS, so the few
   properties it hard-codes (shadow, border, padding, type) are overridden with `!`. */
const Toaster = ({ toastOptions, ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      gap={10}
      icons={{
        success: <CircleCheckIcon className="size-[18px] fill-[#58a069] text-white" strokeWidth={2} />,
        info: <InfoIcon className="size-[18px] fill-[#17150f] text-white" strokeWidth={2} />,
        warning: <TriangleAlertIcon className="size-[18px] fill-[#c6824b] text-white" strokeWidth={2} />,
        error: <OctagonXIcon className="size-[18px] fill-[#d07a70] text-white" strokeWidth={2} />,
        loading: <Loader2Icon className="size-4 animate-spin text-fg-2" />,
      }}
      style={
        {
          "--normal-bg": "rgb(255 255 255 / .86)",
          "--normal-text": "#17150f",
          "--normal-border": "transparent",
          "--border-radius": "12px",
          "--width": "360px",
        } as React.CSSProperties
      }
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast:
            "font-sans gap-2.5! px-4! py-3.5! text-[14px]! leading-5 border-0! backdrop-blur-[24px] backdrop-saturate-[1.8] shadow-[0_0_0_.5px_rgb(23_21_15/.12),0_2px_8px_rgb(23_21_15/.06),0_20px_50px_rgb(23_21_15/.14)]!",
          title: "font-medium! text-[14px]! leading-5! text-fg",
          description: "text-[13px]! leading-[18px]! text-fg-2!",
          icon: "size-[18px]! self-start mt-px",
          actionButton:
            "h-7! rounded-[8px]! px-2.5! text-[13px]! font-medium! bg-[#17150f]! text-white! hover:bg-[#2c2922]!",
          cancelButton:
            "h-7! rounded-[8px]! px-2.5! text-[13px]! font-medium! bg-[#f5f4f2]! text-fg!",
          closeButton:
            "size-5! bg-white! text-fg-2! border-[rgb(23_21_15/.1)]! shadow-[0_1px_2px_rgb(23_21_15/.06)] hover:text-fg!",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
