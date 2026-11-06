export type AnalyticsEnv = "production" | "preview" | "development";

export function resolveEnv(): AnalyticsEnv {
  if (process.env.NODE_ENV === "production") {
    const railway = process.env.RAILWAY_ENVIRONMENT_NAME;
    if (railway && railway !== "production") return "preview";
    return "production";
  }
  return "development";
}
