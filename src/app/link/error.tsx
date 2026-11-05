"use client";

import { ErrorFallback } from "@/components/ErrorFallback";

export default function LinkError({
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
      title="Today's puzzle couldn't load."
      description="Try again in a moment. If it keeps happening, play another mode while we sort it out."
    />
  );
}
