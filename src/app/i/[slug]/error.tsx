"use client";

import { ErrorFallback } from "@/components/ErrorFallback";

export default function ItemError({
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
      title="This item page couldn't render."
      description="Something went wrong drawing the bowtie. Try again, or pick another thread from home."
    />
  );
}
