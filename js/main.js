/* 파수대 연구 진행 도구 — vanilla JS implementation of the hifi design handoff. */

const root = document.getElementById("root");

const state = {
  data: { program: { sourceUrl: "", issue: "", title: "", subtitle: "", intro: "", items: [] }, readers: [], admins: [], messageTemplate: "" },
  archive: {},
  session: Store.getSession(),
  screen: "login",
  nameInput: "",
  pwInput: "",
  loginError: "",
  selectedId: null,
  urlInput: "https://wol.jw.org/ko/wol/d/r8/lp-ko/2026522",
  importPhase: "idle",
  importStep: 0,
  importError: "",
  keepAssignments: true,
  newReaderName: "",
  newReaderGender: "brother",
  newReaderCongregation: "",
  newReaderPhone: "",
  newReaderNote: "",
  readerUploadMsg: "",
  noticePreviewId: null,
  noticeMsg: "",
  newAdminName: "",
  newAdminPw: "",
  pw1: "",
  pw2: "",
  pwMsg: "",
  pwOk: false,
  bodyOpen: false
};

let importTimer = null;
let tickTimer = setInterval(() => { updateAllSavedLabels(); }, 20000);

// ---------- small helpers ----------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  attrs = attrs || {};
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (k === "disabled") el.disabled = !!v;
    else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  children.flat(Infinity).forEach(c => {
    if (c === null || c === undefined || c === false) return;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(c) : c);
  });
  return el;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Fire-and-forget sync to Supabase. The local `state.data` (already updated
// by the caller before persistData() runs) stays the source of truth for
// rendering, so typing/UI never waits on the network. We also update the
// local archive cache optimistically so the "저장된 기사" list reflects the
// change immediately, without waiting for a re-fetch.
function persistData() {
  const P = state.data.program;
  if (P.sourceUrl) {
    state.archive[P.sourceUrl] = {
      sourceUrl: P.sourceUrl, issue: P.issue, title: P.title, subtitle: P.subtitle,
      intro: P.intro, items: P.items, savedAt: Date.now()
    };
  }
  Store.saveData(state.data).catch(err => console.error("저장 실패:", err));
}

// Re-pulls program + readers + admins + archive from Supabase so this
// device sees what other devices/people have changed. Used on login and on
// every top-nav tab switch — not while a field is focused, so it never
// fights with the "no re-render mid-edit" rule elsewhere in this file.
async function refreshData() {
  try {
    const [data, archive] = await Promise.all([Store.getData(), Store.getArchive()]);
    state.data = data;
    state.archive = archive;
    if (!findItem(state.selectedId) && state.data.program.items.length) state.selectedId = state.data.program.items[0].id;
    return true;
  } catch (e) {
    console.error("불러오기 실패:", e);
    return false;
  }
}

// Switches screens immediately with whatever is cached locally (snappy),
// then quietly refreshes from the server and re-renders once that lands.
function goScreen(screen) {
  state.screen = screen;
  render();
  refreshData().then(ok => { if (ok) render(); });
}

function homeFor(session) {
  if (session.kind === "reader") return "my";
  return session.role === "owner" ? "import" : "edit";
}

function ago(ts) {
  if (!ts) return "아직 저장된 해설이 없습니다";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "방금 저장됨";
  if (m < 60) return m + "분 전 저장됨";
  return Math.floor(m / 60) + "시간 전 저장됨";
}

function smsHref(phone) { return "sms:" + String(phone || "").replace(/[^0-9+]/g, ""); }

function sideLabel(side) { return side === "left" ? "연단 왼편" : "연단 오른편"; }
function sideChipClass(side) { return "chip " + (side === "left" ? "chip-left" : "chip-right"); }

function findReader(id) { return state.data.readers.find(r => r.id === id) || null; }
function findItem(id) { return state.data.program.items.find(p => p.id === id) || null; }
function isIllustration(item) { return !!item && item.type === "illustration"; }
function isComment(item) { return !!item && item.type === "comment"; }
function isDivider(item) { return !!item && item.type === "divider"; }
function isAssignable(item) { return !!item && (item.type === "paragraph" || item.type === "illustration"); }

function itemChipLabel(item) {
  if (isIllustration(item)) return "삽화";
  if (isComment(item)) return "코멘트";
  if (isDivider(item)) return "구분선";
  return (item.num || "—") + "항";
}

// The stage walks the intro (if written) as a step before item 1, without
// storing it as a real item — it's a single program-level field, not
// something that can be moved or deleted like the rest of the list.
function badgeFor(item) {
  if (!item.readerId) return { label: "미배정", cls: "chip chip-unassigned" };
  if (!item.answer) return { label: "해설 대기", cls: "chip chip-waiting" };
  return { label: "작성 완료", cls: "chip chip-done" };
}

function isOwner() { return !!state.session && state.session.role === "owner"; }
function isEditorOnly() { return !!state.session && state.session.role === "editor"; }
function isReader() { return !!state.session && state.session.kind === "reader"; }

// Tracks every "N분 전 저장됨"-style label on screen so the 20s tick can
// refresh them without a full re-render. Entries for elements no longer in
// the document are dropped lazily.
const savedLabelRegistry = [];
function registerSavedLabel(item, tsField, el) {
  savedLabelRegistry.push({ item, tsField, el });
}
function updateAllSavedLabels() {
  for (let i = savedLabelRegistry.length - 1; i >= 0; i--) {
    const entry = savedLabelRegistry[i];
    if (!entry.el.isConnected) { savedLabelRegistry.splice(i, 1); continue; }
    entry.el.textContent = ago(entry.item[entry.tsField]);
  }
}

// Debounced autosave for a text field on an item (used for both the main
// answer and the optional extra-question answer). Keyed per item+field so
// the two don't clobber each other's timer.
function scheduleFieldSave(item, tsField, debounceKey) {
  const key = "_debounce_" + debounceKey;
  if (!item[key]) {
    item[key] = debounce(() => {
      item[tsField] = Date.now();
      persistData();
      updateAllSavedLabels();
    }, 800);
  }
  item[key]();
}

// live-binding: update state/data on every keystroke without ever re-rendering
// mid-edit (a re-render while a field is focused can race with the click that
// follows — e.g. clicking a "save" button blurs the field first — and drop
// the click). Dependent UI (labels, summaries, badges) simply refreshes on
// the next explicit action (selection change, tab switch, button click).
function liveInput(el, setter) {
  el.addEventListener("input", e => setter(e.target.value));
  return el;
}

function field(labelText, inputEl) {
  return h("div", { class: "field" }, h("label", null, labelText), inputEl);
}

function resizeImageFile(file, maxWidth, quality, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const hgt = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = hgt;
      canvas.getContext("2d").drawImage(img, 0, 0, w, hgt);
      cb(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ---------- render dispatch ----------

function normalizeScreen() {
  if (!state.session) return;
  const allowed = isOwner()
    ? ["import", "edit", "readers", "stage", "profile"]
    : isEditorOnly()
      ? ["edit", "profile"]
      : ["my", "answer", "profile"];
  if (allowed.indexOf(state.screen) === -1) state.screen = homeFor(state.session);
}

function render() {
  normalizeScreen();
  root.innerHTML = "";
  if (!state.session) { root.appendChild(renderLogin()); return; }
  if (state.screen === "stage") { root.appendChild(renderStage()); return; }
  root.appendChild(renderShell());
}

// ---------- login ----------

function doLogin() {
  const name = state.nameInput.trim();
  const pw = state.pwInput.trim();
  if (!name || !pw) { state.loginError = "이름과 비밀번호를 입력해 주세요."; render(); return; }
  const admin = state.data.admins.find(a => a.name === name && a.pw === pw);
  if (admin) {
    state.session = { kind: "admin", id: admin.id, name: admin.name, role: admin.role };
    Store.saveSession(state.session);
    state.screen = homeFor(state.session);
    state.loginError = ""; state.pwInput = ""; state.nameInput = "";
    render();
    return;
  }
  const reader = state.data.readers.find(r => r.name === name && r.phone.slice(-4) === pw);
  if (reader) {
    state.session = { kind: "reader", id: reader.id, name: reader.name, role: "reader" };
    Store.saveSession(state.session);
    state.screen = homeFor(state.session);
    state.loginError = ""; state.pwInput = ""; state.nameInput = "";
    render();
    return;
  }
  state.loginError = "이름 또는 비밀번호가 맞지 않습니다.";
  render();
}

function doLogout() {
  Store.clearSession();
  state.session = null;
  state.screen = "login";
  state.nameInput = ""; state.pwInput = ""; state.pw1 = ""; state.pw2 = ""; state.pwMsg = "";
  render();
}

function renderLogin() {
  const nameEl = liveInput(h("input", { class: "input", type: "text", placeholder: "이름", value: state.nameInput }), v => state.nameInput = v);
  const pwEl = liveInput(h("input", { class: "input login-pw-input", type: "password", inputmode: "numeric", placeholder: "••••", value: state.pwInput }), v => state.pwInput = v);
  [nameEl, pwEl].forEach(el => el.addEventListener("keydown", e => {
    if (e.key === "Enter") { state.nameInput = nameEl.value; state.pwInput = pwEl.value; doLogin(); }
  }));
  // clear error as soon as the user types again
  [nameEl, pwEl].forEach(el => el.addEventListener("input", () => { if (state.loginError) { state.loginError = ""; } }));

  return h("div", { class: "login-wrap" },
    h("div", { class: "login-head" },
      h("div", { class: "login-title" }, "파수대 연구 진행 도구"),
      h("div", { class: "login-sub" }, "순회대회 프로그램 준비 · 진행용 임시 사이트")
    ),
    h("div", { class: "login-card" },
      field("이름", nameEl),
      field("비밀번호", pwEl),
      state.loginError ? h("div", { class: "banner-error" }, state.loginError) : null,
      h("button", { class: "btn btn-primary login-btn", style: "width:100%", onclick: () => { state.nameInput = nameEl.value; state.pwInput = pwEl.value; doLogin(); } }, "로그인"),
      h("div", { class: "login-note" }, "로그아웃할 때까지 이 기기에서 로그인이 유지됩니다.", h("br"), "등단자 비밀번호는 전화번호 뒤 4자리입니다.")
    )
  );
}

// ---------- shell (topbar + tabs) ----------

function renderShell() {
  const wrap = h("div", null);
  const topbar = h("div", { class: "topbar" },
    h("div", { class: "topbar-inner" },
      h("div", { class: "brand" }, "파수대 연구"),
      h("div", { class: "tabs" }, ...navTabs()),
      h("div", { class: "topbar-right" },
        h("span", { class: roleChipClass() }, roleChipLabel()),
        h("button", { class: "logout-btn", onclick: doLogout }, "로그아웃")
      )
    )
  );
  const main = h("div", { class: "shell-main" }, screenContent());
  wrap.appendChild(topbar);
  wrap.appendChild(main);
  return wrap;
}

function navTabs() {
  const defs = isOwner()
    ? [["가져오기", "import"], ["항 편집", "edit"], ["등단자", "readers"], ["진행 화면", "stage"], ["내 프로필", "profile"]]
    : isEditorOnly()
      ? [["해설 편집", "edit"], ["내 프로필", "profile"]]
      : [["내 항 목록", "my"], ["내 프로필", "profile"]];
  return defs.map(([label, screen]) => h("button", {
    class: "tab-btn" + (state.screen === screen || (screen === "my" && state.screen === "answer") ? " active" : ""),
    onclick: () => goScreen(screen)
  }, label));
}

function roleChipLabel() {
  if (isOwner()) return "소유자 · 사회자";
  if (isEditorOnly()) return "관리자 · 해설 편집";
  return "등단자";
}
function roleChipClass() {
  if (isOwner()) return "chip chip-owner";
  if (isEditorOnly()) return "chip chip-editor";
  return "chip chip-reader";
}

function screenContent() {
  switch (state.screen) {
    case "import": return renderImport();
    case "edit": return renderEdit();
    case "readers": return renderReaders();
    case "profile": return renderProfile();
    case "my": return renderMy();
    case "answer": return renderAnswer();
    default: return h("div");
  }
}

// ---------- import ----------

const IMPORT_STEPS = ["기사 페이지 요청", "헤더 · 호수 · 제목 추출", "소제목과 항 번호 구조 분석", "연구 질문 매칭"];

function applyImportedProgram(data) {
  const P = state.data.program;
  const oldItems = P.items;
  const oldByNum = {};
  oldItems.forEach(it => { if (!isIllustration(it) && it.num) oldByNum[it.num] = it; });

  // Illustrations and host comments aren't part of the fetched article, so
  // to survive a re-import we remember which paragraph each one followed
  // and re-insert it after that same paragraph (matched by num) once the
  // new list exists.
  const extras = [];
  let precedingNum = null;
  oldItems.forEach(it => {
    if (isIllustration(it) || isComment(it) || isDivider(it)) extras.push({ item: it, afterNum: precedingNum });
    else if (it.num) precedingNum = it.num;
  });

  const newParagraphs = data.paragraphs.map((raw, i) => {
    const prev = state.keepAssignments ? oldByNum[raw.num] : null;
    return {
      id: prev ? prev.id : "p" + Date.now() + "_" + i,
      type: "paragraph",
      num: raw.num,
      heading: raw.heading,
      question: raw.question,
      body: raw.body,
      image: null,
      readerId: prev ? prev.readerId : "",
      side: prev ? prev.side : "right",
      answer: prev ? prev.answer : "",
      updatedAt: prev ? prev.updatedAt : null,
      extraQuestion: prev ? (prev.extraQuestion || "") : "",
      extraAnswer: prev ? (prev.extraAnswer || "") : "",
      extraUpdatedAt: prev ? (prev.extraUpdatedAt || null) : null
    };
  });

  let finalItems = newParagraphs;
  if (state.keepAssignments) {
    extras.forEach(({ item, afterNum }) => {
      let insertAt;
      if (afterNum === null) {
        insertAt = 0;
      } else {
        const idx = finalItems.findIndex(it => it.num === afterNum);
        insertAt = idx === -1 ? finalItems.length : idx + 1;
      }
      finalItems = finalItems.slice(0, insertAt).concat([item], finalItems.slice(insertAt));
    });
  }

  P.issue = data.issue || P.issue;
  P.title = data.title || P.title;
  P.subtitle = data.subtitle || P.subtitle;
  P.sourceUrl = data.sourceUrl || P.sourceUrl;
  P.items = finalItems;
  if (!findItem(state.selectedId) && finalItems.length) state.selectedId = finalItems[0].id;
  persistData();
}

function runImport() {
  clearInterval(importTimer);
  state.importPhase = "running";
  state.importStep = 0;
  state.importError = "";
  render();

  let stepTimer = setInterval(() => {
    state.importStep = Math.min(state.importStep + 1, IMPORT_STEPS.length - 2);
    render();
  }, 550);

  fetch("/api/import?url=" + encodeURIComponent(state.urlInput))
    .then(res => res.json())
    .then(result => {
      clearInterval(stepTimer);
      if (!result.ok) {
        state.importPhase = "idle";
        state.importError = result.error || "가져오기에 실패했습니다.";
        render();
        return;
      }
      state.importStep = IMPORT_STEPS.length - 1;
      applyImportedProgram(result.data);
      state.importPhase = "done";
      render();
    })
    .catch(() => {
      clearInterval(stepTimer);
      state.importPhase = "idle";
      state.importError = "서버에 연결할 수 없습니다. server.py가 실행 중인지 확인해 주세요.";
      render();
    });
}

function loadArchivedArticle(sourceUrl) {
  const entry = state.archive[sourceUrl];
  if (!entry) return;
  state.data.program = {
    issue: entry.issue,
    title: entry.title,
    subtitle: entry.subtitle,
    sourceUrl: entry.sourceUrl,
    intro: entry.intro || "",
    items: JSON.parse(JSON.stringify(entry.items))
  };
  state.selectedId = state.data.program.items[0] ? state.data.program.items[0].id : null;
  persistData();
  state.screen = "edit";
  render();
}

function deleteArchivedArticle(sourceUrl) {
  if (!confirm("이 저장된 기사를 삭제할까요? 되돌릴 수 없습니다.")) return;
  delete state.archive[sourceUrl];
  render();
  Store.deleteArchiveEntry(sourceUrl).catch(err => console.error("삭제 실패:", err));
}

function renderArchiveList() {
  const entries = Object.keys(state.archive).map(k => state.archive[k]).sort((a, b) => b.savedAt - a.savedAt);
  if (!entries.length) return null;
  return h("div", { style: "display:flex;flex-direction:column;gap:10px;" },
    h("div", { style: "font-size:13px;font-weight:700;color:var(--ink-2);" }, "저장된 기사 (" + entries.length + "개)"),
    ...entries.map(entry => h("div", { class: "card", style: "display:flex;align-items:center;gap:14px;flex-wrap:wrap;" },
      h("div", { style: "flex:1;min-width:200px;display:flex;flex-direction:column;gap:2px;" },
        h("div", { style: "font-size:12px;color:var(--ink-4);" }, entry.issue || ""),
        h("div", { style: "font-weight:700;" }, entry.title),
        h("div", { style: "font-size:12px;color:var(--ink-4);" }, "항목 " + entry.items.length + "개 · " + ago(entry.savedAt))
      ),
      entry.sourceUrl === state.data.program.sourceUrl
        ? h("span", { class: "chip chip-done" }, "현재 작업 중")
        : h("button", { class: "btn btn-secondary", onclick: () => loadArchivedArticle(entry.sourceUrl) }, "불러오기"),
      h("button", { class: "btn-danger", style: "border-radius:8px;padding:0 14px;height:40px;font-size:13px;background:#fff;", onclick: () => deleteArchivedArticle(entry.sourceUrl) }, "삭제")
    ))
  );
}

function renderImport() {
  const list = state.data.program.items;
  const urlEl = liveInput(h("input", { class: "input", type: "url", value: state.urlInput, placeholder: "https://wol.jw.org/ko/wol/d/..." }), v => state.urlInput = v);

  const children = [
    h("div", { style: "display:flex;flex-direction:column;gap:6px;" },
      h("h1", { class: "page-title-lg" }, "링크 가져오기"),
      h("p", { class: "section-desc" }, "파수대 기사 주소를 붙여넣으면 헤더 · 소제목 · 항 · 질문을 자동으로 불러옵니다.")
    ),
    h("div", { class: "card", style: "display:flex;flex-direction:column;gap:14px;" },
      field("기사 URL", urlEl),
      h("div", { style: "display:flex;gap:10px;flex-wrap:wrap;" },
        h("button", { class: "btn btn-primary", disabled: state.importPhase === "running", onclick: runImport }, state.importPhase === "running" ? "가져오는 중…" : "가져오기"),
        h("button", { class: "btn btn-secondary", onclick: () => { state.screen = "edit"; render(); } }, "수동으로 항 입력")
      ),
      state.importError ? h("div", { class: "banner-error" }, state.importError) : null
    )
  ];

  if (state.importPhase === "running") {
    children.push(h("div", { class: "import-steps" },
      ...IMPORT_STEPS.map((label, i) => h("div", { class: "import-step-row" + (i <= state.importStep ? " active-text" : "") },
        h("span", { class: "import-dot" + (i <= state.importStep ? " active" : "") }),
        h("span", { class: "import-label" }, label)
      ))
    ));
  }

  if (state.importPhase === "done") {
    const paragraphCount = list.filter(it => it.type === "paragraph").length;
    const keepEl = h("input", { type: "checkbox", checked: state.keepAssignments });
    keepEl.addEventListener("change", e => { state.keepAssignments = e.target.checked; });
    children.push(h("div", { class: "import-done-card" },
      h("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;" },
        h("span", { class: "chip chip-done" }, "가져오기 완료"),
        h("span", { style: "font-size:13px;color:var(--ink-3);" }, "소제목 " + new Set(list.map(p => p.heading).filter(Boolean)).size + "개 · 항 " + paragraphCount + "개 · 질문 " + paragraphCount + "개")
      ),
      h("div", { class: "import-preview" },
        h("div", { class: "issue" }, state.data.program.issue),
        h("div", { class: "title" }, state.data.program.title)
      ),
      h("div", { class: "banner-warn" }, "기사마다 조판이 달라 자동 추출이 완벽하지 않을 수 있습니다. 항 편집 화면에서 항 번호 · 질문 · 소제목을 꼭 확인해 주세요."),
      h("label", { class: "checkbox-row" }, keepEl, "재가져오기 시 등단자 배정과 해설은 유지하고 본문 · 질문만 갱신"),
      h("button", { class: "btn btn-primary", style: "align-self:flex-start;", onclick: () => { state.screen = "edit"; render(); } }, "항 편집으로 이동")
    ));
  }

  const archiveBlock = renderArchiveList();
  if (archiveBlock) children.push(archiveBlock);

  return h("div", { class: "screen-narrow" }, ...children);
}

// ---------- edit ----------

function editSummary() {
  const list = state.data.program.items;
  const paragraphs = list.filter(it => it.type === "paragraph");
  const illustrations = list.filter(isIllustration);
  const comments = list.filter(isComment);
  const assignable = list.filter(isAssignable);
  const answered = assignable.filter(it => it.answer).length;
  const unassigned = assignable.filter(it => !it.readerId).length;
  let s = "항 " + paragraphs.length + "개";
  if (illustrations.length) s += " · 삽화 " + illustrations.length + "개";
  if (comments.length) s += " · 코멘트 " + comments.length + "개";
  s += " · 해설 완료 " + answered + "개 · 미배정 " + unassigned + "개";
  return s;
}

function insertIndexAfterSelected() {
  const list = state.data.program.items;
  const i = list.findIndex(it => it.id === state.selectedId);
  return i === -1 ? list.length : i + 1;
}

function addParagraph() {
  const id = "p" + Date.now();
  const item = {
    id, type: "paragraph", num: "", heading: "", question: "", body: "", image: null,
    readerId: "", side: "right", answer: "", updatedAt: null,
    extraQuestion: "", extraAnswer: "", extraUpdatedAt: null
  };
  state.data.program.items.splice(insertIndexAfterSelected(), 0, item);
  state.selectedId = id;
  persistData();
  render();
}

function addIllustration() {
  const id = "img" + Date.now();
  const item = {
    id, type: "illustration", num: "", heading: "", question: "", body: "", image: null,
    readerId: "", side: "right", answer: "", updatedAt: null,
    extraQuestion: "", extraAnswer: "", extraUpdatedAt: null
  };
  state.data.program.items.splice(insertIndexAfterSelected(), 0, item);
  state.selectedId = id;
  persistData();
  render();
}

function addComment() {
  const id = "cmt" + Date.now();
  const item = {
    id, type: "comment", num: "", heading: "", question: "", body: "", image: null,
    readerId: "", side: "right", answer: "", updatedAt: null,
    extraQuestion: "", extraAnswer: "", extraUpdatedAt: null
  };
  state.data.program.items.splice(insertIndexAfterSelected(), 0, item);
  state.selectedId = id;
  persistData();
  render();
}

function addDivider() {
  const id = "div" + Date.now();
  const item = {
    id, type: "divider", num: "", heading: "", question: "", body: "", image: null,
    readerId: "", side: "right", answer: "", updatedAt: null,
    extraQuestion: "", extraAnswer: "", extraUpdatedAt: null
  };
  state.data.program.items.splice(insertIndexAfterSelected(), 0, item);
  state.selectedId = id;
  persistData();
  render();
}

function moveItem(id, dir) {
  const list = state.data.program.items;
  const i = list.findIndex(p => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
  persistData();
  render();
}

function deleteItem(id) {
  state.data.program.items = state.data.program.items.filter(p => p.id !== id);
  if (state.selectedId === id) state.selectedId = state.data.program.items[0] ? state.data.program.items[0].id : null;
  persistData();
  render();
}

function renderEdit() {
  const list = state.data.program.items;
  const owner = isOwner();
  const editorOnly = isEditorOnly();
  const sel = findItem(state.selectedId);

  const top = [];

  if (owner) {
    const P = state.data.program;
    const issueEl = liveInput(h("input", { class: "input", type: "text", value: P.issue }), v => P.issue = v);
    const titleEl = liveInput(h("input", { class: "input", type: "text", value: P.title }), v => P.title = v);
    const subEl = liveInput(h("input", { class: "input", type: "text", value: P.subtitle }), v => P.subtitle = v);
    [issueEl, titleEl, subEl].forEach(el => el.addEventListener("blur", persistData));
    top.push(h("div", { class: "card grid-auto-220" },
      field("호수 / 면", issueEl),
      field("기사 제목", titleEl),
      field("부제", subEl)
    ));
  }

  top.push(h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;" },
    h("div", { style: "display:flex;align-items:baseline;gap:12px;" },
      h("h1", { class: "page-title" }, "항 편집"),
      h("span", { style: "font-size:13px;color:var(--ink-3);" }, editSummary())
    ),
    owner ? h("div", { style: "display:flex;gap:10px;flex-wrap:wrap;" },
      h("button", { class: "btn btn-secondary", onclick: addParagraph }, "＋ 항 추가"),
      h("button", { class: "btn btn-secondary", onclick: addIllustration }, "＋ 삽화 추가"),
      h("button", { class: "btn btn-secondary", onclick: addComment }, "＋ 코멘트 추가"),
      h("button", { class: "btn btn-secondary", onclick: addDivider }, "＋ 가로줄 추가"),
      h("button", { class: "btn btn-ink", onclick: () => goScreen("stage") }, "진행 화면 열기")
    ) : null
  ));

  if (owner && sel) {
    top.push(h("div", { style: "font-size:12px;color:var(--ink-4);" }, "＋ 버튼은 왼쪽에서 선택된 항목 바로 다음 자리에 삽입됩니다. 위치는 ↑ ↓ 로 조정하세요."));
  }

  if (editorOnly) {
    top.push(h("div", { class: "banner-info" }, "해설 편집 권한입니다. 항 번호 · 질문 · 등단자 배정은 보기만 가능하며 해설 내용만 수정할 수 있습니다."));
  }

  const cards = list.map(p => {
    const illus = isIllustration(p);
    const comment = isComment(p);
    const divider = isDivider(p);
    const r = (comment || divider) ? null : findReader(p.readerId);
    const badge = (comment || divider) ? null : badgeFor(p);
    const card = h("div", { class: "para-card" + (p.id === state.selectedId ? " selected" : "") },
      h("div", {
        class: "para-card-top",
        onclick: () => { state.selectedId = p.id; render(); }
      },
        divider
          ? h("div", { class: "para-meta-row" },
              h("span", { class: "chip-num" }, "구분선"),
              h("hr", { style: "flex:1;border:none;border-top:1px solid var(--border-input);margin:0;" })
            )
          : h("div", { class: "para-meta-row" },
              h("span", { class: "chip-num" }, itemChipLabel(p)),
              h("span", { class: "para-heading" }, p.heading || "소제목 없음"),
              badge ? h("span", { class: badge.cls }, badge.label) : null
            ),
        illus && p.image ? h("img", { src: p.image, style: "max-width:120px;max-height:80px;border-radius:8px;display:block;object-fit:cover;" }) : null,
        divider ? null : h("div", { class: "para-question" }, p.question || (illus ? "삽화 설명을 입력하세요" : comment ? "사회자 코멘트를 입력하세요" : "질문을 입력하세요")),
        (comment || divider) ? null : h("div", { class: "para-sub-row" },
          h("span", { class: "para-reader-label" }, r ? r.name : "등단자 미배정"),
          h("span", { class: sideChipClass(p.side) }, sideLabel(p.side))
        )
      )
    );
    if (owner) {
      card.appendChild(h("div", { class: "para-actions" },
        h("button", { class: "icon-btn", onclick: (e) => { e.stopPropagation(); moveItem(p.id, -1); } }, "↑"),
        h("button", { class: "icon-btn", onclick: (e) => { e.stopPropagation(); moveItem(p.id, 1); } }, "↓"),
        h("div", { style: "flex:1;" }),
        h("button", { class: "btn-danger", style: "border-radius:8px;padding:0 14px;height:40px;font-size:13px;background:#fff;", onclick: (e) => { e.stopPropagation(); deleteItem(p.id); } }, "삭제")
      ));
    }
    return card;
  });

  const detail = h("div", { class: "detail-panel" });
  if (sel) {
    const illus = isIllustration(sel);
    const comment = isComment(sel);
    const divider = isDivider(sel);
    detail.appendChild(h("div", { class: "detail-title" }, "상세 편집 · " + (illus ? "삽화" : comment ? "코멘트" : divider ? "구분선" : (sel.num || "—") + "항")));

    if (divider) {
      detail.appendChild(h("div", { style: "color:var(--ink-4);font-size:14px;padding:12px 0;" }, "구분선입니다. 편집할 내용이 없으며, 목록에서 ↑ ↓ 로 위치만 조정할 수 있습니다."));
    } else if (comment) {
      if (owner) {
        const headingEl = liveInput(h("input", { class: "input", type: "text", value: sel.heading, placeholder: "예: 무대 전환, 인사말" }), v => sel.heading = v);
        const textEl = liveInput(h("textarea", { class: "input question-textarea", rows: 6, value: sel.question, placeholder: "사회자가 이 자리에서 할 코멘트를 적어 두세요." }), v => sel.question = v);
        textEl.value = sel.question;
        [headingEl, textEl].forEach(el => el.addEventListener("blur", persistData));
        detail.appendChild(field("라벨 (선택)", headingEl));
        detail.appendChild(field("코멘트 내용", textEl));
      } else {
        detail.appendChild(h("div", { class: "readonly-box" },
          h("div", { class: "q" }, sel.question || "코멘트가 비어 있습니다.")
        ));
      }
    } else {

    if (owner && !illus) {
      const numEl = liveInput(h("input", { class: "input", type: "text", value: sel.num }), v => sel.num = v);
      const headingEl = liveInput(h("input", { class: "input", type: "text", value: sel.heading }), v => sel.heading = v);
      const qEl = liveInput(h("textarea", { class: "input question-textarea", rows: 2, value: sel.question }), v => sel.question = v);
      qEl.value = sel.question;
      const bodyEl = liveInput(h("textarea", { class: "input body-textarea", rows: 4, value: sel.body }), v => sel.body = v);
      bodyEl.value = sel.body;
      [numEl, headingEl, qEl, bodyEl].forEach(el => el.addEventListener("blur", persistData));

      detail.appendChild(h("div", { class: "detail-num-heading" }, field("항 번호", numEl), field("소제목", headingEl)));
      detail.appendChild(field("연구 질문", qEl));
      detail.appendChild(field("항 본문 (참고용)", bodyEl));
    }

    if (owner && illus) {
      const headingEl = liveInput(h("input", { class: "input", type: "text", value: sel.heading, placeholder: "예: 삽화 설명" }), v => sel.heading = v);
      const qEl = liveInput(h("textarea", { class: "input question-textarea", rows: 2, value: sel.question, placeholder: "삽화가 보여주는 것은 무엇입니까?" }), v => sel.question = v);
      qEl.value = sel.question;
      const bodyEl = liveInput(h("textarea", { class: "input body-textarea", rows: 4, value: sel.body, placeholder: "삽화에 대한 참고 설명 (선택)" }), v => sel.body = v);
      bodyEl.value = sel.body;
      [headingEl, qEl, bodyEl].forEach(el => el.addEventListener("blur", persistData));

      const imageInput = h("input", { type: "file", accept: "image/*" });
      imageInput.addEventListener("change", e => {
        const file = e.target.files[0];
        if (!file) return;
        resizeImageFile(file, 1000, 0.82, dataUrl => {
          sel.image = dataUrl;
          persistData();
          render();
        });
      });
      const imageField = h("div", { class: "field" },
        h("label", null, "이미지"),
        sel.image ? h("img", { src: sel.image, style: "max-width:100%;border-radius:10px;display:block;margin-bottom:8px;" }) : null,
        imageInput,
        sel.image ? h("button", { class: "btn-danger", style: "border-radius:8px;padding:0 14px;height:36px;font-size:13px;background:#fff;margin-top:8px;align-self:flex-start;", onclick: () => { sel.image = null; persistData(); render(); } }, "이미지 제거") : null
      );

      detail.appendChild(field("소제목 (선택)", headingEl));
      detail.appendChild(imageField);
      detail.appendChild(field("캡션 / 설명 제목", qEl));
      detail.appendChild(field("참고 설명 (선택)", bodyEl));
    }

    if (owner) {
      const readerSelect = h("select", { class: "input" },
        h("option", { value: "" }, "미배정"),
        ...state.data.readers.map(r => h("option", { value: r.id, selected: r.id === sel.readerId }, readerLabel(r)))
      );
      readerSelect.value = sel.readerId;
      readerSelect.addEventListener("change", e => { sel.readerId = e.target.value; persistData(); render(); });

      const sideSelect = h("select", { class: "input" },
        h("option", { value: "right", selected: sel.side !== "left" }, "연단 오른편"),
        h("option", { value: "left", selected: sel.side === "left" }, "연단 왼편")
      );
      sideSelect.value = sel.side;
      sideSelect.addEventListener("change", e => { sel.side = e.target.value; persistData(); render(); });

      detail.appendChild(h("div", { class: "grid-auto-160" }, field("담당 등단자", readerSelect), field("등단 위치", sideSelect)));
    }

    if (editorOnly) {
      const r = findReader(sel.readerId);
      detail.appendChild(h("div", { class: "readonly-box" },
        illus && sel.image ? h("img", { src: sel.image, style: "max-width:100%;border-radius:10px;display:block;" }) : null,
        h("div", { class: "q" }, sel.question),
        h("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;" },
          h("span", { style: "font-size:13px;color:var(--ink-3);" }, r ? r.name : "등단자 미배정"),
          h("span", { class: sideChipClass(sel.side) }, sideLabel(sel.side))
        ),
        h("div", { class: "body" }, sel.body)
      ));
    }

    const answerEl = liveInput(h("textarea", { class: "input answer-textarea", rows: 6, value: sel.answer }), v => {
      sel.answer = v;
      scheduleFieldSave(sel, "updatedAt", "main");
    });
    answerEl.value = sel.answer;
    answerEl.addEventListener("blur", persistData);
    const savedLabel = h("span", { class: "saved-label" }, ago(sel.updatedAt));
    registerSavedLabel(sel, "updatedAt", savedLabel);

    detail.appendChild(h("div", { class: "field" },
      h("label", null, "해설 (답변)"),
      answerEl,
      h("div", { class: "save-row" },
        savedLabel,
        h("button", { class: "btn btn-primary", style: "height:44px;", onclick: () => { sel.updatedAt = Date.now(); persistData(); render(); } }, "저장")
      )
    ));

    if (!illus) {
      detail.appendChild(renderExtraQuestionBlock(sel, owner || editorOnly));
    }

    } // end !comment branch
  } else {
    detail.appendChild(h("div", { style: "color:var(--ink-4);font-size:14px;padding:28px 0;text-align:center;" }, "왼쪽에서 항을 선택하면 여기에서 편집합니다."));
  }

  let introCard = null;
  if (owner) {
    const P = state.data.program;
    const introEl = liveInput(h("textarea", { class: "input", rows: 3, value: P.intro, placeholder: "예: 오늘 살펴볼 기사를 소개하는 인사말이나 서론을 적어 두세요." }), v => P.intro = v);
    introEl.value = P.intro;
    introEl.addEventListener("blur", persistData);
    introCard = h("div", { class: "card", style: "display:flex;flex-direction:column;gap:8px;" },
      h("div", { style: "font-size:13px;font-weight:700;" }, "서론 (1항 앞에 진행 화면에서 표시됩니다)"),
      introEl
    );
  } else if (state.data.program.intro) {
    introCard = h("div", { class: "card", style: "display:flex;flex-direction:column;gap:8px;" },
      h("div", { style: "font-size:13px;font-weight:700;color:var(--ink-3);" }, "서론"),
      h("div", { style: "white-space:pre-wrap;" }, state.data.program.intro)
    );
  }

  return h("div", { style: "display:flex;flex-direction:column;gap:22px;" },
    ...top,
    h("div", { class: "edit-grid" },
      h("div", { class: "para-list" }, introCard, ...cards),
      detail
    )
  );
}

// Shared "부가 질문" (bonus/extra question) block for a paragraph — used in
// the owner/editor detail panel, the reader's answer screen, and the stage.
// `editable` controls whether the question text itself and the "추가/삭제"
// controls show (owner/editor); the answer textarea is always editable by
// whoever can already edit the main answer on that screen.
function renderExtraQuestionBlock(item, editableStructure) {
  const wrap = h("div", { style: "display:flex;flex-direction:column;gap:10px;padding-top:14px;margin-top:2px;border-top:1px solid var(--divider);" });

  if (!item.extraQuestion && !editableStructure) return h("div");

  if (!item.extraQuestion) {
    wrap.appendChild(h("button", { class: "btn btn-secondary", style: "align-self:flex-start;", onclick: () => {
      item.extraQuestion = "새 부가 질문";
      persistData();
      render();
    } }, "＋ 부가 질문 추가"));
    return wrap;
  }

  if (editableStructure) {
    const qEl = liveInput(h("textarea", { class: "input question-textarea", rows: 2, value: item.extraQuestion }), v => item.extraQuestion = v);
    qEl.value = item.extraQuestion;
    qEl.addEventListener("blur", persistData);
    wrap.appendChild(h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;" },
      h("label", { style: "font-size:12px;font-weight:600;color:var(--ink-3);" }, "부가 질문"),
      h("button", { class: "btn-danger", style: "border-radius:8px;padding:0 12px;height:32px;font-size:12px;background:#fff;", onclick: () => {
        item.extraQuestion = ""; item.extraAnswer = ""; item.extraUpdatedAt = null;
        persistData(); render();
      } }, "부가 질문 삭제")
    ));
    wrap.appendChild(qEl);
  } else {
    wrap.appendChild(h("div", { style: "font-size:12px;font-weight:600;color:var(--ink-3);" }, "부가 질문"));
    wrap.appendChild(h("div", { style: "font-family:var(--serif);font-weight:700;font-size:16px;line-height:1.5;" }, item.extraQuestion));
  }

  const extraAnswerEl = liveInput(h("textarea", { class: "input answer-textarea", rows: 4, value: item.extraAnswer, placeholder: "부가 질문에 대한 해설" }), v => {
    item.extraAnswer = v;
    scheduleFieldSave(item, "extraUpdatedAt", "extra");
  });
  extraAnswerEl.value = item.extraAnswer;
  extraAnswerEl.addEventListener("blur", persistData);
  const savedLabel = h("span", { class: "saved-label" }, ago(item.extraUpdatedAt));
  registerSavedLabel(item, "extraUpdatedAt", savedLabel);

  wrap.appendChild(h("div", { class: "field" },
    h("label", null, "부가 질문 해설"),
    extraAnswerEl,
    h("div", { class: "save-row" },
      savedLabel,
      h("button", { class: "btn btn-primary", style: "height:44px;", onclick: () => { item.extraUpdatedAt = Date.now(); persistData(); render(); } }, "저장")
    )
  ));

  return wrap;
}

