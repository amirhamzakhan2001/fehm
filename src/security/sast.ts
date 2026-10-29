import { stripRegexLiterals } from "../codebase-briefing/facts.js";
import type { Language } from "../model.js";

/**
 * Pattern rules that need no data flow: weak cryptography and randomness,
 * disabled TLS, JWT and CORS misuse, insecure cookies, timing-unsafe secret
 * comparison, secrets in logs, error details in responses, debug mode, XXE,
 * unsafe deserializers, dynamic execution and SQL built from strings.
 *
 * Lines are matched after removing comments, regular-expression literals and
 * string literals that contain whitespace (prose), so code that *describes*
 * these patterns (like Fehm's own rules) does not flag itself. Short string
 * arguments such as "md5" are kept, since they are the evidence.
 */

export interface PatternHit {
  rule: string;
  path: string;
  line: number;
  detail: string;
  confidence: "verified" | "strong" | "inferred";
  severity?: "critical" | "high" | "medium" | "low" | "info";
}

type Lang = "js" | "py" | "go" | "java" | "any";

interface PatternRule {
  rule: string;
  langs: Lang[];
  re: RegExp;
  detail: string | ((m: RegExpExecArray, line: string) => string);
  confidence: PatternHit["confidence"];
  /** Extra condition on the (cleaned) line or its window of following lines. */
  when?: (line: string, window: string, file: string) => boolean;
  severity?: (line: string, window: string) => PatternHit["severity"] | undefined;
}

/** Password hashing with a fast digest is serious; content hashing (cache keys, fingerprints, dedupe) is usually fine. */
function hashSeverity(line: string, window: string): PatternHit["severity"] | undefined {
  if (PASSWORDISH.test(window)) return "high";
  if (/\b(?:etag|cache|fingerprint|checksum|dedupe|digest|shape|body|content|key|hash)\w*\b/i.test(line)) return "low";
  return undefined;
}
const SECRETISH = /(?:passw|secret|token|api_?key|apikey|nonce|salt|otp|session|credential|private_?key|auth)/i;
const PASSWORDISH = /passw/i;

