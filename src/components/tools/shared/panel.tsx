"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function PanelTooltips({ children }: { children: ReactNode }) {
  return <TooltipProvider delayDuration={200}>{children}</TooltipProvider>;
}

export function PanelSection({
  icon: Icon,
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  icon: LucideIcon;
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="flex-1 text-sm font-medium">{title}</span>
        {summary ? (
          <span className="max-w-[9rem] truncate text-[11px] tabular-nums text-muted-foreground">
            {summary}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          id={contentId}
          role="region"
          aria-label={title}
          className="space-y-4 border-t px-3 py-3"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  title?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  columns = 2,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentOption<T>[];
  label: string;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid gap-1 rounded-lg bg-muted p-1",
        columns === 4
          ? "grid-cols-4"
          : columns === 3
            ? "grid-cols-3"
            : "grid-cols-2",
        className
      )}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon, title }) => {
        const active = optionValue === value;
        return (
          <button
            key={optionValue}
            type="button"
            title={title}
            aria-pressed={active}
            onClick={() => onValueChange(optionValue)}
            className={cn(
              "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-background text-foreground shadow-sm dark:bg-input/50"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
            <span className="truncate">{optionLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

export function IconAction({
  label,
  icon: Icon,
  onClick,
  active = false,
  disabled = false,
  className,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant={active ? "default" : "outline"}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={className}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Field({
  label,
  value,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  value?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {value !== undefined && value !== null ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {value}
          </span>
        ) : null}
      </div>
      {children}
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

export function Hint({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[11px] leading-snug text-muted-foreground",
        className
      )}
    >
      {children}
    </p>
  );
}

export function GroupLabel({
  icon: Icon,
  children,
}: {
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </p>
  );
}

export function ToggleButton({
  active,
  onClick,
  icon: Icon,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      onClick={onClick}
      className={cn("justify-start", className)}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </Button>
  );
}
