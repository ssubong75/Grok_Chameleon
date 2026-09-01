// Prompt translation language picker and automatic translation.
const PROMPT_TRANSLATION_LANGUAGE_CODES = Object.freeze(`
gaa gl gn yue gu el kl nhe nl new ne no nus fa-AF da doi de dov dyu dv din lo ltg lv la ru lmo rom lg ro lua luo lb rn lij lt li ln mad mr mwr mh mi mai mak mk mg ml ms ms-Arab mam gv chm mni-Mtei mfe mt mn hmn min my lus eu ba bci bts btx bbc bal ban bm vec bew vi ve be bem bn bs bho bua bg br bik sm se zap sa sat-Latn sat sg shn sr ceb st crs nso so sn sus su ss sw sv gd es sk sl scn sd szl si ar hy av as awa ay is ht ga az ace ach aa af alz sq am ab sah et eo ee en or om os oc war yo udm ur uz uk wo cy ug yua ndc-ZW nr bm-Nkoo ig iu-Latn iu yi iba it id ilo ja jam jw ka dz zu zh-CN zh-TW kac ch ny ce cs ts cv chk tn kha kk ca pam kn kr qu kek co kv xh trp gom kg ckb ku hr kri crh-Latn crh km cgg rw ky ktu ber-Latn ber ta tg tt ty th tet te tpi to tk tyv tcy tum tr ak ti bo tiv ps pap pag pa pa-Arab fo fa pt pt-PT fon pl ff fr fr-CA fur fy fj fi tl haw ha cnh ko hu hrx iw hi hil
`.trim().split(/\s+/));

