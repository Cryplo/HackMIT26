import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] aria-expanded:bg-[var(--primary-active)] aria-pressed:bg-[var(--primary-active)] disabled:border-border disabled:bg-muted disabled:text-muted-foreground",
        outline:
          "border-input bg-background text-foreground hover:border-primary hover:bg-accent active:bg-sidebar-accent aria-expanded:border-primary aria-expanded:bg-sidebar-accent aria-pressed:border-primary aria-pressed:bg-sidebar-accent",
        secondary:
          "border-input bg-secondary text-secondary-foreground hover:border-primary hover:bg-accent active:bg-sidebar-accent aria-expanded:border-primary aria-expanded:bg-sidebar-accent aria-pressed:border-primary aria-pressed:bg-sidebar-accent",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-sidebar-accent aria-expanded:bg-sidebar-accent aria-expanded:text-primary aria-pressed:bg-sidebar-accent aria-pressed:text-primary",
        destructive:
          "bg-destructive text-white hover:bg-[color-mix(in_srgb,var(--destructive),black_12%)] active:bg-[color-mix(in_srgb,var(--destructive),black_22%)] focus-visible:ring-destructive",
        success:
          "bg-[var(--status-good)] text-white hover:bg-[color-mix(in_srgb,var(--status-good),black_12%)] active:bg-[color-mix(in_srgb,var(--status-good),black_22%)] focus-visible:ring-[var(--status-good)]",
        link: "text-primary underline underline-offset-4 hover:text-[var(--primary-hover)] active:text-[var(--primary-active)]",
      },
      size: {
        default:
          "h-10 gap-2 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-10",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
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
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
