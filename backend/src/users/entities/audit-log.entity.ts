export interface AuditLogEntry {
  auditId: number;
  userId: number | null;
  username: string;
  event: string;
  detail: string | null;
  ipAddress: string | null;
  createdAt: Date;
}
