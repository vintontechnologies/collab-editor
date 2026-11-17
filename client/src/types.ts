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