const PROMPT_TRANSLATION_SHORT_CODES = Object.freeze({
  gaa: "GAA", gl: "GLG", gn: "GRN", yue: "YUE", gu: "GUJ", el: "GRE", kl: "KAL", nhe: "NHE",
  nl: "DUT", new: "NEW", ne: "NEP", no: "NOR", nus: "NUS", fa: "PER", da: "DAN", doi: "DOI",
  de: "GER", dov: "DOV", dyu: "DYU", dv: "DIV", din: "DIN", lo: "LAO", ltg: "LTG", lv: "LAV",
  la: "LAT", ru: "RUS", lmo: "LMO", rom: "ROM", lg: "LUG", ro: "RUM", lua: "LUA", luo: "LUO",
  lb: "LTZ", rn: "RUN", lij: "LIJ", lt: "LIT", li: "LIM", ln: "LIN", mad: "MAD", mr: "MAR",
  mwr: "MWR", mh: "MAH", mi: "MAO", mai: "MAI", mak: "MAK", mk: "MAC", mg: "MLG", ml: "MAL",
  ms: "MAY", mam: "MAM", gv: "GLV", chm: "CHM", mni: "MNI", mfe: "MFE", mt: "MLT", mn: "MON",
  hmn: "HMN", min: "MIN", my: "BUR", lus: "LUS", eu: "BAQ", ba: "BAK", bci: "BCI", bts: "BTS",
  btx: "BTX", bbc: "BBC", bal: "BAL", ban: "BAN", bm: "BAM", vec: "VEC", bew: "BEW", vi: "VIE",
  ve: "VEN", be: "BEL", bem: "BEM", bn: "BEN", bs: "BOS", bho: "BHO", bua: "BUA", bg: "BUL",
  br: "BRE", bik: "BIK", sm: "SMO", se: "SME", zap: "ZAP", sa: "SAN", sat: "SAT", sg: "SAG",
  shn: "SHN", sr: "SRP", ceb: "CEB", st: "SOT", crs: "CRS", nso: "NSO", so: "SOM", sn: "SNA",
  sus: "SUS", su: "SUN", ss: "SSW", sw: "SWA", sv: "SWE", gd: "GLA", es: "SPA", sk: "SLO",
  sl: "SLV", scn: "SCN", sd: "SND", szl: "SZL", si: "SIN", ar: "ARA", hy: "ARM", av: "AVA",
  as: "ASM", awa: "AWA", ay: "AYM", is: "ICE", ht: "HAT", ga: "GLE", az: "AZE", ace: "ACE",
  ach: "ACH", aa: "AAR", af: "AFR", alz: "ALZ", sq: "ALB", am: "AMH", ab: "ABK", sah: "SAH",
  et: "EST", eo: "EPO", ee: "EWE", en: "ENG", or: "ORI", om: "ORM", os: "OSS", oc: "OCI",
  war: "WAR", yo: "YOR", udm: "UDM", ur: "URD", uz: "UZB", uk: "UKR", wo: "WOL", cy: "WEL",
  ug: "UIG", yua: "YUA", ndc: "NDC", nr: "NBL", ig: "IBO", iu: "IKU", yi: "YID", iba: "IBA",
  it: "ITA", id: "IND", ilo: "ILO", ja: "JPN", jam: "JAM", jw: "JAV", ka: "GEO", dz: "DZO",
  zu: "ZUL", zh: "CHI", kac: "KAC", ch: "CHA", ny: "NYA", ce: "CHE", cs: "CZE", ts: "TSO",
  cv: "CHV", chk: "CHK", tn: "TSN", kha: "KHA", kk: "KAZ", ca: "CAT", pam: "PAM", kn: "KAN",
  kr: "KAU", qu: "QUE", kek: "KEK", co: "COS", kv: "KOM", xh: "XHO", trp: "TRP", gom: "GOM",
  kg: "KON", ckb: "CKB", ku: "KUR", hr: "HRV", kri: "KRI", crh: "CRH", km: "KHM", cgg: "CGG",
  rw: "KIN", ky: "KIR", ktu: "KTU", ber: "BER", ta: "TAM", tg: "TGK", tt: "TAT", ty: "TAH",
  th: "THA", tet: "TET", te: "TEL", tpi: "TPI", to: "TON", tk: "TUK", tyv: "TYV", tcy: "TCY",
  tum: "TUM", tr: "TUR", ak: "AKA", ti: "TIR", bo: "TIB", tiv: "TIV", ps: "PUS", pap: "PAP",
  pag: "PAG", pa: "PAN", fo: "FAO", pt: "POR", fon: "FON", pl: "POL", ff: "FUL", fr: "FRE",
  fur: "FUR", fy: "FRY", fj: "FIJ", fi: "FIN", tl: "TGL", haw: "HAW", ha: "HAU", cnh: "CNH",
  ko: "KOR", hu: "HUN", hrx: "HRX", iw: "HEB", hi: "HIN", hil: "HIL",
});

const PROMPT_TRANSLATION_VARIANT_SHORT_CODES = Object.freeze({
  "fa-AF": "DAR",
  "ms-Arab": "MS-J",
  "sat-Latn": "SAT-L",
  "mni-Mtei": "MNI",
  "ndc-ZW": "NDC",
  "bm-Nkoo": "NKO",
  "iu-Latn": "IU-L",
  "zh-CN": "CHS",
  "zh-TW": "CHT",
  "crh-Latn": "CRH-L",
  "ber-Latn": "BER-L",
  "pa-Arab": "PAN-S",
  "pt": "POR-BR",
  "pt-PT": "POR-PT",
  "fr-CA": "FRC",
});