// ---------- readers ----------

function genderLabel(g) { return g === "sister" ? "자매" : "형제"; }
function readerLabel(r) {
  if (!r) return "";
  const base = r.name + " " + genderLabel(r.gender);
  return r.congregation ? base + "(" + r.congregation + ")" : base;
}
function genderFromText(t) {
  const s = String(t || "").trim();
  return /^(자매|sister|여|f)$/i.test(s) ? "sister" : "brother";
}

function addReader() {
  const n = state.newReaderName.trim();
  const p = state.newReaderPhone.trim();
  if (!n || p.replace(/[^0-9]/g, "").length < 4) return;
  state.data.readers.push({
    id: "r" + (Date.now() % 100000),
    name: n,
    gender: state.newReaderGender || "brother",
    congregation: state.newReaderCongregation.trim(),
    phone: p,
    note: state.newReaderNote.trim()
  });
  state.newReaderName = ""; state.newReaderPhone = ""; state.newReaderCongregation = ""; state.newReaderNote = ""; state.newReaderGender = "brother";
  persistData();
  render();
}

function removeReader(id) {
  if (!confirm("이 등단자를 삭제할까요? 배정된 항이 있으면 미배정으로 바뀝니다.")) return;
  state.data.readers = state.data.readers.filter(r => r.id !== id);
  state.data.program.items.forEach(it => { if (it.readerId === id) it.readerId = ""; });
  persistData();
  Store.deleteReader(id).catch(err => console.error("삭제 실패:", err));
  render();
}

