export const ROLES = ["super_admin", "admin", "staff"] as const;
export type Role = (typeof ROLES)[number];

export const FILE_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const KNOWLEDGE_FILES_BUCKET = "knowledge-files";

export const POINT_REASONS = ["purchase", "redeem", "manual_adjustment", "promotion"] as const;
export type PointReason = (typeof POINT_REASONS)[number];
