#!/usr/bin/env python3
"""
Local dev server for the 파수대 연구 진행 도구 prototype.

Serves the static app AND a real /api/import endpoint that fetches a
wol.jw.org article server-side (browsers can't fetch cross-origin pages
directly) and extracts headings, paragraph numbers, body text, and study
questions via regex against the site's known markup.

This is a stand-in for a real backend. When Supabase (or anything else)
gets wired up, this parsing logic can move there unchanged — only the
transport changes.
"""
import json
import os
import re
import sys
import html as html_lib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.abspath(__file__))
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def strip_tags(fragment):
    text = re.sub(r"<[^>]+>", "", fragment)
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_watchtower_article(html_text, source_url):
    title_m = re.search(r"<h1[^>]*>(.*?)</h1>", html_text, re.S)
    if not title_m:
        raise ValueError(
            "기사 제목을 찾을 수 없습니다. wol.jw.org 파수대 연구 기사 링크가 맞는지 확인해 주세요."
        )
    title = strip_tags(title_m.group(1))

    subtitle_m = re.search(r'<p[^>]*class="themeScrp"[^>]*>(.*?)</p>', html_text, re.S)
    subtitle = strip_tags(subtitle_m.group(1)) if subtitle_m else ""

    month_page = ""
    nav_m = re.search(r'<li[^>]*class="[^"]*navPublications[^"]*"[^>]*>(.*?)</li>', html_text, re.S)
    if nav_m:
        month_page = re.sub(r"^파\d+\s*", "", strip_tags(nav_m.group(1)))

    year = ""
    ctx_m = re.search(r'<p[^>]*class="[^"]*contextTtl[^"]*"[^>]*>(.*?)</p>', html_text, re.S)
    if ctx_m:
        year_m = re.search(r"(\d{4})년", strip_tags(ctx_m.group(1)))
        if year_m:
            year = year_m.group(1)

    if year and month_page:
        issue = "파수대 " + year + "년 " + month_page
    else:
        issue = month_page or year

    sections = []
    for sm in re.finditer(
        r'<h2 class="du-color--coolGray-700 du-textAlign--center" id="p(\d+)" data-pid="\d+"><strong>(.*?)</strong></h2>',
        html_text,
        re.S,
    ):
        sections.append((int(sm.group(1)), strip_tags(sm.group(2))))
    sections.sort(key=lambda item: item[0])

    questions = []
    for qm in re.finditer(r'<p id="p(\d+)" data-pid="\d+" class="qu">(.*?)</p>', html_text, re.S):
        pid = int(qm.group(1))
        text = strip_tags(qm.group(2))
        num_m = re.match(r"^([\d,\-\s]+)\.\s*(.*)$", text)
        if num_m:
            num, question_text = num_m.group(1).strip(), num_m.group(2).strip()
        else:
            num, question_text = "", text
        questions.append({"pid": pid, "num": num, "question": question_text})
    questions.sort(key=lambda q: q["pid"])

    if not questions:
        raise ValueError(
            "연구 질문을 찾지 못했습니다. 이 기사는 자동 추출 형식과 다를 수 있습니다. "
            "'수동으로 항 입력'으로 진행해 주세요."
        )

    body_by_question_pid = {}
    for bm in re.finditer(
        r'<p id="p\d+" data-pid="(\d+)" data-rel-pid="\[([\d,]*)\]"[^>]*>(.*?)</p>',
        html_text,
        re.S,
    ):
        pid = int(bm.group(1))
        related = [int(x) for x in bm.group(2).split(",") if x.strip()]
        body_html = re.sub(r'<span class="parNum".*?</span>', "", bm.group(3), flags=re.S)
        body_text = strip_tags(body_html)
        for q_pid in related:
            body_by_question_pid.setdefault(q_pid, []).append((pid, body_text))

    paragraphs = []
    for q in questions:
        bodies = sorted(body_by_question_pid.get(q["pid"], []), key=lambda item: item[0])
        # Questions live in their own numbered block, often far from the body
        # text they refer to, so headings must be matched against the body
        # paragraphs' position in the article (their pid), not the question's.
        anchor_pid = bodies[0][0] if bodies else q["pid"]
        heading = ""
        for section_pid, section_text in sections:
            if section_pid < anchor_pid:
                heading = section_text
            else:
                break
        body = "\n\n".join(text for _, text in bodies)
        paragraphs.append({
            "num": q["num"],
            "heading": heading,
            "question": q["question"],
            "body": body,
        })

    return {
        "title": title,
        "subtitle": subtitle,
        "issue": issue,
        "sourceUrl": source_url,
        "paragraphs": paragraphs,
    }


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/import":
            self._handle_import(parse_qs(parsed.query))
            return
        self._serve_static(parsed.path)

    def _handle_import(self, query):
        url = (query.get("url") or [""])[0]
        if not url:
            self._send_json({"ok": False, "error": "url 파라미터가 없습니다."}, 400)
            return
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=15) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                raw_html = response.read().decode(charset, errors="replace")
            data = parse_watchtower_article(raw_html, url)
            self._send_json({"ok": True, "data": data})
        except HTTPError as e:
            self._send_json({"ok": False, "error": "페이지를 가져오지 못했습니다 (HTTP %s)." % e.code}, 502)
        except URLError:
            self._send_json({"ok": False, "error": "URL에 접속할 수 없습니다. 주소를 확인해 주세요."}, 502)
        except ValueError as e:
            self._send_json({"ok": False, "error": str(e)})
        except Exception as e:
            self._send_json({"ok": False, "error": "알 수 없는 오류: %s" % e}, 500)

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        fpath = os.path.normpath(os.path.join(ROOT, path.lstrip("/")))
        if not fpath.startswith(ROOT) or not os.path.isfile(fpath):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")
            return
        ctype = "text/html; charset=utf-8"
        if fpath.endswith(".css"):
            ctype = "text/css; charset=utf-8"
        elif fpath.endswith(".js"):
            ctype = "application/javascript; charset=utf-8"
        with open(fpath, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8934
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("Serving http://localhost:%d" % port)
    server.serve_forever()


if __name__ == "__main__":
    main()