// Shared by both the plain-text (.csv/.txt) and Excel (.xlsx/.xls) upload
// paths — each just needs to produce rows of raw cell strings in the order
// 이름/성별/회중/전화번호/메모 before handing off here.
function upsertReadersFromRows(rows) {
  let added = 0, updated = 0;
  rows.forEach(cols => {
    const name = String(cols[0] || "").trim();
    if (!name || /^(이름|name)$/i.test(name)) return;
    const genderRaw = String(cols[1] || "").trim();
    const congregation = String(cols[2] || "").trim();
    const phone = String(cols[3] || "").trim();
    const note = String(cols[4] || "").trim();
    const existing = state.data.readers.find(r => r.name === name);
    if (existing) {
      // blank cells keep the existing value instead of wiping it — lets a
      // partial re-upload (e.g. just updated phone numbers) not erase data.
      if (genderRaw) existing.gender = genderFromText(genderRaw);
      if (congregation) existing.congregation = congregation;
      if (phone) existing.phone = phone;
      if (note) existing.note = note;
      updated++;
    } else {
      state.data.readers.push({ id: "r" + Date.now() + Math.floor(Math.random() * 1000), name, gender: genderFromText(genderRaw), congregation, phone, note });
      added++;
    }
  });
  persistData();
  state.readerUploadMsg = rows.length ? ("추가 " + added + "명 · 갱신 " + updated + "명") : "파일에서 읽을 수 있는 줄이 없습니다.";
  render();
}

