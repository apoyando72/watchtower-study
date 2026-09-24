/*
 * Netlify Function version of server.py's /api/import endpoint. Same regex
 * parsing logic, ported from Python — fetches a wol.jw.org article
 * server-side (the browser can't fetch cross-origin) and extracts headings,
 * paragraph numbers, body text, and study questions.
 *
 * Wired up via the /api/import -> /.netlify/functions/import-article
 * redirect in netlify.toml, so the frontend code needs no changes between
 * local dev (server.py) and production (this function).
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

class ParseError extends Error {}

function decodeEntities(str) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => named[n]);
}

function stripTags(fragment) {
  const text = decodeEntities(fragment.replace(/<[^>]+>/g, ""));
  return text.replace(/\s+/g, " ").trim();
}

function parseWatchtowerArticle(htmlText, sourceUrl) {
  const titleM = htmlText.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (!titleM) {
    throw new ParseError("기사 제목을 찾을 수 없습니다. wol.jw.org 파수대 연구 기사 링크가 맞는지 확인해 주세요.");
  }
  const title = stripTags(titleM[1]);

  const subtitleM = htmlText.match(/<p[^>]*class="themeScrp"[^>]*>([\s\S]*?)<\/p>/);
  const subtitle = subtitleM ? stripTags(subtitleM[1]) : "";

  let monthPage = "";
  const navM = htmlText.match(/<li[^>]*class="[^"]*navPublications[^"]*"[^>]*>([\s\S]*?)<\/li>/);
  if (navM) monthPage = stripTags(navM[1]).replace(/^파\d+\s*/, "");

  let year = "";
  const ctxM = htmlText.match(/<p[^>]*class="[^"]*contextTtl[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  if (ctxM) {
    const yearM = stripTags(ctxM[1]).match(/(\d{4})년/);
    if (yearM) year = yearM[1];
  }

  const issue = year && monthPage ? "파수대 " + year + "년 " + monthPage : monthPage || year;

  const sections = [];
  const sectionRe = /<h2 class="du-color--coolGray-700 du-textAlign--center" id="p(\d+)" data-pid="\d+"><strong>([\s\S]*?)<\/strong><\/h2>/g;
  let sm;
  while ((sm = sectionRe.exec(htmlText)) !== null) {
    sections.push([parseInt(sm[1], 10), stripTags(sm[2])]);
  }
  sections.sort((a, b) => a[0] - b[0]);

  const questions = [];
  const quRe = /<p id="p(\d+)" data-pid="\d+" class="qu">([\s\S]*?)<\/p>/g;
  let qm;
  while ((qm = quRe.exec(htmlText)) !== null) {
    const pid = parseInt(qm[1], 10);
    const text = stripTags(qm[2]);
    const numM = text.match(/^([\d,\-\s]+)\.\s*([\s\S]*)$/);
    const num = numM ? numM[1].trim() : "";
    const question = numM ? numM[2].trim() : text;
    questions.push({ pid, num, question });
  }
  questions.sort((a, b) => a.pid - b.pid);

  if (questions.length === 0) {
    throw new ParseError(
      "연구 질문을 찾지 못했습니다. 이 기사는 자동 추출 형식과 다를 수 있습니다. '수동으로 항 입력'으로 진행해 주세요."
    );
  }

  const bodyByQuestionPid = {};
  const bodyRe = /<p id="p\d+" data-pid="(\d+)" data-rel-pid="\[([\d,]*)\]"[^>]*>([\s\S]*?)<\/p>/g;
  let bm;
  while ((bm = bodyRe.exec(htmlText)) !== null) {
    const pid = parseInt(bm[1], 10);
    const related = bm[2].split(",").filter(x => x.trim()).map(x => parseInt(x, 10));
    const bodyHtml = bm[3].replace(/<span class="parNum"[\s\S]*?<\/span>/g, "");
    const bodyText = stripTags(bodyHtml);
    related.forEach(qPid => {
      if (!bodyByQuestionPid[qPid]) bodyByQuestionPid[qPid] = [];
      bodyByQuestionPid[qPid].push([pid, bodyText]);
    });
  }

  const paragraphs = questions.map(q => {
    const bodies = (bodyByQuestionPid[q.pid] || []).slice().sort((a, b) => a[0] - b[0]);
    const anchorPid = bodies.length ? bodies[0][0] : q.pid;
    let heading = "";
    for (const [sectionPid, sectionText] of sections) {
      if (sectionPid < anchorPid) heading = sectionText;
      else break;
    }
    const body = bodies.map(b => b[1]).join("\n\n");
    return { num: q.num, heading, question: q.question, body };
  });

  return { title, subtitle, issue, sourceUrl, paragraphs };
}

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj)
  };
}

exports.handler = async event => {
  const url = (event.queryStringParameters || {}).url;
  if (!url) return jsonResponse(400, { ok: false, error: "url 파라미터가 없습니다." });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return jsonResponse(502, { ok: false, error: "페이지를 가져오지 못했습니다 (HTTP " + res.status + ")." });
    }
    const html = await res.text();
    const data = parseWatchtowerArticle(html, url);
    return jsonResponse(200, { ok: true, data });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") return jsonResponse(502, { ok: false, error: "URL 요청이 시간 초과되었습니다." });
    if (err instanceof ParseError) return jsonResponse(200, { ok: false, error: err.message });
    if (err instanceof TypeError) return jsonResponse(502, { ok: false, error: "URL에 접속할 수 없습니다. 주소를 확인해 주세요." });
    return jsonResponse(500, { ok: false, error: "알 수 없는 오류: " + err.message });
  }
};