const PROMPT_TRANSLATION_LANGUAGE_NAME_OVERRIDES = Object.freeze({
  "en": "영어",
  "ko": "한국어",
  "gaa": "가어",
  "gl": "갈리시아어",
  "gn": "과라니어",
  "yue": "광둥어",
  "gu": "구자라트어",
  "el": "그리스어",
  "kl": "그린란드어",
  "nhe": "나우아틀어(동부 우아스테카)",
  "nl": "네덜란드어",
  "new": "네팔바사어(네와르어)",
  "ne": "네팔어",
  "no": "노르웨이어",
  "nus": "누에르어",
  "fa-AF": "다리어",
  "da": "덴마크어",
  "doi": "도그리어",
  "de": "독일어",
  "dov": "돔베어",
  "dyu": "드율라어",
  "dv": "디베히어",
  "din": "딩카어",
  "lo": "라오어",
  "ltg": "라트갈레어",
  "lv": "라트비아어",
  "la": "라틴어",
  "ru": "러시아어",
  "lmo": "롬바르디아어",
  "rom": "롬어",
  "lg": "루간다어",
  "ro": "루마니아어",
  "lua": "루바어",
  "luo": "루오어",
  "lb": "룩셈부르크어",
  "rn": "룬디어",
  "lij": "리구리아어",
  "lt": "리투아니아어",
  "li": "림뷔르흐어",
  "ln": "링갈라어",
  "mad": "마두라어",
  "mr": "마라티어",
  "mwr": "마르와디어",
  "mh": "마셜어",
  "mi": "마오리어",
  "mai": "마이틸어",
  "mak": "마카사르어",
  "mk": "마케도니아어",
  "mg": "말라가시어",
  "ml": "말라얄람어",
  "ms": "말레이어",
  "ms-Arab": "말레이어(자위)",
  "mam": "맘어",
  "gv": "맹크스어",
  "chm": "메도우 마리어",
  "mni-Mtei": "메이테이어(마니푸르어)",
  "mfe": "모리셔스 크리올어",
  "mt": "몰타어",
  "mn": "몽골어",
  "hmn": "몽어",
  "min": "미낭어",
  "my": "미얀마어(버마어)",
  "lus": "미조어",
  "eu": "바스크어",
  "ba": "바시키르어",
  "bci": "바울레어",
  "bts": "바탁 시말룽운어",
  "btx": "바탁 카로어",
  "bbc": "바탁 토바어",
  "bal": "발루치어",
  "ban": "발리어",
  "bm": "밤바라어",
  "vec": "베네치아어",
  "bew": "베타위어",
  "vi": "베트남어",
  "ve": "벤다어",
  "be": "벨라루스어",
  "bem": "벰바어",
  "bn": "벵골어",
  "bs": "보스니아어",
  "bho": "보즈푸리어",
  "bua": "부랴트어",
  "bg": "불가리아어",
  "br": "브르타뉴어",
  "bik": "비콜어",
  "sm": "사모아어",
  "se": "사미어(북부)",
  "zap": "사포텍어",
  "sa": "산스크리트어",
  "sat-Latn": "산탈어(라틴 문자)",
  "sat": "산탈어(올 치키 문자)",
  "sg": "상고어",
  "shn": "샨어",
  "sr": "세르비아어",
  "ceb": "세부아노어",
  "st": "세소토어",
  "crs": "세이셸 크리올어",
  "nso": "세페디어",
  "so": "소말리어",
  "sn": "쇼나어",
  "sus": "수수어",
  "su": "순다어",
  "ss": "스와티어",
  "sw": "스와힐리어",
  "sv": "스웨덴어",
  "gd": "스코틀랜드 게일어",
  "es": "스페인어",
  "sk": "슬로바키아어",
  "sl": "슬로베니아어",
  "scn": "시칠리아어",
  "sd": "신디어",
  "szl": "실레지아어",
  "si": "싱할라어",
  "ar": "아랍어",
  "hy": "아르메니아어",
  "av": "아바르어",
  "as": "아삼어",
  "awa": "아와디어",
  "ay": "아이마라어",
  "is": "아이슬란드어",
  "ht": "아이티 크리올어",
  "ga": "아일랜드어",
  "az": "아제르바이잔어",
  "ace": "아체어",
  "ach": "아촐리어",
  "aa": "아파르어",
  "af": "아프리칸스어",
  "alz": "알루르어",
  "sq": "알바니아어",
  "am": "암하라어",
  "ab": "압하지야어",
  "sah": "야쿠트어",
  "et": "에스토니아어",
  "eo": "에스페란토어",
  "ee": "에웨어",
  "or": "오디아어 (오리야어)",
  "om": "오로모어",
  "os": "오세트어",
  "oc": "오크어",
  "war": "와라이어",
  "yo": "요루바어",
  "udm": "우드무르트어",
  "ur": "우르두어",
  "uz": "우즈베크어",
  "uk": "우크라이나어",
  "wo": "월로프어",
  "cy": "웨일즈어",
  "ug": "위구르어",
  "yua": "유카텍 마야어",
  "ndc-ZW": "은다우어",
  "nr": "은데벨레어(남부)",
  "bm-Nkoo": "응코어",
  "ig": "이그보어",
  "iu-Latn": "이누크티투트어(라틴 문자)",
  "iu": "이누크티투트어(음절 문자)",
  "yi": "이디시어",
  "iba": "이반어",
  "it": "이탈리아어",
  "id": "인도네시아어",
  "ilo": "일로카노어",
  "ja": "일본어",
  "jam": "자메이카 파투아어",
  "jw": "자바어",
  "ka": "조지아어",
  "dz": "종카어",
  "zu": "줄루어",
  "zh-CN": "중국어(간체)",
  "zh-TW": "중국어(번체)",
  "kac": "징포어",
  "ch": "차모로어",
  "ny": "체와어",
  "ce": "체첸어",
  "cs": "체코어",
  "ts": "총가어",
  "cv": "추바시어",
  "chk": "추우케어",
  "tn": "츠와나어",
  "kha": "카시어",
  "kk": "카자흐어",
  "ca": "카탈로니아어",
  "pam": "카팜팡안어",
  "kn": "칸나다어",
  "kr": "칸누리어",
  "qu": "케추아어",
  "kek": "켁치어",
  "co": "코르시카어",
  "kv": "코미어",
  "xh": "코사어",
  "trp": "콕보록어",
  "gom": "콘칸어",
  "kg": "콩고어",
  "ckb": "쿠르드어(소라니)",
  "ku": "쿠르드어(쿠르만지)",
  "hr": "크로아티아어",
  "kri": "크리오어",
  "crh-Latn": "크림 타타르어(라틴 문자)",
  "crh": "크림 타타르어(키릴 문자)",
  "km": "크메르어",
  "cgg": "키가어",
  "rw": "키냐르완다어",
  "ky": "키르기스어",
  "ktu": "키투바어",
  "ber-Latn": "타마지트어",
  "ber": "타마지트어(티피나그)",
  "ta": "타밀어",
  "tg": "타지크어",
  "tt": "타타르어",
  "ty": "타히티어",
  "th": "태국어",
  "tet": "테툼어",
  "te": "텔루구어",
  "tpi": "톡 피신어",
  "to": "통가어",
  "tk": "투르크멘어",
  "tyv": "투바어",
  "tcy": "툴루어",
  "tum": "툼부카어",
  "tr": "튀르키예어",
  "ak": "트위어",
  "ti": "티그리냐어",
  "bo": "티베트어",
  "tiv": "티브어",
  "ps": "파슈토어",
  "pap": "파피아멘토어",
  "pag": "팡가시난어",
  "pa": "펀자브어(구르무키)",
  "pa-Arab": "펀자브어(샤무키)",
  "fo": "페로어",
  "fa": "페르시아어",
  "pt": "포르투갈어(브라질)",
  "pt-PT": "포르투갈어(포르투갈)",
  "fon": "폰어",
  "pl": "폴란드어",
  "ff": "풀라니어",
  "fr": "프랑스어",
  "fr-CA": "프랑스어(캐나다)",
  "fur": "프리울리어",
  "fy": "프리지아어",
  "fj": "피지어",
  "fi": "핀란드어",
  "tl": "필리핀어",
  "haw": "하와이어",
  "ha": "하우사어",
  "cnh": "하카 친어",
  "hu": "헝가리어",
  "hrx": "훈스뤼크어",
  "iw": "히브리어",
  "hi": "힌디어",
  "hil": "힐리가이논어",
});