function parseDelimitedText(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => line.split(/[,\t]/).map(s => s.trim()));
}

function parseExcelFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  return rows.map(r => r.map(c => (c === null || c === undefined) ? "" : String(c).trim()));
}

// Personalized notice text per reader, built from the owner-editable
// template (see 내 프로필) with {issue}/{title}/{items}/{name}/{gender}/
// {congregation} tokens filled in from the current program + reader data.
function fillTemplate(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

function readerAssignedItemLabel(item) {
  if (isIllustration(item)) return (item.heading ? item.heading + " " : "") + "삽화";
  return (item.num || "—") + "항 질문";
}

function readerAssignedItemsLabel(readerId) {
  const labels = state.data.program.items
    .filter(it => it.readerId === readerId && isAssignable(it))
    .map(readerAssignedItemLabel);
  return labels.join(", ");
}

function buildReaderNotice(reader) {
  return fillTemplate(state.data.messageTemplate, {
    issue: state.data.program.issue,
    title: state.data.program.title,
    items: readerAssignedItemsLabel(reader.id) || "(배정된 항 없음)",
    name: reader.name,
    gender: genderLabel(reader.gender),
    congregation: reader.congregation || ""
  });
}

function copyReaderNotice(reader) {
  const text = buildReaderNotice(reader);
  navigator.clipboard.writeText(text).then(() => {
    state.noticeMsg = reader.name + "님 안내문이 클립보드에 복사되었습니다.";
    render();
  }, () => {
    state.noticeMsg = "복사에 실패했습니다. 아래 미리보기에서 직접 선택해 복사해 주세요.";
    render();
  });
}

function copyReaderPhone(reader) {
  navigator.clipboard.writeText(reader.phone || "").then(() => {
    state.noticeMsg = reader.name + "님 전화번호가 복사되었습니다.";
    render();
  }, () => {
    state.noticeMsg = "복사에 실패했습니다.";
    render();
  });
}

function renderReaders() {
  const list = state.data.program.items;
  const paragraphs = list.filter(it => it.type === "paragraph");
  const unassigned = paragraphs.filter(p => !p.readerId);

  const rows = state.data.readers.map(r => {
    const ps = list.filter(p => p.readerId === r.id);
    const sides = [];
    if (ps.some(p => p.side !== "left")) sides.push("right");
    if (ps.some(p => p.side === "left")) sides.push("left");
    const row = h("div", { class: "reader-row grid-auto-200" },
      h("div", { class: "reader-col" },
        h("span", { class: "reader-name" }, readerLabel(r)),
        h("span", { class: "reader-sub" }, "비밀번호 · 뒤 4자리 " + r.phone.slice(-4))
      ),
      h("div", { class: "reader-col" },
        h("a", { class: "reader-phone-link", href: smsHref(r.phone) }, r.phone || "—"),
        h("span", { class: "reader-sub" }, "탭하면 문자")
      ),
      h("div", { class: "reader-col" },
        h("span", { style: "font-size:12px;color:var(--ink-4);" }, "메모"),
        h("span", null, r.note || "—")
      ),
      h("div", { class: "reader-col" },
        h("span", { style: "font-size:12px;color:var(--ink-4);" }, "등단 항"),
        h("div", { class: "chip-wrap" }, ...(ps.length
          ? ps.map(p => h("span", { class: "chip chip-assign" }, itemChipLabel(p)))
          : [h("span", { class: "chip chip-neutral" }, "배정 없음")]))
      ),
      h("div", { class: "reader-col" },
        h("span", { style: "font-size:12px;color:var(--ink-4);" }, "등단 위치"),
        h("div", { class: "chip-wrap" }, ...(sides.length
          ? sides.map(s => h("span", { class: sideChipClass(s) }, sideLabel(s)))
          : [h("span", { class: "chip chip-neutral" }, "—")]))
      ),
      h("div", { class: "reader-col", style: "justify-content:center;gap:6px;" },
        h("button", { class: "btn btn-secondary", style: "height:36px;padding:0 12px;font-size:13px;align-self:flex-start;", onclick: () => { state.noticePreviewId = state.noticePreviewId === r.id ? null : r.id; state.noticeMsg = ""; render(); } }, state.noticePreviewId === r.id ? "안내문 닫기" : "안내문"),
        h("button", { class: "btn-danger", style: "border-radius:8px;padding:0 14px;height:36px;font-size:13px;background:#fff;align-self:flex-start;", onclick: () => removeReader(r.id) }, "삭제")
      )
    );

    if (state.noticePreviewId !== r.id) return row;

    const noticeText = buildReaderNotice(r);
    const preview = h("div", { class: "card", style: "display:flex;flex-direction:column;gap:10px;border-style:dashed;" },
      h("div", { style: "font-size:12px;color:var(--ink-4);" }, r.name + "님에게 보낼 안내문 (배정: " + (readerAssignedItemsLabel(r.id) || "없음") + ")"),
      h("textarea", { class: "input", rows: 10, readonly: true, style: "font-size:13px;line-height:1.6;white-space:pre-wrap;", value: noticeText }),
      h("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center;" },
        h("button", { class: "btn btn-primary", onclick: () => copyReaderNotice(r) }, "안내문 복사"),
        h("button", { class: "btn btn-secondary", onclick: () => copyReaderPhone(r) }, "전화번호 복사")
      )
    );
    return h("div", { style: "display:flex;flex-direction:column;gap:10px;" }, row, preview);
  });

  const nameEl = liveInput(h("input", { class: "input", type: "text", placeholder: "이름", value: state.newReaderName }), v => state.newReaderName = v);
  const genderSelect = h("select", { class: "input" },
    h("option", { value: "brother", selected: state.newReaderGender !== "sister" }, "형제"),
    h("option", { value: "sister", selected: state.newReaderGender === "sister" }, "자매")
  );
  genderSelect.value = state.newReaderGender || "brother";
  genderSelect.addEventListener("change", e => { state.newReaderGender = e.target.value; });
  const congEl = liveInput(h("input", { class: "input", type: "text", placeholder: "회중", value: state.newReaderCongregation }), v => state.newReaderCongregation = v);
  const phoneEl = liveInput(h("input", { class: "input", type: "tel", placeholder: "010-0000-0000", value: state.newReaderPhone }), v => state.newReaderPhone = v);
  const noteEl = liveInput(h("input", { class: "input", type: "text", placeholder: "메모 (선택)", value: state.newReaderNote }), v => state.newReaderNote = v);

  const fileInput = h("input", { type: "file", accept: ".csv,.txt,.xlsx,.xls" });
  fileInput.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const isExcel = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const rows = isExcel ? parseExcelFile(ev.target.result) : parseDelimitedText(ev.target.result);
        upsertReadersFromRows(rows);
      } catch (err) {
        state.readerUploadMsg = "파일을 읽는 중 오류가 발생했습니다: " + err.message;
        render();
      }
    };
    if (isExcel) reader.readAsArrayBuffer(file); else reader.readAsText(file, "utf-8");
    fileInput.value = "";
  });

  return h("div", { style: "display:flex;flex-direction:column;gap:20px;" },
    h("div", { style: "display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;" },
      h("h1", { class: "page-title" }, "등단자 관리"),
      h("span", { style: "font-size:13px;color:var(--ink-3);" }, "등단자 " + state.data.readers.length + "명 · 미배정 항 " + unassigned.length + "개")
    ),
    state.noticeMsg ? h("div", { style: "font-size:13px;color:var(--success-ink);" }, state.noticeMsg) : null,
    h("div", { style: "display:flex;flex-direction:column;gap:10px;" }, ...rows),
    h("div", { class: "card-dashed grid-auto-180" },
      field("이름", nameEl),
      field("성별", genderSelect),
      field("회중", congEl),
      field("전화번호", phoneEl),
      field("메모", noteEl),
      h("button", { class: "btn btn-primary", onclick: addReader }, "등단자 추가")
    ),
    h("div", { class: "card", style: "display:flex;flex-direction:column;gap:8px;" },
      h("div", { style: "font-size:13px;font-weight:700;" }, "명단 파일로 한 번에 추가"),
      h("div", { style: "font-size:12px;color:var(--ink-4);" }, "열 순서가 이름 · 성별(형제/자매) · 회중 · 전화번호 · 메모 인 .xlsx 엑셀 파일, 또는 같은 순서로 쉼표(,)나 탭으로 구분된 .csv/.txt 파일. 이미 있는 이름이면 나머지 정보가 갱신됩니다. 엑셀에서 전화번호 열은 텍스트 서식으로 입력해야 010으로 시작하는 번호가 그대로 유지됩니다."),
      fileInput,
      state.readerUploadMsg ? h("div", { style: "font-size:13px;color:var(--success-ink);" }, state.readerUploadMsg) : null
    ),
    h("div", { class: "card", style: "display:flex;flex-direction:column;gap:10px;" },
      h("div", { style: "font-size:13px;font-weight:700;color:var(--warn-ink);" }, "미배정 항"),
      h("div", { class: "chip-wrap" }, ...(unassigned.length
        ? unassigned.map(p => h("span", { class: "chip chip-unassigned" }, itemChipLabel(p)))
        : [h("span", { class: "chip chip-unassigned" }, "없음")])),
      h("div", { style: "font-size:13px;color:var(--ink-4);" }, unassigned.length ? "항 편집 화면에서 담당 등단자와 등단 위치를 지정하세요." : "모든 항에 등단자가 배정되었습니다.")
    )
  );
}

