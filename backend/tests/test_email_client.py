"""Tests for pure functions in email_client.py."""
import email as email_lib
import math

import pytest

from email_client import (
    _strip_html,
    _looks_like_html,
    _decode_header,
    _extract_body,
    _build_embed_text,
    _cosine,
    _imap_name,
)


# ── _strip_html ───────────────────────────────────────────────────────────────

class TestStripHtml:
    def test_empty_string(self):
        assert _strip_html("") == ""

    def test_plain_text_unchanged(self):
        assert _strip_html("Hello world") == "Hello world"

    def test_removes_simple_tags(self):
        assert _strip_html("<b>hello</b>") == "hello"

    def test_removes_nested_tags(self):
        result = _strip_html("<div><p>text</p></div>")
        assert "text" in result
        assert "<" not in result

    def test_decodes_html_entities(self):
        result = _strip_html("&amp; &lt; &gt;")
        assert "&" in result
        assert "<" in result

    def test_removes_zero_width_chars(self):
        result = _strip_html("hello​world")
        assert "​" not in result

    def test_collapses_multiple_spaces(self):
        result = _strip_html("hello    world")
        assert "  " not in result

    def test_collapses_excess_newlines(self):
        result = _strip_html("a\n\n\n\nb")
        assert "\n\n\n" not in result


# ── _looks_like_html ──────────────────────────────────────────────────────────

class TestLooksLikeHtml:
    def test_plain_text_false(self):
        assert _looks_like_html("Hello, this is plain text.") is False

    def test_doctype_true(self):
        assert _looks_like_html("<!DOCTYPE html><html>") is True

    def test_lowercase_doctype_true(self):
        assert _looks_like_html("<!doctype html><html>") is True

    def test_html_tag_at_start_true(self):
        assert _looks_like_html("<html><body>content</body></html>") is True

    def test_two_known_tags_true(self):
        assert _looks_like_html("<div><p>Hello</p></div>") is True

    def test_single_tag_false(self):
        assert _looks_like_html("Just one <b>tag") is False

    def test_empty_string_false(self):
        assert _looks_like_html("") is False

    def test_generic_angle_brackets_false(self):
        # RTF-like or code content with < > should not be detected as HTML
        assert _looks_like_html("Use T<E> generics — size < 100") is False

    def test_full_email_html_true(self):
        html = "<html><body><div><p>Newsletter content</p><table><tr><td>item</td></tr></table></div></body></html>"
        assert _looks_like_html(html) is True


# ── _decode_header ────────────────────────────────────────────────────────────

class TestDecodeHeader:
    def test_none_returns_empty(self):
        assert _decode_header(None) == ""

    def test_empty_string_returns_empty(self):
        assert _decode_header("") == ""

    def test_plain_ascii_unchanged(self):
        assert _decode_header("John Doe") == "John Doe"

    def test_plain_email_unchanged(self):
        assert _decode_header("John Doe <john@example.com>") == "John Doe <john@example.com>"

    def test_base64_encoded_utf8(self):
        # "=?utf-8?b?<base64 of 'Hello'>?=" → "Hello"
        import base64
        encoded = base64.b64encode("Héllo".encode("utf-8")).decode("ascii")
        header = f"=?utf-8?b?{encoded}?="
        result = _decode_header(header)
        assert "Héllo" in result

    def test_quoted_printable_encoded(self):
        # "=?utf-8?q?Fran=C3=A7ois?=" → "François"
        header = "=?utf-8?q?Fran=C3=A7ois?="
        result = _decode_header(header)
        assert "François" in result


# ── _extract_body ─────────────────────────────────────────────────────────────

def _make_msg(raw: str) -> email_lib.message.Message:
    return email_lib.message_from_string(raw)


PLAIN_ONLY = """\
From: test@example.com
Content-Type: text/plain; charset=utf-8

Hello, this is plain text.
"""

HTML_ONLY = """\
From: test@example.com
Content-Type: text/html; charset=utf-8

<html><body><p>Hello HTML</p></body></html>
"""

MULTIPART_ALT = """\
From: test@example.com
Content-Type: multipart/alternative; boundary="boundary"

--boundary
Content-Type: text/plain; charset=utf-8

Plain version of the email.
--boundary
Content-Type: text/html; charset=utf-8

<html><body><p>HTML version</p></body></html>
--boundary--
"""

MULTIPART_WITH_ATTACHMENT = """\
From: test@example.com
Content-Type: multipart/mixed; boundary="boundary"

--boundary
Content-Type: text/plain; charset=utf-8

Body text here.
--boundary
Content-Type: application/pdf
Content-Disposition: attachment; filename="doc.pdf"

%PDF fake
--boundary--
"""


