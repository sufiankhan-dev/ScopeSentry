"use client";

import { Button } from "@/components/ui/button";
import { ArrowDown } from "lucide-react";

/**
 * The page's call to action, wherever it is placed.
 *
 * It is a real button rather than an anchor so it can put the caret in the
 * agreement field: arriving at a form should mean being able to type, not just
 * seeing the box. If the field is somehow absent the button simply does
 * nothing, which is why there is no scrolling logic of its own to fall out of
 * sync with the layout.
 *
 * Nothing here reads, stores, or transmits the text in that field. The click
 * only moves focus.
 */
export function JumpToWorkspace({
  label = "Analyze scope",
  className,
}: {
  label?: string;
  className?: string;
}) {
  function jump() {
    const field = document.getElementById("agreement");

    if (!field) return;

    field.scrollIntoView({ block: "center", behavior: "smooth" });
    field.focus({ preventScroll: true });
  }

  return (
    <Button
      type="button"
      pill
      size="lg"
      onClick={jump}
      className={className ?? "px-5"}
    >
      {label}
      <ArrowDown aria-hidden="true" />
    </Button>
  );
}