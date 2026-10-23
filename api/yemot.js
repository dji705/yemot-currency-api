const API_PRIMARY = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies";
const API_FALLBACK = "https://latest.currency-api.pages.dev/v1/currencies";

const CURRENCIES = [
  { code: "usd", name: "דולר אמריקאי" },
  { code: "eur", name: "אירו" },
  { code: "gbp", name: "לירה שטרלינג" },
  { code: "chf", name: "פרנק שווייצרי" },
  { code: "cad", name: "דולר קנדי" },
  { code: "aud", name: "דולר אוסטרלי" },
  { code: "jpy", name: "ין יפני" },
  { code: "try", name: "לירה טורקית" },
  { code: "pln", name: "זלוטי פולני" }
];

// Yemot expects read text as t-/n- parts, followed by the input variable.
// This is the same response structure used in the user's other IVR API.
function numericParts(raw) {
  const normalized = String(raw).replace(/,/g, "");
  if (normalized.includes(".")) {
    const [whole, fraction] = normalized.split(".");
    return [...numericParts(whole), "t-נקודה", ...fraction.split("").map(digit => `n-${digit}`)];
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < 0) return [`t-${raw}`];
  if (value <= 2147483647) return [`n-${value}`];
  return [`t-${raw}`];
}

function readParts(text) {
  const input = String(text).replace(/[=;!?]/g, " ").replace(/\.(?!\d)/g, " ");
  const pattern = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  const parts = [];
  let cursor = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    const phrase = input.slice(cursor, index).trim();
    if (phrase) parts.push(`t-${phrase.replace(/\s+/g, " ")}`);
    parts.push(...numericParts(match[0]));
    cursor = index + match[0].length;
  }
  const tail = input.slice(cursor).trim();
  if (tail) parts.push(`t-${tail.replace(/\s+/g, " ")}`);
  return parts.join(".");
}

function response(res, text, { collect = false, inputName = "wm_nav", min = 1, max = 1, timeout = 5 } = {}) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const speech = `read=${readParts(text)}`;
  if (!collect) return res.end(speech);
  return res.end(`${speech}=${inputName},no,${min},${max},${timeout},Digits,no,no,,,1,Ok`);
}

function getQuery(req) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const get = key => url.searchParams.get(key);
  let input = "";
  for (const key of ["wm_nav", "ApiPhoneInput", "Digits", "digits", "Choice", "ChoiceYesNo", "val", "choice"]) {
    const value = get(key) ?? body[key];
    if (value !== undefined && value !== null && String(value) !== "") {
      input = String(value).trim();
      break;
    }
  }
  return {
    url,
    input,
    currency: String(get("currency") || body.currency || "").toLowerCase().trim(),
    amount: Number(get("amount") || body.amount || 1)
  };
}

async function fetchRates(code) {
  const endpoints = [
    `${API_PRIMARY}/${encodeURIComponent(code)}.json`,
    `${API_FALLBACK}/${encodeURIComponent(code)}.json`
  ];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`Rate provider returned HTTP ${response.status}`);
      const json = await response.json();
      const rates = json?.[code];
      if (!rates || typeof rates !== "object") throw new Error("Invalid rate data");
      return { rates, date: json.date || "לא ידוע" };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Exchange-rate service unavailable");
}

function formatRate(value) {
  if (!Number.isFinite(value)) return "לא זמין";
  return new Intl.NumberFormat("he-IL", {
    maximumFractionDigits: value < 1 ? 6 : 4,
    minimumFractionDigits: 0
  }).format(value);
}

function currencyByInput(input) {
  const value = String(input).replace(/\D/g, "");
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= CURRENCIES.length
    ? CURRENCIES[number - 1]
    : null;
}

function menuText() {
  return "לשער הדולר הקישו 1. לשער האירו הקישו 2. לשער הלירה שטרלינג הקישו 3. לשער הפרנק השווייצרי הקישו 4. לשער הדולר הקנדי הקישו 5. לשער הדולר האוסטרלי הקישו 6. לשער הין היפני הקישו 7. לשער הלירה הטורקית הקישו 8. לשער הזלוטי הפולני הקישו 9.";
}

export default async function handler(req, res) {
  const q = getQuery(req);
  const url = q.url;

  // Star returns to the menu.
  if ([...url.searchParams.values()].some(value => String(value).includes("*")) ||
      Object.values(req.body && typeof req.body === "object" ? req.body : {}).some(value => String(value).includes("*"))) {
    return response(res, menuText(), { collect: true, inputName: "wm_nav", min: 1, max: 1, timeout: 5 });
  }

  const selected = CURRENCIES.find(currency => currency.code === q.currency) || currencyByInput(q.input);
  if (!selected) {
    return response(res, menuText(), { collect: true, inputName: "wm_nav", min: 1, max: 1, timeout: 5 });
  }

  try {
    // In the ILS rates table, one ILS is expressed as a fraction of each foreign currency.
    // Invert the rate to obtain foreign-currency units in Israeli shekels.
    const { rates, date } = await fetchRates("ils");
    const shekelValue = rates[selected.code];
    if (typeof shekelValue !== "number" || !Number.isFinite(shekelValue) || shekelValue <= 0) {
      return response(res, `לא נמצא שער עבור ${selected.name}. ${menuText()}`, { collect: true, inputName: "wm_nav", min: 1, max: 1, timeout: 5 });
    }
    const amount = Number.isFinite(q.amount) && q.amount > 0 ? q.amount : 1;
    const total = amount / shekelValue;
    const amountText = amount === 1 ? `יחידה אחת של ${selected.name}` : `${formatRate(amount)} ${selected.name}`;
    return response(res, `${amountText} שווה ${formatRate(total)} שקלים חדשים. תאריך הנתונים ${date}. להקשת מטבע נוסף, הקישו כוכבית.`, {
      collect: true, inputName: "wm_nav", min: 1, max: 1, timeout: 5
    });
  } catch {
    return response(res, `לא ניתן לקבל כעת שערי מטבע. נסו שוב. ${menuText()}`, {
      collect: true, inputName: "wm_nav", min: 1, max: 1, timeout: 5
    });
  }
}
