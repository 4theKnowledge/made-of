"use client";

import { ErrorFallback } from "@/components/ErrorFallback";

export default function CraftError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      error={error}
      reset={reset}
      variant="page"
      title="Craft hit a snag."
      description="Something went wrong setting up the workbench. Try again, or head home."
    />
  );
}
