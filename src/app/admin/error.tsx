"use client";

import { ErrorFallback } from "@/components/ErrorFallback";

export default function AdminError({
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
      title="Admin tool crashed."
      description="One of the admin surfaces hit a render error. Nothing was saved from this render. Try again, or jump to another admin page."
      homeHref="/admin"
      homeLabel="Back to admin"
    />
  );
}