// ---------- profile ----------

function changePw() {
  if (!state.pw1 || state.pw1 !== state.pw2) { state.pwMsg = "두 비밀번호가 일치하지 않습니다."; state.pwOk = false; render(); return; }
  if (!state.session || state.session.kind !== "admin") { state.pwMsg = "등단자 비밀번호는 전화번호 뒤 4자리로 고정입니다."; state.pwOk = false; render(); return; }
  const admin = state.data.admins.find(a => a.id === state.session.id);
  if (admin) admin.pw = state.pw1;
  persistData();
  state.pw1 = ""; state.pw2 = "";
  state.pwMsg = "비밀번호가 변경되었습니다."; state.pwOk = true;
  render();
}

function addAdmin() {
  const n = state.newAdminName.trim();
  const p = state.newAdminPw.trim();
  if (!n || !p) return;
  state.data.admins.push({ id: "a" + (Date.now() % 100000), name: n, pw: p, role: "editor" });
  state.newAdminName = ""; state.newAdminPw = "";
  persistData();
  render();
}

function removeAdmin(id) {
  state.data.admins = state.data.admins.filter(a => a.id !== id);
  persistData();
  Store.deleteAdmin(id).catch(err => console.error("삭제 실패:", err));
  render();
}

function renderProfile() {
  const pw1El = liveInput(h("input", { class: "input", type: "password", placeholder: "새 비밀번호", value: state.pw1 }), v => { state.pw1 = v; state.pwMsg = ""; });
  const pw2El = liveInput(h("input", { class: "input", type: "password", placeholder: "다시 입력", value: state.pw2 }), v => { state.pw2 = v; state.pwMsg = ""; });

  const children = [
    h("h1", { class: "page-title" }, "내 프로필"),
    h("div", { class: "card", style: "display:flex;flex-direction:column;gap:16px;" },
      h("div", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap;" },
        h("span", { style: "font-size:19px;font-weight:600;" }, state.session.name),
        h("span", { class: roleChipClass() }, roleChipLabel())
      ),
      h("div", { class: "grid-auto-180" }, field("새 비밀번호", pw1El), field("새 비밀번호 확인", pw2El)),
      h("div", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap;" },
        h("button", { class: "btn btn-primary", style: "height:46px;", onclick: changePw }, "비밀번호 변경"),
        h("span", { style: "font-size:13px;color:" + (state.pwOk ? "var(--success-ink)" : "var(--error-ink)") }, state.pwMsg)
      )
    )
  ];

  if (isOwner()) {
    const nameEl = liveInput(h("input", { class: "input", type: "text", placeholder: "이름", value: state.newAdminName }), v => state.newAdminName = v);
    const pwEl = liveInput(h("input", { class: "input", type: "text", placeholder: "예: 1234", value: state.newAdminPw }), v => state.newAdminPw = v);

    children.push(h("div", { style: "display:flex;flex-direction:column;gap:14px;" },
      h("div", { style: "display:flex;flex-direction:column;gap:4px;" },
        h("h2", { class: "section-title" }, "관리자 추가"),
        h("p", { class: "section-desc" }, "추가된 관리자는 해설 내용만 수정할 수 있습니다. 항 구조 · 등단자 배정 · 가져오기는 소유자만 가능합니다.")
      ),
      h("div", { style: "display:flex;flex-direction:column;gap:10px;" }, ...state.data.admins.map(a => h("div", { class: "admin-row" },
        h("span", { class: "admin-name" }, a.name),
        h("span", { class: "chip " + (a.role === "owner" ? "chip-owner" : "chip-editor") }, a.role === "owner" ? "소유자 · 전체 권한" : "해설 편집만"),
        h("span", { class: "admin-pw-note" }, a.role === "owner" ? "비밀번호는 본인만 변경" : "초기 비밀번호 " + a.pw),
        h("div", { style: "flex:1;" }),
        a.role !== "owner" ? h("button", { class: "btn-danger", style: "border-radius:8px;padding:0 14px;height:40px;font-size:13px;background:#fff;", onclick: () => removeAdmin(a.id) }, "삭제") : null
      ))),
      h("div", { class: "card-dashed grid-auto-180" },
        field("이름", nameEl),
        field("초기 비밀번호", pwEl),
        h("button", { class: "btn btn-primary", onclick: addAdmin }, "관리자 추가")
      )
    ));

    const templateEl = liveInput(h("textarea", { class: "input", rows: 14, style: "font-size:13px;line-height:1.6;", value: state.data.messageTemplate }), v => state.data.messageTemplate = v);
    templateEl.value = state.data.messageTemplate;
    templateEl.addEventListener("blur", persistData);
    children.push(h("div", { style: "display:flex;flex-direction:column;gap:10px;" },
      h("div", { style: "display:flex;flex-direction:column;gap:4px;" },
        h("h2", { class: "section-title" }, "등단자 안내문 템플릿"),
        h("p", { class: "section-desc" }, "등단자 관리 화면에서 \"안내문\" 버튼을 누르면 이 틀에 맞춰 사람마다 문구가 자동으로 채워집니다. 사용 가능한 자리표시자: {issue} 호수, {title} 기사 제목, {items} 배정된 항(예: \"3항, 7항\"), {name} 이름, {gender} 형제/자매, {congregation} 회중. 날짜·장소 같은 나머지 내용은 자유롭게 고쳐 쓰세요.")
      ),
      templateEl
    ));
  }

  return h("div", { class: "screen-narrow" }, ...children);
}

