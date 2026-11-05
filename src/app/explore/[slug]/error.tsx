"use client";

import { ErrorFallback } from "@/components/ErrorFallback";

export default function ExploreError({
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
      title="Explore couldn't render."
      description="The bowtie didn't draw. Try again, or jump to a different item."
    />
  );
}
