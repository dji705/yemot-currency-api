const API_PRIMARY = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies";
const API_FALLBACK = "https://latest.currency-api.pages.dev/v1/currencies";

// The menu lists foreign currencies; every result is converted to Israeli shekels.
const CURRENCIES = [
  { code: "usd", name: "דולר אמריקאי" },
  { code: "eur", name: "אירו" },
  { code: "gbp", name: "לירה שטרלינג" },
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
    ).join(". ");
    return res.end(yemotResponse(
      `שערי מטבע מול השקל הישראלי. ${menu}. להקשת כוכבית חזרו לתפריט הראשי.`,
      { menu: true, min: 1, max: 2, timeout: 7 }
    ));
  }

  try {
    // The API gives the value of one shekel in foreign currency. Invert it
    // to get the value of one foreign currency unit in shekels.
    const { rates, date } = await fetchRates("ils");
    const shekelPerUnit = rates[selected.code];
    if (typeof shekelPerUnit !== "number" || !Number.isFinite(shekelPerUnit) || shekelPerUnit <= 0) {
      res.statusCode = 404;
      return res.end(say(`לא נמצא שער עבור ${selected.name}`));
    }

    const amount = Number.isFinite(q.amount) && q.amount > 0 ? q.amount : 1;
    const total = amount / shekelPerUnit;
    const amountText = amount === 1
      ? `יחידה אחת של ${selected.name}`
      : `${formatRate(amount)} ${selected.name}`;

    return res.end(say(
      `${amountText} שווה ${formatRate(total)} שקלים חדשים. תאריך הנתונים ${date}. להקשת כוכבית חזרו לתפריט הראשי.`
    ));
  } catch {
    res.statusCode = 503;
    return res.end(say("מצטערים, לא ניתן לקבל כעת שערי מטבע. נסו שוב מאוחר יותר."));
  }
}
