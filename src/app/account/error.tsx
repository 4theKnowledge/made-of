"use client";

import { ErrorFallback } from "@/components/ErrorFallback";

export default function AccountError({
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
      title="Account page error."
      description="Your account data is safe on the server. Try again or head home."
    />
  );
}
