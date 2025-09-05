export interface User {
  icon: { url: string };
  name: string;
  preferredUsername: string;
  url: string;
  summary: string;
}
export interface Post {
  published?: string;
  content: string;
  url: string;
}
