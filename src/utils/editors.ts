export const EDITOR_OPTIONS = [
  { label: 'VS Code', value: 'code' },
  { label: 'Cursor', value: 'cursor' },
  { label: 'Zed', value: 'zed' },
  { label: 'CodeBuddy', value: 'codebuddy' },
  { label: 'Antigravity', value: 'antigravity' },
] as const;

export const EDITOR_LABEL_MAP: Record<string, string> = {
  code: 'VS Code',
  cursor: 'Cursor',
  zed: 'Zed',
  codebuddy: 'CodeBuddy',
  antigravity: 'Antigravity',
};
