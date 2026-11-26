import type { AssetCard } from '@ogm/contracts';
import type { LicenseMap } from './license-map.js';

export type ImportOptions = {
  assetsRoot: string;
  cwd: string;
  input?: string;
  id: string;
  title?: string;
  styleFamily?: AssetCard['style_family'];
  cameras?: AssetCard['cameras'];
  vendor?: string;
  sourceUrl?: string;
  version?: string;
  license?: string;
  licenseMap?: LicenseMap;
  licenseRef?: string;
  confirmedBy?: string;
  attribution?: string | null;
  tier?: 1 | 2;
  source?: { type: 'git' | 'npm'; url: string; pin: string };
  inspiration: boolean;
  fromQueue?: string;
};

export type QueueEntry = { drop_id: string; name: string; manifest: string };
export type ManifestFile = { path: string; downloaded?: boolean; previous_quarantine?: string };
export type DriveManifest = {
  drop_id: string;
  name: string;
  revision?: number;
  downloaded_at?: string;
  integrity_ok: boolean;
  problems?: string[];
  files_root?: string;
  files: ManifestFile[];
  source?: { drive_id?: string };
  quarantine?: string;
};
