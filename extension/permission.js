const grantBtn = document.getElementById("grantBtn");
const result = document.getElementById("result");

let dict = {};

function show(key, ok, vars) {
  result.textContent = i18nText(dict, key, vars);
  result.className = "result " + (ok ? "ok" : "error");
}

grantBtn.addEventListener("click", async () => {
  grantBtn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    show("permGranted", true);
  } catch (e) {
    const name = e && e.name;
    if (name === "NotAllowedError") {
      show("permDenied", false);
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      show("errMicMissing", false);
    } else {
      show("permFailed", false, { error: name || "unknown" });
    }
    grantBtn.disabled = false;
  }
});

async function init() {
  await themeApplyPreferred();
  const loaded = await i18nLoadPreferred();
  dict = loaded.dict;
  document.documentElement.lang = loaded.locale;
  i18nApply(document, dict);
}

init();
