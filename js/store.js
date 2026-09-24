/*
 * Data layer. Everything reads/writes through this object.
 * Backed by Supabase (Postgres) so every device sees the same program,
 * readers, and admins. Session (who is logged in on *this* device) stays in
 * localStorage — that's personal to the device, not shared data.
 */
const SUPABASE_URL = "https://onegxwlkhcxrblxsnehp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XtBRZU5o5Ew7kffPrP7izg_-zHbEs6r";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const SESSION_KEY = "wt-study-session-v1";

const BODY_STUB = "가져오기를 실행하면 이 자리에 항 본문이 채워집니다. 해설을 작성할 때 참고할 수 있도록 원문을 그대로 보관하며, 필요하면 소유자가 직접 다듬을 수 있습니다.";

const SEED_PARAGRAPHS = [
  { num: "1-2", heading: "왜 사랑으로 호소하는가", q: "바울이 빌레몬에게 명령하지 않고 호소한 이유는 무엇입니까?", r: "r1", side: "right", a: "바울은 사도로서 명령할 권위가 있었지만, 빌레몬이 강요가 아니라 자발적으로 선한 일을 하기를 바랐습니다. 그래서 권위를 앞세우지 않고 사랑에 근거해 호소했습니다." },
  { num: "3", heading: "왜 사랑으로 호소하는가", q: "사랑에 근거한 호소가 명령보다 효과적인 이유는 무엇입니까?", r: "r2", side: "left", a: "명령은 순종을 이끌어낼 수 있지만 마음을 움직이지는 못합니다. 사랑에 근거한 호소는 상대방이 스스로 결정하게 하므로 결과가 오래 지속됩니다." },
  { num: "4-5", heading: "호소하는 방법", q: "호소하기 전에 상대방의 좋은 점을 먼저 인정하면 어떤 도움이 됩니까?", r: "r1", side: "right", a: "" },
  { num: "6", heading: "호소하는 방법", q: "호소할 때 시간과 장소를 고려해야 하는 이유는 무엇입니까?", r: "", side: "right", a: "" },
  { num: "7-8", heading: "호소하는 방법", q: "겸손한 태도가 호소의 결과에 어떤 영향을 줍니까?", r: "r3", side: "left", a: "겸손하게 들어야 합니다. 호소하는 사람의 동기가 사랑임을 인정하고, 방어적으로 반응하기보다 먼저 말을 끝까지 듣는 것이 좋습니다." },
  { num: "9", heading: "호소를 받을 때", q: "호소를 받는 사람은 어떤 태도를 보이는 것이 좋습니까?", r: "r4", side: "right", a: "" },
  { num: "10-11", heading: "호소를 받을 때", q: "즉시 반응하기 어려울 때에도 어떻게 존중을 나타낼 수 있습니까?", r: "r2", side: "left", a: "" },
  { num: "12", heading: "결론", q: "이 기사에서 배운 점을 어떻게 적용하겠습니까?", r: "", side: "right", a: "" }
];

const DEFAULT_MESSAGE_TEMPLATE = `안녕하세요. 서초서부회중의 김재현 형제입니다.  10/25일 순회대회 파수대 해설에 함께 하게 되어 기쁩니다. 준비하실 내용은 아래와 같습니다.

📙 {issue} {title} 기사.

📋 {items}에 대한 해설.

📌 질문에 대한 직접적인 대답을 먼저 하시고 그 후에 성구적용, 개인적인 묵상을 포함 시키실 수 있습니다.

⏱ 대답의 길이는 30초입니다.

📆 원고제출일 : 2026년 9월 20일 일요일까지 김재현 형제에게 문자나 카톡으로 보내주십시오.

1️⃣ 1차 연습일 : 2026년 10월 4일 일요일 오후 5시 서초서부 왕국회관.

2️⃣ 2차 연습일 : 2026년 10월 18일 일요일 오후 5시 서초서부 왕국회관.

📮 회관의 주소는 서울시 서초구 방배동 983-11 (방배로 58) 봉심빌딩 3층입니다.

🏫 방배역 1번 출구에서 약 200m 거리이며 SK주유소를 지나 서점을 지나면 있는 3층 건물입니다. (건물의 1층에는 메가커피가 있습니다)

서초서부회중 김재현 형제 드림.
010-2691-1064`;

function seedProgram() {
  const now = Date.now();
  return {
    sourceUrl: "",
    issue: "파수대 2026년 8월호 14면",
    title: "“사랑 때문에 그대에게 호소합니다”",
    subtitle: "연구 기사 · 순회대회 파수대 연구",
    intro: "",
    items: SEED_PARAGRAPHS.map((s, i) => ({
      id: "p" + (i + 1),
      type: "paragraph",
      num: s.num,
      heading: s.heading,
      question: s.q,
      body: BODY_STUB,
      image: null,
      readerId: s.r,
      side: s.side,
      answer: s.a,
      updatedAt: s.a ? now - (i + 2) * 190000 : null,
      extraQuestion: "",
      extraAnswer: "",
      extraUpdatedAt: null
    }))
  };
}