// ---------- reader: my list + answer ----------

function myParagraphs() {
  if (!isReader()) return [];
  return state.data.program.items.filter(p => p.readerId === state.session.id);
}

function renderMy() {
  const mine = myParagraphs();
  const P = state.data.program;

  const cards = mine.map(p => {
    const badge = badgeFor(p);
    const savedLabel = h("div", { style: "font-size:13px;color:var(--ink-4);" }, ago(p.updatedAt));
    registerSavedLabel(p, "updatedAt", savedLabel);
    return h("button", {
      class: "my-card",
      onclick: () => { state.selectedId = p.id; state.screen = "answer"; state.bodyOpen = false; render(); }
    },
      h("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;" },
        h("span", { class: "chip-num", style: "padding:4px 11px;font-size:14px;" }, itemChipLabel(p)),
        h("span", { class: sideChipClass(p.side) }, sideLabel(p.side)),
        h("span", { style: "font-size:13px;color:var(--ink-4);flex:1;min-width:0;" }, p.heading || ""),
        h("span", { class: badge.cls }, badge.label)
      ),
      isIllustration(p) && p.image ? h("img", { src: p.image, style: "max-width:100%;max-height:140px;border-radius:8px;display:block;object-fit:cover;" }) : null,
      h("div", { class: "q" }, p.question),
      savedLabel
    );
  });

  return h("div", { class: "screen-narrow-2" },
    h("div", { style: "display:flex;flex-direction:column;gap:6px;" },
      h("div", { style: "font-size:12px;color:var(--ink-4);" }, P.issue),
      h("h1", { class: "page-title-lg" }, P.title),
      h("div", { style: "font-size:14px;color:var(--ink-3);" }, mine.length ? "배정된 항 " + mine.length + "개 · 해설을 작성해 주세요." : "")
    ),
    mine.length
      ? h("div", { style: "display:flex;flex-direction:column;gap:12px;" }, ...cards)
      : h("div", { class: "empty-state" }, "아직 배정된 항이 없습니다. 사회자에게 문의해 주세요.")
  );
}