const RULES: PatternRule[] = [
  // cryptography
  { rule: "sec/weak-hash", langs: ["js"], re: /\bcreateHash\(\s*["'](md5|sha1)["']/i, detail: (m) => `${m[1]!.toUpperCase()} hash`, confidence: "verified", severity: hashSeverity },
  { rule: "sec/weak-hash", langs: ["py"], re: /\bhashlib\.(md5|sha1)\(/, detail: (m) => `hashlib.${m[1]}`, confidence: "verified", when: (l) => !/usedforsecurity\s*=\s*False/.test(l), severity: hashSeverity },
  { rule: "sec/weak-hash", langs: ["java"], re: /MessageDigest\.getInstance\(\s*"(MD5|SHA-?1)"/i, detail: (m) => `MessageDigest ${m[1]}`, confidence: "verified" },
  { rule: "sec/weak-hash", langs: ["go"], re: /\b(md5|sha1)\.(?:New|Sum)\(/, detail: (m) => `${m[1]} in Go`, confidence: "verified" },
  { rule: "sec/weak-cipher", langs: ["js"], re: /\bcreateCipher\(|["'](?:des|des-ede3?|rc4|aes-\d+-ecb|bf)(?:-cbc)?["']/i, detail: "deprecated createCipher, or a DES/RC4/ECB cipher", confidence: "strong" },
  { rule: "sec/weak-cipher", langs: ["py"], re: /\bAES\.MODE_ECB\b|\bDES3?\.new\(|\bARC4\.new\(|\bBlowfish\.new\(/, detail: "ECB mode or a legacy cipher", confidence: "strong" },
  { rule: "sec/weak-cipher", langs: ["java"], re: /Cipher\.getInstance\(\s*"(?:DES|DESede|RC4|AES\/ECB|AES")/, detail: "DES/RC4 or AES in ECB mode", confidence: "strong" },
  { rule: "sec/weak-random", langs: ["js"], re: /\bMath\.random\(\)/, detail: "Math.random() for a security value", confidence: "inferred", when: (l) => SECRETISH.test(l) },
  { rule: "sec/weak-random", langs: ["py"], re: /\brandom\.(?:random|randint|choice|choices|getrandbits|randrange)\(/, detail: "random module for a security value", confidence: "inferred", when: (l) => SECRETISH.test(l) },
  // transport and tokens
  { rule: "sec/tls-disabled", langs: ["js"], re: /\brejectUnauthorized\s*:\s*false\b|\bstrictSSL\s*:\s*false\b/, detail: "TLS certificate verification disabled", confidence: "verified" },
  { rule: "sec/tls-disabled", langs: ["py"], re: /\bverify\s*=\s*False\b|\bssl\._create_unverified_context\(|\bCERT_NONE\b|\bcheck_hostname\s*=\s*False\b/, detail: "TLS verification disabled", confidence: "verified" },
  { rule: "sec/tls-disabled", langs: ["go"], re: /\bInsecureSkipVerify\s*:\s*true\b/, detail: "InsecureSkipVerify: true", confidence: "verified" },
  { rule: "sec/jwt-unverified", langs: ["js"], re: /\bjwt\.decode\(/, detail: "jwt.decode() reads a token without checking its signature", confidence: "strong", when: (_l, _w, file) => !/\bjwt\.verify\(/.test(file) },
  { rule: "sec/jwt-unverified", langs: ["py"], re: /\bjwt\.decode\([^)]*(?:verify_signature["']?\s*:\s*False|verify\s*=\s*False)/, detail: "PyJWT decode with signature verification off", confidence: "verified" },
  { rule: "sec/jwt-weak", langs: ["js", "py"], re: /algorithms?["']?\s*[:=]\s*\[?\s*["']none["']|\bignoreExpiration\s*:\s*true\b|["']verify_exp["']\s*:\s*False/i, detail: "unsigned JWTs accepted, or expiry ignored", confidence: "verified" },
  // HTTP
  { rule: "sec/cors-wildcard", langs: ["js"], re: /\borigin\s*:\s*(?:["']\*["']|true)\b/, detail: "CORS allows any origin", confidence: "strong", severity: (_l, w) => (/credentials\s*:\s*true/.test(w) ? "high" : undefined) },
  { rule: "sec/cors-wildcard", langs: ["js", "py", "go", "java"], re: /Access-Control-Allow-Origin["']?\s*[,:]\s*["']\*["']/i, detail: "Access-Control-Allow-Origin: *", confidence: "verified" },
  { rule: "sec/cors-wildcard", langs: ["py"], re: /\ballow_origins\s*=\s*\[\s*["']\*["']\s*\]|\bCORS_ALLOW_ALL_ORIGINS\s*=\s*True|\bCORS_ORIGIN_ALLOW_ALL\s*=\s*True/, detail: "CORS allows any origin", confidence: "verified", severity: (_l, w) => (/allow_credentials\s*=\s*True/.test(w) ? "high" : undefined) },
  { rule: "sec/insecure-cookie", langs: ["js"], re: /\b(?:res|reply|response)\.cookie\(/, detail: "cookie set without httpOnly and secure", confidence: "inferred", when: (_l, w) => !(/httpOnly\s*:\s*true/i.test(w) && /secure\s*:\s*(?:true|process|isProd|prod)/i.test(w)) },
  { rule: "sec/insecure-cookie", langs: ["js", "py"], re: /\bhttpOnly\s*:\s*false\b|\bSESSION_COOKIE_(?:SECURE|HTTPONLY)\s*=\s*False|\bhttponly\s*=\s*False/i, detail: "cookie protection turned off", confidence: "verified" },
  { rule: "sec/timing-compare", langs: ["js"], re: /\b\w*(?:secret|(?:expected|computed|provided|received|given|header|request|webhook|hmac)Signature|hmac|apiKey|api_key|password|passwd|(?:access|auth|session|reset|csrf|bearer|refresh)Token)\w*\s*(?:===?|!==?)\s*\w/i, detail: "secret compared with ===; use crypto.timingSafeEqual", confidence: "inferred", when: (l) => !/timingSafeEqual|\.length\s*(?:===?|!==?)|===?\s*(?:null|undefined|""|''|0|true|false)\b|typeof /.test(l) },
  { rule: "sec/timing-compare", langs: ["py"], re: /\b\w*(?:secret|(?:expected|computed|provided|received|given|header|request|webhook|hmac)_signature|hmac|api_key|password|passwd|(?:access|auth|session|reset|csrf|bearer|refresh)_token)\w*\s*(?:==|!=)\s*\w/i, detail: "secret compared with ==; use hmac.compare_digest", confidence: "inferred", when: (l) => !/compare_digest|len\(|==\s*(?:None|""|''|0|True|False)\b/.test(l) },
  { rule: "sec/sensitive-log", langs: ["js"], re: /\b(?:console\.(?:log|info|debug|warn|error)|logger\.\w+|log\.\w+)\((.*)$/, detail: "logs a password, secret or token", confidence: "inferred", when: (l) => /\b\w*(?:password|passwd|secret|apiKey|api_key|accessToken|refreshToken|authorization|creditCard|ssn)\w*\b/i.test(l.slice(l.indexOf("("))) },
  { rule: "sec/sensitive-log", langs: ["py"], re: /\b(?:print|logging\.\w+|logger\.\w+|log\.\w+)\((.*)$/, detail: "logs a password, secret or token", confidence: "inferred", when: (l) => /\b\w*(?:password|passwd|secret|api_key|access_token|refresh_token|authorization|credit_card|ssn)\w*\b/i.test(l.slice(l.indexOf("("))) },
  { rule: "sec/error-disclosure", langs: ["js"], re: /\b(?:res|reply|response)(?:\.status\([^)]*\))?\.(?:send|json|end)\([^)]*\.stack\b/, detail: "stack trace sent to the client", confidence: "strong" },
  { rule: "sec/error-disclosure", langs: ["py"], re: /\btraceback\.format_exc\(\)/, detail: "traceback returned or rendered", confidence: "inferred", when: (l) => /\breturn\b|jsonify|Response|HttpResponse/.test(l) },
  { rule: "sec/debug-mode", langs: ["py"], re: /\.run\([^)]*\bdebug\s*=\s*True|^\s*DEBUG\s*=\s*True\b|\bapp\.debug\s*=\s*True/, detail: "debug mode enabled (interactive debugger, detailed errors)", confidence: "verified" },
  { rule: "sec/xxe", langs: ["js"], re: /\bnoent\s*:\s*true\b/, detail: "XML parser expands external entities (noent: true)", confidence: "verified" },
  { rule: "sec/xxe", langs: ["py"], re: /\bresolve_entities\s*=\s*True|\bXMLParser\([^)]*load_dtd\s*=\s*True/, detail: "XML parser resolves entities", confidence: "verified" },
  { rule: "sec/xxe", langs: ["java"], re: /DocumentBuilderFactory\.newInstance\(\)|SAXParserFactory\.newInstance\(\)|XMLInputFactory\.newInstance\(\)/, detail: "XML parser created without disabling DTDs", confidence: "inferred", when: (_l, _w, file) => !/disallow-doctype-decl|SUPPORT_DTD|external-general-entities/.test(file) },
  { rule: "sec/insecure-tempfile", langs: ["py"], re: /\btempfile\.mktemp\(|\bos\.tmpnam\(|\bos\.tempnam\(/, detail: "predictable temporary file name", confidence: "verified" },
  { rule: "sec/bind-all", langs: ["js", "py", "go"], re: /\.listen\([^)]*["']0\.0\.0\.0["']|\bhost\s*=\s*["']0\.0\.0\.0["']|ListenAndServe\(\s*["']0\.0\.0\.0:/, detail: "listens on all network interfaces", confidence: "verified" },
  // execution and deserialization (pattern level; data-flow findings on the same line take precedence)
  { rule: "sec/dangerous-exec", langs: ["js"], re: /(?<![\w.])(?:exec|execSync)\(\s*(?:`[^`]*\$\{|[\w.]+\s*\+|["'][^"']*["']\s*\+)/, detail: "shell command built from a dynamic string", confidence: "strong" },
  { rule: "sec/dangerous-exec", langs: ["py"], re: /\bsubprocess\.\w+\([^)]*shell\s*=\s*True|\bos\.system\(\s*(?:f["']|[\w.]+\s*[+%]|["'][^"']*["']\s*[%+])/, detail: "shell command with shell=True or a dynamic string", confidence: "strong", when: (l) => !/os\.system\(\s*["'][^"'{]*["']\s*\)/.test(l) },
  { rule: "sec/dynamic-eval", langs: ["js"], re: /(?<![\w.])eval\(\s*(?!["'`][^"'`]*["'`]\s*\))|\bnew Function\(\s*(?!["'`][^"'`]*["'`]\s*\))/, detail: "code evaluated from a dynamic value", confidence: "strong" },
  { rule: "sec/dynamic-eval", langs: ["py"], re: /(?<![\w.])(?:eval|exec)\(\s*(?!["'][^"']*["']\s*\))/, detail: "eval/exec of a dynamic value", confidence: "strong", when: (l) => !/\bdef\s|\.exec\(|re\.exec/.test(l) },
  { rule: "sec/raw-sql", langs: ["js"], re: /\.(?:query|execute|raw|\$queryRawUnsafe|\$executeRawUnsafe)\(\s*(?:`[^`]*\b(?:select|insert|update|delete|where)\b[^`]*\$\{|["'][^"']*\b(?:select|insert|update|delete|where)\b[^"']*["']\s*\+)/i, detail: "SQL text built by interpolation", confidence: "inferred" },
  { rule: "sec/raw-sql", langs: ["py"], re: /\.(?:execute|executemany|raw)\(\s*(?:f["'][^"']*\b(?:select|insert|update|delete|where)\b|["'][^"']*\b(?:select|insert|update|delete|where)\b[^"']*["']\s*(?:%|\+|\.format))/i, detail: "SQL text built by formatting", confidence: "inferred" },
  { rule: "sec/insecure-deserializer", langs: ["py"], re: /\bpickle\.loads?\(|\bcPickle\.loads?\(|\bmarshal\.loads?\(|\bjsonpickle\.decode\(|\byaml\.unsafe_load\(|\byaml\.load\((?![^)]*Loader\s*=\s*(?:yaml\.)?(?:Safe|Base)Loader)|\btorch\.load\((?![^)]*weights_only\s*=\s*True)|\bjoblib\.load\(/, detail: "deserializer that can execute code", confidence: "strong" },
  { rule: "sec/insecure-deserializer", langs: ["js"], re: /\bunserialize\(|\bserialize\.unserialize\(|\bfuncster\b|\bv8\.deserialize\(/, detail: "deserializer that can execute code", confidence: "strong" },
  { rule: "sec/insecure-deserializer", langs: ["java"], re: /\bnew ObjectInputStream\(|\bXMLDecoder\(|\.readObject\(\)/, detail: "Java native deserialization", confidence: "inferred" },
];

const LANG: Partial<Record<Language, Lang>> = { typescript: "js", javascript: "js", python: "py", go: "go", java: "java" };

export function patternLanguage(language: Language): Lang | undefined {
  return LANG[language];
}

/** Comments, regex literals and prose strings removed; short string literals (identifiers, algorithm names) kept. */
export function cleanLine(line: string, lang: Lang): string {
  let s = lang === "py" ? line.replace(/(^|\s)#.*$/, "$1") : line.replace(/(^|[^:"'`])\/\/.*$/, "$1");
  if (lang === "js") s = stripRegexLiterals(s);
  return s.replace(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g, (m, _q, inner: string) => (/\s/.test(inner) || inner.length > 60 ? "\"\"" : m));
}

export function scanPatterns(path: string, language: Language, lines: readonly string[]): PatternHit[] {
  const lang = LANG[language];
  if (!lang) return [];
  const clean = lines.slice(0, 20_000).map((l) => (l.length > 2000 ? "" : cleanLine(l, lang)));
  const file = clean.join("\n");
  const out: PatternHit[] = [];
  const rules = RULES.filter((r) => r.langs.includes(lang) || r.langs.includes("any"));
  for (let i = 0; i < clean.length; i += 1) {
    const l = clean[i]!;
    if (!l.trim() || /^\s*(?:\*|\/\*)/.test(l)) continue;
    for (const r of rules) {
      const m = r.re.exec(l);
      if (!m) continue;
      const window = clean.slice(i, i + 6).join("\n");
      if (r.when && !r.when(l, window, file)) continue;
      const sev = r.severity?.(l, window);
      out.push({ rule: r.rule, path, line: i + 1, detail: typeof r.detail === "string" ? r.detail : r.detail(m, l), confidence: r.confidence, ...(sev ? { severity: sev } : {}) });
    }
  }
  return out;
}
