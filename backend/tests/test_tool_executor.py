"""Tests for pure functions in tool_executor.py."""
import pytest

from tool_executor import _parse_ddg_lite, _extract_readable_text


# ── _parse_ddg_lite ───────────────────────────────────────────────────────────

DDG_SINGLE = """\
<table>
<tr>
  <td><a class='result-link' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=x'>Example Site</a></td>
</tr>
<tr>
  <td class='result-snippet'>A snippet about the example site.</td>
</tr>
</table>
"""

DDG_MULTI = """\
<table>
<tr><td><a class='result-link' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fone.com'>First Result</a></td></tr>
<tr><td class='result-snippet'>First snippet.</td></tr>
<tr><td><a class='result-link' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Ftwo.com'>Second Result</a></td></tr>
<tr><td class='result-snippet'>Second snippet.</td></tr>
<tr><td><a class='result-link' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fthree.com'>Third Result</a></td></tr>
<tr><td class='result-snippet'>Third snippet.</td></tr>
</table>
"""


class TestParseDdgLite:
    def test_empty_html_returns_empty_list(self):
        assert _parse_ddg_lite("", 10) == []

    def test_parses_single_result(self):
        results = _parse_ddg_lite(DDG_SINGLE, 10)
        assert len(results) == 1
        assert results[0]["title"] == "Example Site"
        assert results[0]["url"] == "https://example.com"
        assert "snippet" in results[0]["snippet"].lower()

    def test_decodes_uddg_url(self):
        results = _parse_ddg_lite(DDG_SINGLE, 10)
        assert results[0]["url"] == "https://example.com"

    def test_respects_max_results(self):
        results = _parse_ddg_lite(DDG_MULTI, 2)
        assert len(results) == 2

    def test_parses_multiple_results(self):
        results = _parse_ddg_lite(DDG_MULTI, 10)
        assert len(results) == 3
        assert results[0]["title"] == "First Result"
        assert results[1]["url"] == "https://two.com"

    def test_handles_no_uddg_param(self):
        html = "<td><a class='result-link' href='//duckduckgo.com/l/?other=x'>Title</a></td><td class='result-snippet'>Snip</td>"
        results = _parse_ddg_lite(html, 10)
        assert len(results) == 1
        # Without uddg, returns the raw href
        assert results[0]["url"] != ""

    def test_html_entities_in_title(self):
        html = "<td><a class='result-link' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.com'>AT&amp;T</a></td><td class='result-snippet'>Snip</td>"
        results = _parse_ddg_lite(html, 10)
        assert results[0]["title"] == "AT&T"

    def test_no_results_for_unrecognised_structure(self):
        assert _parse_ddg_lite("<div>nothing here</div>", 10) == []


# ── _extract_readable_text ────────────────────────────────────────────────────

class TestExtractReadableText:
    def test_extracts_title(self):
        html = "<html><head><title>Page Title</title></head><body>Body</body></html>"
        title, _ = _extract_readable_text(html)
        assert title == "Page Title"

    def test_extracts_body_text(self):
        html = "<html><body><p>Hello world</p></body></html>"
        _, body = _extract_readable_text(html)
        assert "Hello world" in body

    def test_skips_script_content(self):
        html = "<html><body><script>alert('xss')</script><p>Safe text</p></body></html>"
        _, body = _extract_readable_text(html)
        assert "alert" not in body
        assert "Safe text" in body

    def test_skips_style_content(self):
        html = "<html><body><style>body { color: red; }</style><p>Visible</p></body></html>"
        _, body = _extract_readable_text(html)
        assert "color" not in body
        assert "Visible" in body

    def test_skips_nav_and_footer(self):
        html = "<html><body><nav>Nav links</nav><p>Main</p><footer>Footer</footer></body></html>"
        _, body = _extract_readable_text(html)
        assert "Nav links" not in body
        assert "Footer" not in body
        assert "Main" in body

    def test_decodes_html_entities(self):
        html = "<p>Caf&eacute; &amp; co</p>"
        _, body = _extract_readable_text(html)
        assert "é" in body or "Café" in body
        assert "&eacute;" not in body

    def test_empty_html(self):
        title, body = _extract_readable_text("")
        assert title == ""
        assert body == ""
