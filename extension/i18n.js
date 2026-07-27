const I18N_SUPPORTED = ["en", "fr", "nl", "de", "es"];
const I18N_FALLBACK = "en";

function i18nResolve(preference) {
  if (preference && preference !== "auto") {
    if (I18N_SUPPORTED.includes(preference)) return preference;
  }
  const ui = (api.i18n.getUILanguage() || I18N_FALLBACK).toLowerCase();
  const base = ui.split("-")[0];
  return I18N_SUPPORTED.includes(base) ? base : I18N_FALLBACK;
}

async function i18nLoad(locale) {
  const url = api.runtime.getURL("_locales/" + locale + "/messages.json");
  const response = await fetch(url);
  const raw = await response.json();
  const dict = {};
  for (const key of Object.keys(raw)) {
    dict[key] = raw[key].message;
  }
  return dict;
}

async function i18nLoadPreferred() {
  const data = await api.storage.local.get("settings");
  const preference = data.settings && data.settings.language;
  const locale = i18nResolve(preference);
  const dict = await i18nLoad(locale);
  return { locale, dict };
}

function i18nText(dict, key, vars) {
  const template = dict[key];
  if (!template) return key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    return name in vars ? vars[name] : match;
  });
}

function i18nApply(root, dict) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const value = dict[el.dataset.i18n];
    if (value) el.textContent = value;
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    const value = dict[el.dataset.i18nPlaceholder];
    if (value) el.placeholder = value;
  }
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    const value = dict[el.dataset.i18nTitle];
    if (value) el.title = value;
  }
  const titleKey = document.documentElement.dataset.i18nTitleKey;
  if (titleKey && dict[titleKey]) {
    document.title = dict[titleKey];
  }
}