function renderAnswer() {
  const sel = findItem(state.selectedId);
  if (!sel) { state.screen = "my"; return renderMy(); }
  const illus = isIllustration(sel);

  const bodyBlock = sel.body ? h("div", { class: "body-collapse" },
    h("button", { class: "body-collapse-toggle", onclick: () => { state.bodyOpen = !state.bodyOpen; render(); } }, (state.bodyOpen ? "▾ " : "▸ ") + (illus ? "참고 설명" : "항 본문 (참고용)")),
    state.bodyOpen ? h("div", { class: "body-collapse-text" }, sel.body) : null
  ) : null;

  const answerEl = liveInput(h("textarea", { class: "input answer-textarea", rows: 10, placeholder: "맡은 항의 해설을 자유롭게 작성하세요.", value: sel.answer }), v => {
    sel.answer = v;
    scheduleFieldSave(sel, "updatedAt", "main");
  });
  answerEl.value = sel.answer;
  answerEl.addEventListener("blur", persistData);

  const savedLabel = h("span", { style: "font-size:13px;color:var(--ink-3);" }, ago(sel.updatedAt));
  registerSavedLabel(sel, "updatedAt", savedLabel);

  return h("div", { class: "screen-narrow-2" },
    h("button", { class: "back-link", onclick: () => { state.screen = "my"; render(); } }, "← 내 항 목록"),
    h("div", { style: "display:flex;flex-direction:column;gap:12px;" },
      h("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;" },
        h("span", { class: "chip-num", style: "padding:4px 11px;font-size:14px;" }, itemChipLabel(sel)),
        h("span", { class: sideChipClass(sel.side) }, sideLabel(sel.side)),
        h("span", { style: "font-size:13px;color:var(--ink-4);" }, sel.heading || "")
      ),
      illus && sel.image ? h("img", { src: sel.image, style: "max-width:100%;border-radius:12px;display:block;" }) : null,
      h("div", { style: "font-family:var(--serif);font-size:26px;font-weight:800;line-height:1.45;" }, sel.question)
    ),
    bodyBlock,
    h("div", { style: "display:flex;flex-direction:column;gap:10px;" },
      h("label", { style: "font-size:13px;font-weight:700;color:var(--ink-2);" }, "해설 (답변)"),
      answerEl,
      h("div", { class: "save-row" },
        savedLabel,
        h("div", { style: "display:flex;gap:10px;" },
          h("button", { class: "btn btn-primary", onclick: () => { sel.updatedAt = Date.now(); persistData(); render(); } }, "저장"),
          h("button", { class: "btn btn-secondary", onclick: () => {
            const mine = myParagraphs();
            const i = mine.findIndex(p => p.id === sel.id);
            const nxt = mine[(i + 1) % Math.max(mine.length, 1)];
            if (nxt) { state.selectedId = nxt.id; state.bodyOpen = false; render(); }
          } }, "다음 내 항")
        )
      )
    ),
    !illus && sel.extraQuestion ? renderExtraQuestionBlock(sel, false) : null
  );
}