class TestExtractBody:
    def test_plain_only_has_genuine_plain(self):
        plain, html, has_genuine = _extract_body(_make_msg(PLAIN_ONLY))
        assert "plain text" in plain
        assert html == ""
        assert has_genuine is True

    def test_html_only_no_genuine_plain(self):
        plain, html, has_genuine = _extract_body(_make_msg(HTML_ONLY))
        assert "Hello HTML" in html
        assert has_genuine is False

    def test_html_only_plain_is_stripped_fallback(self):
        plain, html, has_genuine = _extract_body(_make_msg(HTML_ONLY))
        # plain_out is derived from stripping html, not a real plain part
        assert "Hello HTML" in plain
        assert has_genuine is False

    def test_multipart_alternative_has_genuine_plain(self):
        plain, html, has_genuine = _extract_body(_make_msg(MULTIPART_ALT))
        assert "Plain version" in plain
        assert "HTML version" in html
        assert has_genuine is True

    def test_attachment_skipped(self):
        plain, html, has_genuine = _extract_body(_make_msg(MULTIPART_WITH_ATTACHMENT))
        assert "Body text" in plain
        assert "%PDF" not in plain
        assert "%PDF" not in html

    def test_empty_message(self):
        msg = _make_msg("From: test@example.com\n\n")
        plain, html, has_genuine = _extract_body(msg)
        assert plain == ""
        assert html == ""
        assert has_genuine is False

    def test_returns_tuple_of_three(self):
        result = _extract_body(_make_msg(PLAIN_ONLY))
        assert len(result) == 3

    def test_html_body_stripped_for_plain_when_no_plain_part(self):
        plain, html, has_genuine = _extract_body(_make_msg(HTML_ONLY))
        assert has_genuine is False
        assert plain != ""  # stripped fallback should exist


# ── _build_embed_text ─────────────────────────────────────────────────────────

class TestBuildEmbedText:
    def test_includes_subject_and_from(self):
        data = {"subject": "Test Subject", "from": "sender@example.com", "body": ""}
        result = _build_embed_text(data)
        assert "Test Subject" in result
        assert "sender@example.com" in result

    def test_includes_triage_note(self):
        data = {"subject": "", "from": "", "triage_note": "urgent deal", "body": ""}
        assert "urgent deal" in _build_embed_text(data)

    def test_includes_actions_list(self):
        data = {"subject": "", "from": "", "triage_actions": ["reply", "archive"], "body": ""}
        result = _build_embed_text(data)
        assert "reply" in result
        assert "archive" in result

    def test_body_truncated_to_1000(self):
        data = {"subject": "", "from": "", "body": "x" * 2000}
        result = _build_embed_text(data)
        assert "x" * 1001 not in result

    def test_missing_fields_handled(self):
        result = _build_embed_text({})
        assert result == ""

    def test_none_values_handled(self):
        data = {"subject": None, "from": None, "body": None, "triage_note": None}
        result = _build_embed_text(data)
        assert result == ""


# ── _cosine ───────────────────────────────────────────────────────────────────

class TestCosine:
    def test_identical_vectors_return_one(self):
        v = [1.0, 2.0, 3.0]
        assert abs(_cosine(v, v) - 1.0) < 1e-9

    def test_orthogonal_vectors_return_zero(self):
        assert abs(_cosine([1.0, 0.0], [0.0, 1.0])) < 1e-9

    def test_zero_vector_returns_zero(self):
        assert _cosine([0.0, 0.0], [1.0, 2.0]) == 0.0

    def test_opposite_vectors_return_negative_one(self):
        assert abs(_cosine([1.0, 0.0], [-1.0, 0.0]) - (-1.0)) < 1e-9

    def test_known_values(self):
        # [1,1] vs [1,0]: cos = 1/sqrt(2) ≈ 0.7071
        result = _cosine([1.0, 1.0], [1.0, 0.0])
        assert abs(result - (1 / math.sqrt(2))) < 1e-9

    def test_both_zero_vectors(self):
        assert _cosine([0.0], [0.0]) == 0.0


# ── _imap_name ────────────────────────────────────────────────────────────────

class TestImapName:
    def test_no_spaces_unchanged(self):
        assert _imap_name("INBOX") == "INBOX"

    def test_with_spaces_double_quoted(self):
        assert _imap_name("Sent Messages") == '"Sent Messages"'

    def test_already_quoted_treated_literally(self):
        # Function doesn't check for existing quotes
        result = _imap_name("Sent Items")
        assert result.startswith('"')
        assert result.endswith('"')

    def test_single_word_no_change(self):
        assert _imap_name("Trash") == "Trash"
