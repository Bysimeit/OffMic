const THEME_SUPPORTED = ["light", "dark"];
const THEME_AUTO = "auto";

function themeResolve(preference) {
  return THEME_SUPPORTED.includes(preference) ? preference : THEME_AUTO;
}

function themeApply(preference) {
  document.documentElement.dataset.theme = themeResolve(preference);
}

async function themeApplyPreferred() {
  const data = await chrome.storage.local.get("settings");
  const preference = data.settings && data.settings.theme;
  const resolved = themeResolve(preference);
  themeApply(resolved);
  return resolved;
}
