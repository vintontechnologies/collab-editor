export interface User {
  id: number;
  email: string;
  name: string;
  avatar: string;
}

export type Role = 'owner' | 'editor' | 'viewer';
export type DocType = 'code' | 'whiteboard';

export interface DocumentItem {
  id: string;
  title: string;
  doc_type: DocType;
  language: string;
  my_role: Role;
  owner_name: string;
  link_role: 'off' | 'viewer' | 'editor';
  created_at: string;
  updated_at: string;
}

export type LinkRole = 'off' | 'viewer' | 'editor';

export interface Member {
  user_id: number;
  email: string;
  name: string;
  avatar: string;
  role: Role;
}

export interface PendingInvite {
  email: string;
  role: Role;
}

export interface MembersResponse {
  members: Member[];
  pending_invites: PendingInvite[];
}

export interface OnlineUser {
  id: number;
  name: string;
  color: string;
  colorLight: string;
}

export interface VersionInfo {
  number: number;
  author_name: string;
  kind: 'auto' | 'restore';
  label: string;
  created_at: string;
}

export interface VersionDetail extends VersionInfo {
  updates: string[]; // base64 Yjs updates
}