const promptTranslationDisplayNames = typeof Intl.DisplayNames === "function"
  ? new Intl.DisplayNames(["ko"], { type: "language" })
  : null;

function promptTranslationShortCode(code) {
  const normalized = String(code || "").trim();
  if (PROMPT_TRANSLATION_VARIANT_SHORT_CODES[normalized]) {
    return PROMPT_TRANSLATION_VARIANT_SHORT_CODES[normalized];
  }
  const root = normalized.split("-")[0].toLowerCase();
  return PROMPT_TRANSLATION_SHORT_CODES[root] || root.toUpperCase();
}

function promptTranslationLanguageName(code) {
  const normalized = String(code || "").trim();
  if (PROMPT_TRANSLATION_LANGUAGE_NAME_OVERRIDES[normalized]) {
    return PROMPT_TRANSLATION_LANGUAGE_NAME_OVERRIDES[normalized];
  }
  try {
    const name = promptTranslationDisplayNames?.of(normalized);
    if (name && name.toLowerCase() !== normalized.toLowerCase()) return name;
  } catch {
    // The language code itself remains a usable fallback label.
  }
  return normalized.toUpperCase();
}

const PROMPT_TRANSLATION_LANGUAGES = Object.freeze(
  PROMPT_TRANSLATION_LANGUAGE_CODES
    .map((code) => Object.freeze({
      code,
      name: promptTranslationLanguageName(code),
      short: promptTranslationShortCode(code),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ko-KR")),
);
const PROMPT_TRANSLATION_LANGUAGE_MAP = new Map(
  PROMPT_TRANSLATION_LANGUAGES.map((language) => [language.code, language]),
);
const PROMPT_TRANSLATION_DETECTED_ALIASES = Object.freeze({
  he: "iw",
  jv: "jw",
  fil: "tl",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
});
const PROMPT_TRANSLATION_DELAY_MS = 1100;
const promptTranslationState = {
  sourceCode: "en",
  targetCode: "ko",
  automaticPair: true,
  openSide: "",
  timer: 0,
  requestVersion: 0,
  controller: null,
  // Hangul and every other IME fires `input` once per composition step, so pausing
  // mid-syllable used to send an unfinished cluster off for translation. Held while
  // a composition is open; compositionend hands the committed text back.
  composing: false,
  // Language pair plus the text of the translation currently on screen. A repeat of
  // that exact request has its answer already and never reaches the network.
  lastKey: "",
  translatedAt: "",
};

function promptTranslationKey(text) {
  const { sourceCode, targetCode } = promptTranslationState;
  return `${sourceCode}|${targetCode}|${text}`;
}

function syncAutomaticPromptTranslationPair(text) {
  if (!promptTranslationState.automaticPair) return false;
  const hasHangul = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(String(text || ""));
  const sourceCode = hasHangul ? "ko" : "en";
  const targetCode = hasHangul ? "en" : "ko";
  if (
    promptTranslationState.sourceCode === sourceCode
    && promptTranslationState.targetCode === targetCode
  ) return false;
  promptTranslationState.sourceCode = sourceCode;
  promptTranslationState.targetCode = targetCode;
  promptTranslationState.lastKey = "";
  syncPromptTranslationControls();
  return true;
}

function promptTranslationElements() {
  return {
    controls: promptSave?.querySelector(".prompt_translate_controls"),
    sourceLabel: promptSave?.querySelector('[data-prompt-language-label="source"]'),
    targetLabel: promptSave?.querySelector('[data-prompt-language-label="target"]'),
    sourceToggle: promptSave?.querySelector('[data-prompt-language-side="source"]'),
    targetToggle: promptSave?.querySelector('[data-prompt-language-side="target"]'),
    menu: promptSave?.querySelector(".prompt_language_menu"),
    search: promptSave?.querySelector(".prompt_language_search"),
    options: promptSave?.querySelector(".prompt_language_options"),
    original: promptSave?.querySelector(".prompt_save_original"),
    translation: promptSave?.querySelector(".prompt_save_translation"),
  };
}

function normalizedPromptLanguageSearch(value) {
  return String(value || "").normalize("NFC").trim().toLocaleLowerCase("ko-KR");
}

function normalizedDetectedPromptLanguage(value) {
  const raw = String(value || "").trim();
  const aliased = PROMPT_TRANSLATION_DETECTED_ALIASES[raw] || raw;
  if (PROMPT_TRANSLATION_LANGUAGE_MAP.has(aliased)) return aliased;
  const root = aliased.split("-")[0].toLowerCase();
  const rootAlias = PROMPT_TRANSLATION_DETECTED_ALIASES[root] || root;
  return PROMPT_TRANSLATION_LANGUAGE_MAP.has(rootAlias) ? rootAlias : "";
}

function promptTranslationSelectedCode(side = promptTranslationState.openSide) {
  return side === "source" ? promptTranslationState.sourceCode : promptTranslationState.targetCode;
}

function renderPromptTranslationLanguages({ revealSelected = false } = {}) {
  const { options, search } = promptTranslationElements();
  if (!options) return;
  const query = normalizedPromptLanguageSearch(search?.value);
  const selectedCode = promptTranslationSelectedCode();
  const matches = PROMPT_TRANSLATION_LANGUAGES.filter((language) => {
    if (!query) return true;
    return normalizedPromptLanguageSearch(`${language.name} ${language.short} ${language.code}`).includes(query);
  });
  const nodes = matches.map((language) => {
    const option = document.createElement("button");
    option.className = "prompt_language_option";
    option.type = "button";
    option.role = "option";
    option.dataset.languageCode = language.code;
    option.setAttribute("aria-selected", String(language.code === selectedCode));
    option.title = language.name;
    const check = document.createElement("span");
    check.className = "prompt_language_option_check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";
    const name = document.createElement("span");
    name.className = "prompt_language_option_name";
    name.textContent = language.name;
    const code = document.createElement("span");
    code.className = "prompt_language_option_code";
    code.textContent = language.short;
    option.append(check, name, code);
    return option;
  });
  if (!nodes.length) {
    const empty = document.createElement("p");
    empty.className = "prompt_language_empty";
    empty.textContent = "일치하는 언어가 없습니다.";
    nodes.push(empty);
  }
  options.replaceChildren(...nodes);
  if (revealSelected && !query) {
    requestAnimationFrame(() => {
      options.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
    });
  } else {
    options.scrollTop = 0;
  }
}

function syncPromptTranslationControls() {
  const elements = promptTranslationElements();
  const source = PROMPT_TRANSLATION_LANGUAGE_MAP.get(promptTranslationState.sourceCode);
  const target = PROMPT_TRANSLATION_LANGUAGE_MAP.get(promptTranslationState.targetCode);
  if (elements.sourceLabel && source) {
    elements.sourceLabel.textContent = source.short;
    elements.sourceLabel.title = source.name;
    elements.sourceLabel.dataset.languageCode = source.code;
  }
  if (elements.targetLabel && target) {
    elements.targetLabel.textContent = target.short;
    elements.targetLabel.title = target.name;
    elements.targetLabel.dataset.languageCode = target.code;
  }
  const menuOpen = Boolean(promptTranslationState.openSide);
  if (elements.sourceToggle) {
    elements.sourceToggle.setAttribute("aria-expanded", String(promptTranslationState.openSide === "source"));
  }
  if (elements.targetToggle) {
    elements.targetToggle.setAttribute("aria-expanded", String(promptTranslationState.openSide === "target"));
  }
  if (elements.menu) {
    elements.menu.hidden = !menuOpen;
    elements.menu.dataset.languageSide = promptTranslationState.openSide;
  }
}

function closePromptTranslationLanguageMenu() {
  if (!promptTranslationState.openSide) return false;
  promptTranslationState.openSide = "";
  const { search } = promptTranslationElements();
  if (search) search.value = "";
  syncPromptTranslationControls();
  return true;
}

function positionPromptTranslationLanguageMenu() {
  const { controls, menu } = promptTranslationElements();
  if (!controls || !menu || menu.hidden) return;
  const controlsTop = controls.getBoundingClientRect().top;
  menu.style.bottom = `${Math.max(8, window.innerHeight - controlsTop + 10)}px`;
}

function togglePromptTranslationLanguageMenu(side) {
  if (!PROMPT_TRANSLATION_LANGUAGE_MAP.size || !["source", "target"].includes(side)) return;
  const closing = promptTranslationState.openSide === side;
  promptTranslationState.openSide = closing ? "" : side;
  const { search } = promptTranslationElements();
  if (search) search.value = "";
  syncPromptTranslationControls();
  if (closing) return;
  positionPromptTranslationLanguageMenu();
  renderPromptTranslationLanguages({ revealSelected: true });
  requestAnimationFrame(() => search?.focus({ preventScroll: true }));
}

function cancelPromptTranslationWork() {
  window.clearTimeout(promptTranslationState.timer);
  promptTranslationState.timer = 0;
  promptTranslationState.requestVersion += 1;
  promptTranslationState.controller?.abort();
  promptTranslationState.controller = null;
  promptTranslationElements().controls?.removeAttribute("aria-busy");
}

function schedulePromptTranslation({ immediate = false, clear = true } = {}) {
  const { original, translation } = promptTranslationElements();
  cancelPromptTranslationWork();
  const text = String(original?.value || "").trim();
  if (!text) {
    syncAutomaticPromptTranslationPair("");
    if (translation) translation.value = "";
    promptTranslationState.lastKey = "";
    return;
  }
  if (promptTranslationState.composing) return;
  syncAutomaticPromptTranslationPair(text);
  if (promptTranslationKey(text) === promptTranslationState.lastKey) return;
  if (clear && translation) translation.value = "";
  promptTranslationState.timer = window.setTimeout(
    () => translatePromptSave(),
    immediate ? 0 : PROMPT_TRANSLATION_DELAY_MS,
  );
}

async function translatePromptSave({ detectSource = false, silent = false } = {}) {
  const { controls, original, translation } = promptTranslationElements();
  const text = String(original?.value || "").trim();
  if (!text) {
    if (translation) translation.value = "";
    original?.focus();
    return;
  }
  if (!detectSource) syncAutomaticPromptTranslationPair(text);
  const sourceCode = detectSource ? "auto" : promptTranslationState.sourceCode;
  const targetCode = promptTranslationState.targetCode;
  if (!detectSource && sourceCode === targetCode) {
    if (translation) translation.value = text;
    promptTranslationState.lastKey = promptTranslationKey(text);
    promptTranslationState.translatedAt = new Date().toISOString();
    return true;
  }
  window.clearTimeout(promptTranslationState.timer);
  promptTranslationState.timer = 0;
  promptTranslationState.controller?.abort();
  const controller = new AbortController();
  const requestVersion = ++promptTranslationState.requestVersion;
  promptTranslationState.controller = controller;
  controls?.setAttribute("aria-busy", "true");
  try {
    const translate = window.grokChameleonNative?.translatePrompt;
    if (typeof translate !== "function") {
      throw new Error("Desktop translation bridge is unavailable.");
    }
    const data = await translate({
      text,
      source_language_code: sourceCode,
      target_language_code: targetCode,
    });
    if (requestVersion !== promptTranslationState.requestVersion) return false;
    if (detectSource) {
      const detectedCode = normalizedDetectedPromptLanguage(data.detected_source_language_code);
      if (detectedCode) {
        promptTranslationState.sourceCode = detectedCode;
        syncPromptTranslationControls();
      }
    }
    if (translation) translation.value = normalizeNfcText(data.translation || "");
    promptTranslationState.lastKey = promptTranslationKey(text);
    promptTranslationState.translatedAt = new Date().toISOString();
    return true;
  } catch (error) {
    // A pair that failed must not read as already answered, or the next edit that
    // returns to this exact text would sit there with no translation and no request.
    promptTranslationState.lastKey = "";
    if (error?.name === "AbortError" || requestVersion !== promptTranslationState.requestVersion) return false;
    if (!silent) showErrorPanel("Translation failed", error?.message || "Translation failed.");
    return false;
  } finally {
    if (requestVersion === promptTranslationState.requestVersion) {
      promptTranslationState.controller = null;
      controls?.removeAttribute("aria-busy");
    }
  }
}

function detectPromptTranslationLanguage() {
  const { original } = promptTranslationElements();
  if (!String(original?.value || "").trim()) {
    original?.focus();
    return;
  }
  cancelPromptTranslationWork();
  closePromptTranslationLanguageMenu();
  promptTranslationState.automaticPair = false;
  translatePromptSave({ detectSource: true });
}

function selectPromptTranslationLanguage(code) {
  const language = PROMPT_TRANSLATION_LANGUAGE_MAP.get(String(code || ""));
  const side = promptTranslationState.openSide;
  if (!language || !["source", "target"].includes(side)) return;
  promptTranslationState.automaticPair = false;
  const changed = promptTranslationSelectedCode(side) !== language.code;
  if (side === "source") promptTranslationState.sourceCode = language.code;
  else promptTranslationState.targetCode = language.code;
  closePromptTranslationLanguageMenu();
  syncPromptTranslationControls();
  if (changed) schedulePromptTranslation({ immediate: true, clear: true });
}

function swapPromptTranslationLanguages() {
  const { original, translation } = promptTranslationElements();
  cancelPromptTranslationWork();
  closePromptTranslationLanguageMenu();
  promptTranslationState.automaticPair = false;
  [promptTranslationState.sourceCode, promptTranslationState.targetCode] = [
    promptTranslationState.targetCode,
    promptTranslationState.sourceCode,
  ];
  if (original && translation) {
    [original.value, translation.value] = [translation.value, original.value];
  }
  promptTranslationState.lastKey = "";
  syncPromptTranslationControls();
  original?.focus({ preventScroll: true });
}

function resetPromptTranslationDialog({
  translate = false,
  sourceCode = "en",
  targetCode = "ko",
  automaticPair = true,
  sourceText = "",
  translatedAt = "",
} = {}) {
  cancelPromptTranslationWork();
  promptTranslationState.sourceCode = PROMPT_TRANSLATION_LANGUAGE_MAP.has(sourceCode) ? sourceCode : "en";
  promptTranslationState.targetCode = PROMPT_TRANSLATION_LANGUAGE_MAP.has(targetCode) ? targetCode : "ko";
  promptTranslationState.automaticPair = Boolean(automaticPair);
  promptTranslationState.openSide = "";
  promptTranslationState.composing = false;
  const currentText = String(promptTranslationElements().original?.value || "").trim();
  syncAutomaticPromptTranslationPair(currentText);
  promptTranslationState.lastKey = sourceText.trim() === currentText && currentText
    ? promptTranslationKey(currentText)
    : "";
  promptTranslationState.translatedAt = String(translatedAt || "");
  const { search } = promptTranslationElements();
  if (search) search.value = "";
  syncPromptTranslationControls();
  if (translate) schedulePromptTranslation({ immediate: false, clear: true });
}
