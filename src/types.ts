export interface ServerConfig {
  host: string;
  port: number;
  autorefresh: boolean;
  quiet: boolean;
  theme: "light" | "dark" | "auto";
  title: string | null;
  user_content: boolean;
  wide: boolean;
  url_prefix: string;
}

export interface ContentFileResponse {
  type: "file";
  text: string;
  filename: string;
  path: string;
  parent: string;
  siblings: DirectoryEntry[];
}

export interface ContentListingResponse {
  type: "listing";
  path: string;
  entries: DirectoryEntry[];
}

export type ContentResponse = ContentFileResponse | ContentListingResponse;

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory";
}

export interface UserSettings {
  HOST?: string;
  PORT?: number;
  AUTOREFRESH?: boolean;
  QUIET?: boolean;
}
