export interface RetentionConfig {
  daysToKeep: number;
}

export function getExpirationTimestamp(config: RetentionConfig): string {
  const date = new Date();
  date.setDate(date.getDate() + config.daysToKeep);
  return date.toISOString();
}

export function getRetentionMetadata(config: RetentionConfig) {
  return {
    expires_at: getExpirationTimestamp(config),
    ready_for_cleanup: false // Will be true when job runs
  };
}
