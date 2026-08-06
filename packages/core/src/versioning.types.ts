export interface VersionedRecord {
  _configVersion: number;
  _deletedAt?: string | null;
  [key: string]: any;
}