// ---------- stage: one continuous, read-only, article-styled page ----------
//
// No per-item navigation, no inputs — just the whole program laid out top to
// bottom like the source article, so the host can scroll through it live.

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) { /* unsupported, insecure context, or denied — reading still works fine */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.screen === "stage") requestWakeLock();
});

function exitStage() {
  releaseWakeLock();
  state.screen = "edit";
  render();
}

function renderStage() {
  requestWakeLock();
  const P = state.data.program;
  const items = P.items;
  const blocks = [];
  let lastHeading = null;

  items.forEach(item => {
    if (isDivider(item)) {
      blocks.push(h("hr", { class: "stage-divider" }));
      return;
    }

    if (isComment(item)) {
      blocks.push(h("div", { class: "chip-num stage-tag" }, item.heading ? "코멘트 · " + item.heading : "코멘트"));
      blocks.push(h("div", { class: "stage-comment-text" }, item.question || ""));
      return;
    }

    if (item.heading && item.heading !== lastHeading) {
      blocks.push(h("div", { class: "stage-section-heading" }, item.heading));
      lastHeading = item.heading;
    }

    const illus = isIllustration(item);
    if (illus) {
      if (item.image) blocks.push(h("img", { class: "stage-illustration-img", src: item.image }));
      if (item.body) blocks.push(h("div", { class: "stage-para-text" }, item.body));
      if (item.question) {
        blocks.push(h("div", { class: "chip-num stage-tag" }, "삽화 설명"));
        blocks.push(h("div", { class: "stage-illustration-caption" }, item.question));
      }
    } else {
      if (item.body) {
        blocks.push(h("div", { class: "stage-para-text" },
          h("span", { class: "stage-para-num" }, item.num),
          " " + item.body
        ));
      }
      if (item.question) {
        blocks.push(h("div", { class: "chip-num stage-tag" }, (item.num || "—") + "항 질문"));
        blocks.push(h("div", { class: "stage-para-question" }, item.question));
      }
    }

    const reader = findReader(item.readerId);
    const readerBadge = reader
      ? h("span", { class: "chip chip-assign" }, h("strong", null, reader.name), " " + genderLabel(reader.gender) + (reader.congregation ? "(" + reader.congregation + ")" : ""))
      : h("span", { class: "chip chip-neutral" }, "등단자 미배정");
    blocks.push(h("div", { class: "stage-assign-line" },
      h("span", { class: sideChipClass(item.side) }, sideLabel(item.side)),
      readerBadge
    ));
    blocks.push(h("div", { class: "stage-answer-text" }, item.answer || "아직 작성된 해설이 없습니다."));

    if (!illus && item.extraQuestion) {
      blocks.push(h("div", { class: "chip-num stage-tag" }, (item.num || "—") + "항 부가 질문"));
      blocks.push(h("div", { class: "stage-para-question" }, item.extraQuestion));
      blocks.push(h("div", { class: "stage-answer-text" }, item.extraAnswer || "아직 작성된 해설이 없습니다."));
    }
  });

  return h("div", { class: "stage-wrap" },
    h("div", { class: "stage-topbar" },
      h("span", { class: "brand" }, "진행 화면"),
      h("button", { class: "stage-exit-btn", onclick: exitStage }, "나가기")
    ),
    h("div", { class: "stage-article" },
      h("div", { class: "stage-article-header" },
        h("div", { class: "stage-issue" }, P.issue),
        h("div", { class: "stage-title" }, P.title),
        P.subtitle ? h("div", { class: "stage-subtitle" }, P.subtitle) : null
      ),
      P.intro && P.intro.trim() ? h("div", { class: "stage-intro" }, P.intro) : null,
      ...blocks
    )
  );
}

// ---------- boot ----------

function renderBootScreen(message, isError) {
  root.innerHTML = "";
  root.appendChild(h("div", { style: "min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:20px;text-align:center;" },
    h("div", { class: "login-title" }, "파수대 연구 진행 도구"),
    h("div", { style: "color:var(--ink-3);font-size:14px;" }, message),
    isError ? h("button", { class: "btn btn-primary", onclick: boot }, "다시 시도") : null
  ));
}

async function boot() {
  renderBootScreen("불러오는 중…", false);
  const ok = await refreshData();
  if (!ok) {
    renderBootScreen("서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.", true);
    return;
  }
  if (state.session) state.screen = homeFor(state.session);
  render();
}

boot();
