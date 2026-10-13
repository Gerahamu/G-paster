const modifiers = ["Control", "Alt", "Shift", "Command"] as const;

export function normalizeShortcut(value: unknown, platform: string): string | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const parts = value.split("+");
  const key = parts.pop()?.toUpperCase() ?? "";
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|SPACE)$/.test(key) || !parts.length) return null;
  if (new Set(parts).size !== parts.length || parts.some(part => !(modifiers as readonly string[]).includes(part))) return null;
  if (platform !== "darwin" && parts.includes("Command")) return null;
  if (!parts.some(part => part === "Control" || part === "Alt" || part === "Command")) return null;
  return [...modifiers.filter(modifier => parts.includes(modifier)), key === "SPACE" ? "Space" : key].join("+");
}

export function shortcutFromKey(event: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }, platform: string): string | null {
  const key = event.code.replace(/^(Key|Digit)/, "");
  return normalizeShortcut([
    ...(event.ctrlKey ? ["Control"] : []), ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []), ...(event.metaKey ? ["Command"] : []), key
  ].join("+"), platform);
}

export function displayShortcut(shortcut: string, platform: string): string {
  const labels: Record<string, string> = platform === "darwin"
    ? { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘", Space: "Space" }
    : { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Command: "Win", Space: "Space" };
  return shortcut.split("+").map(part => labels[part] ?? part).join(platform === "darwin" ? " " : " + ");
}
