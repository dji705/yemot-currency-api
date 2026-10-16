const API_PRIMARY = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies";
const API_FALLBACK = "https://latest.currency-api.pages.dev/v1/currencies";

const CURRENCIES = [
  { code: "usd", name: "דולר אמריקאי" },
  { code: "eur", name: "אירו" },
  { code: "gbp", name: "לירה שטרלינג" },
  { code: "ils", name: "שקל ישראלי" },
  { code: "chf", name: "פרנק שווייצרי" },
  { code: "cad", name: "דולר קנדי" },
  { code: "aud", name: "דולר אוסטרלי" },
  { code: "jpy", name: "ין יפני" },
  { code: "try", name: "לירה טורקית" },
  { code: "pln", name: "זלוטי פולני" },
  { code: "czk", name: "קורונה צ'כית" },
  { code: "thb", name: "בהט תאילנדי" }
];

const say = (text) => `read=${text}.`;

function yemotResponse(text, options = {}) {
  const { menu = false, min = 1, max = 1, timeout = 7 } = options;
  if (!menu) return say(text);
  return `${say(text)}n-123.t-בחרו מטבע=wm_nav,no,${min},${max},${timeout},Digits,no,no,,,1,Ok`;
}

function getQuery(req) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  return {
    currency: (url.searchParams.get("currency") || "").toLowerCase().trim(),
    from: (url.searchParams.get("from") || "usd").toLowerCase().trim(),
    amount: Number(url.searchParams.get("amount") || 1),
    input: url.searchParams.get("ApiPhoneInput") || url.searchParams.get("Digits") || ""
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
  const value = String(input).replace(/[^\d]/g, "");
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= CURRENCIES.length
    ? CURRENCIES[number - 1]
    : null;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");

  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(say("השירות תומך בבקשת GET בלבד"));
  }

  const q = getQuery(req);
  let selected = CURRENCIES.find(currency => currency.code === q.currency);

  if (!selected && q.input) selected = currencyByInput(q.input);

  if (!selected) {
    const menu = CURRENCIES.map((currency, index) =>
      `להקשת ${index + 1} עבור ${currency.name}`
    ).join(", ");
    return res.end(yemotResponse(
      `שערי מטבע. ${menu}. להקשת כוכבית חזרו לתפריט הראשי.`,
      { menu: true, min: 1, max: 1, timeout: 7 }
    ));
  }

  try {
    const base = CURRENCIES.find(currency => currency.code === q.from)
      || { code: "usd", name: "דולר אמריקאי" };
    const { rates, date } = await fetchRates(base.code);
    const rate = rates[selected.code];

    if (typeof rate !== "number" || !Number.isFinite(rate)) {
      res.statusCode = 404;
      return res.end(say(`לא נמצא שער עבור ${selected.name}`));
    }

    const amount = Number.isFinite(q.amount) && q.amount > 0 ? q.amount : 1;
    const total = amount * rate;
    const amountText = amount === 1
      ? `שער דולר אמריקאי אחד`
      : `שער ${formatRate(amount)} ${base.name}`;

    return res.end(say(
      `${amountText} שווה ${formatRate(total)} ${selected.name}. תאריך הנתונים ${date}. להקשת כוכבית חזרו לתפריט הראשי.`
    ));
  } catch {
    res.statusCode = 503;
    return res.end(say("מצטערים, לא ניתן לקבל כעת שערי מטבע. נסו שוב מאוחר יותר."));
  }
}
