// Typed event taxonomy. Each event is a discriminated-union branch whose
// `properties` shape is validated at every `track()` call site. Keep the
// union small and intentional — once a name is emitted into PostHog the
// cohort is forever and the type can't be renamed without migration.

export type AnalyticsEvent = never;
