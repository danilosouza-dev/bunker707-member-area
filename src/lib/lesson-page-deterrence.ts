type LessonPageKeyboardShortcut = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const devToolsShortcutKeys = new Set(["c", "i", "j", "k"]);

export function shouldBlockLessonPageKeyboardShortcut(event: LessonPageKeyboardShortcut) {
  const key = event.key.toLowerCase();

  if (event.code === "F12" || key === "f12") {
    return true;
  }

  if (key === "contextmenu" || (event.shiftKey && key === "f10")) {
    return true;
  }

  if (event.ctrlKey && event.shiftKey && devToolsShortcutKeys.has(key)) {
    return true;
  }

  if (event.metaKey && event.altKey && devToolsShortcutKeys.has(key)) {
    return true;
  }

  return (
    (event.ctrlKey && !event.metaKey && !event.shiftKey && key === "u") ||
    (event.metaKey && event.altKey && !event.shiftKey && key === "u")
  );
}
