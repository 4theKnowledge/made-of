"use client";

import { ErrorFallback } from "@/components/ErrorFallback";

export default function CombineError({
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
      title="Combine hit a snag."
      description="The board couldn't render. Your lifetime collection is safe — try again to restart this run, or head home."
    />
  );
}
