"use client";

import * as RadixSelect from "@radix-ui/react-select";

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * Theme-aware dropdown built on Radix UI Select (the same headless primitive
 * shadcn/ui uses). Fully custom-styled via the `.dd-*` classes in globals.css
 * so it matches both light and dark themes, with keyboard nav, focus rings,
 * and a slide/fade open animation — none of which a native <select> gives.
 */
export function Dropdown({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: DropdownOption[];
  ariaLabel?: string;
  placeholder?: string;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger className="dd-trigger" aria-label={ariaLabel}>
        {/* Render the selected label deterministically from the controlled
            `value` prop instead of <RadixSelect.Value/>. Radix's Value resolves
            the display text from the <Item> children, which live inside a
            Portal/Content that is NOT server-rendered — so on the server it
            renders empty, then on the client it resolves to the label, causing
            a hydration mismatch (Next.js E394). Deriving from `value` makes
            server and client produce identical HTML. */}
        <span style={{ pointerEvents: "none" }}>
          {options.find((o) => o.value === value)?.label ?? placeholder ?? ""}
        </span>
        <RadixSelect.Icon className="dd-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          className="dd-content"
          position="popper"
          sideOffset={6}
          align="start"
        >
          <RadixSelect.Viewport className="dd-viewport">
            {/* Dedupe by value (keeps first label) and use a composite key so
                React never sees duplicate/undefined keys — Radix Select 2.3.x
                under React 19 otherwise logs a "unique key prop" dev warning
                that the Next.js overlay promotes to a full-screen error. */}
            {Array.from(
              options.reduce((m, o) => m.set(o.value, o), new Map<string, DropdownOption>()).values(),
            ).map((o, i) => (
              <RadixSelect.Item key={`${o.value}:${i}`} value={o.value} className="dd-item">
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="dd-indicator">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