function seedReaders() {
  return [
    { id: "r1", name: "박서연", gender: "sister", congregation: "", phone: "010-3355-1948", note: "" },
    { id: "r2", name: "이준호", gender: "brother", congregation: "", phone: "010-9012-4477", note: "" },
    { id: "r3", name: "최은비", gender: "sister", congregation: "", phone: "010-7743-2210", note: "" },
    { id: "r4", name: "정민수", gender: "brother", congregation: "", phone: "010-2841-7302", note: "" }
  ];
}

function seedAdmins() {
  return [{ id: "a0", name: "김재현", pw: "2643", role: "owner" }];
}

// Bring any item/reader shape from the DB up to what the UI expects, so a
// row created before a field existed doesn't crash rendering.
function normalizeItems(items) {
  (items || []).forEach(item => {
    if (!item.type) item.type = "paragraph";
    if (item.image === undefined) item.image = null;
    if (item.extraQuestion === undefined) item.extraQuestion = "";
    if (item.extraAnswer === undefined) item.extraAnswer = "";
    if (item.extraUpdatedAt === undefined) item.extraUpdatedAt = null;
  });
  return items || [];
}

function normalizeReaders(readers) {
  (readers || []).forEach(r => {
    if (r.gender === undefined) r.gender = "brother";
    if (r.congregation === undefined) r.congregation = "";
    if (r.note === undefined) r.note = "";
  });
  return readers || [];
}

function normalizeMessageTemplate(t) {
  if (!t) return DEFAULT_MESSAGE_TEMPLATE;
  if (t.indexOf("{items} 질문에 대한 해설.") !== -1) {
    return t.replace("{items} 질문에 대한 해설.", "{items}에 대한 해설.");
  }
  return t;
}

function rowToProgram(row) {
  return {
    sourceUrl: row.source_url || "",
    issue: row.issue || "",
    title: row.title || "",
    subtitle: row.subtitle || "",
    intro: row.intro || "",
    items: normalizeItems(row.items)
  };
}

function programToRow(program) {
  return {
    source_url: program.sourceUrl || "",
    issue: program.issue,
    title: program.title,
    subtitle: program.subtitle,
    intro: program.intro,
    items: program.items,
    updated_at: new Date().toISOString()
  };
}

async function fetchSettings() {
  const { data, error } = await sb.from("settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const fresh = { id: 1, active_source_url: "", message_template: DEFAULT_MESSAGE_TEMPLATE };
  await sb.from("settings").upsert(fresh);
  return fresh;
}

const Store = {
  async getData() {
    const settings = await fetchSettings();

    let { data: programRow, error: progErr } = await sb
      .from("programs").select("*").eq("source_url", settings.active_source_url || "").maybeSingle();
    if (progErr) throw progErr;
    let program;
    if (programRow) {
      program = rowToProgram(programRow);
    } else {
      program = seedProgram();
      await sb.from("programs").upsert(programToRow(program));
    }

    let { data: readers, error: readersErr } = await sb.from("readers").select("*").order("name");
    if (readersErr) throw readersErr;
    if (!readers || readers.length === 0) {
      readers = seedReaders();
      await sb.from("readers").upsert(readers);
    }
    normalizeReaders(readers);

    let { data: admins, error: adminsErr } = await sb.from("admins").select("*");
    if (adminsErr) throw adminsErr;
    if (!admins || admins.length === 0) {
      admins = seedAdmins();
      await sb.from("admins").upsert(admins);
    }

    const messageTemplate = normalizeMessageTemplate(settings.message_template);
    if (messageTemplate !== settings.message_template) {
      await sb.from("settings").update({ message_template: messageTemplate }).eq("id", 1);
    }

    return { program, readers, admins, messageTemplate };
  },

  async saveData(data) {
    const ops = [sb.from("programs").upsert(programToRow(data.program))];
    ops.push(sb.from("settings").upsert({ id: 1, active_source_url: data.program.sourceUrl || "", message_template: data.messageTemplate }));
    if (data.readers.length) ops.push(sb.from("readers").upsert(data.readers));
    if (data.admins.length) ops.push(sb.from("admins").upsert(data.admins));
    const results = await Promise.all(ops);
    results.forEach(r => { if (r.error) throw r.error; });
  },

  async deleteReader(id) {
    const { error } = await sb.from("readers").delete().eq("id", id);
    if (error) throw error;
  },

  async deleteAdmin(id) {
    const { error } = await sb.from("admins").delete().eq("id", id);
    if (error) throw error;
  },

  // Archive: every row in `programs` other than the blank draft ("") is a
  // past import, keyed by its source URL, so switching articles and back
  // restores everything (assignments + answers included) with no re-fetch.
  async getArchive() {
    const { data, error } = await sb.from("programs").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    const archive = {};
    (data || []).forEach(row => {
      if (!row.source_url) return;
      archive[row.source_url] = {
        sourceUrl: row.source_url,
        issue: row.issue,
        title: row.title,
        subtitle: row.subtitle,
        intro: row.intro,
        items: normalizeItems(row.items),
        savedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
      };
    });
    return archive;
  },

  async deleteArchiveEntry(sourceUrl) {
    const { error } = await sb.from("programs").delete().eq("source_url", sourceUrl);
    if (error) throw error;
  },

  getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  saveSession(session) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
  },

  clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
};
