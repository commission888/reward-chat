// Single source of truth for the platform's minimalist palette, consumed by
// both merchant-app and customer-liff's tailwind.config.ts so the two apps
// never drift out of sync.
export const colors = {
  primary: "#007AFF",
  primaryForeground: "#FFFFFF",
  background: "#F8FAFC",
  foreground: "#0F172A",
} as const;
