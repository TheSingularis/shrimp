"""Tests for pure functions in email_processor.py."""
import pytest

from email_processor import _attachment_context, _parse_triage_markdown


# ── _attachment_context ───────────────────────────────────────────────────────

class TestAttachmentContext:
    def test_no_attachments_returns_empty(self):
        assert _attachment_context({}) == ""
        assert _attachment_context({"attachments": []}) == ""

    def test_single_small_attachment(self):
        data = {"attachments": [
            {"filename": "doc.pdf", "content_type": "application/pdf", "size": 51200},
        ]}
        result = _attachment_context(data)
        assert "doc.pdf" in result
        assert "application/pdf" in result
        assert "50 KB" in result

    def test_large_attachment_in_mb(self):
        data = {"attachments": [
            {"filename": "video.mp4", "content_type": "video/mp4", "size": 5_242_880},
        ]}
        result = _attachment_context(data)
        assert "5.0 MB" in result

    def test_multiple_attachments(self):
        data = {"attachments": [
            {"filename": "a.pdf", "content_type": "application/pdf", "size": 1024},
            {"filename": "b.png", "content_type": "image/png", "size": 2048},
        ]}
        result = _attachment_context(data)
        assert "a.pdf" in result
        assert "b.png" in result
        assert "Attachments (2)" in result

    def test_missing_filename_uses_question_mark(self):
        data = {"attachments": [{"content_type": "application/octet-stream", "size": 0}]}
        result = _attachment_context(data)
        assert "?" in result


# ── _parse_triage_markdown ────────────────────────────────────────────────────

# The function matches **header** (closing ** before the colon), not **header:**
FULL_TRIAGE = """\
**Urgency**: High
**Summary**: Contract renewal deadline approaching next Friday.
**Action Items**:
- Review contract terms
- Schedule call with legal
- Send confirmation
**Suggested Reply**: Thanks, I'll review by EOD.
"""


class TestParseTriageMarkdown:
    def test_parses_high_urgency(self):
        urgency, _, _ = _parse_triage_markdown(FULL_TRIAGE)
        assert urgency == "high"

    def test_parses_urgent(self):
        text = "**Urgency**: Urgent — act now"
        urgency, _, _ = _parse_triage_markdown(text)
        assert urgency == "urgent"

    def test_parses_low(self):
        urgency, _, _ = _parse_triage_markdown("**Urgency**: Low priority")
        assert urgency == "low"

    def test_parses_spam(self):
        urgency, _, _ = _parse_triage_markdown("**Urgency**: Spam")
        assert urgency == "spam"

    def test_defaults_to_normal_when_no_urgency(self):
        urgency, _, _ = _parse_triage_markdown("**Summary**: Something")
        assert urgency == "normal"

    def test_parses_summary_inline(self):
        _, note, _ = _parse_triage_markdown(FULL_TRIAGE)
        assert "Contract renewal" in note

    def test_parses_action_items(self):
        _, _, actions = _parse_triage_markdown(FULL_TRIAGE)
        assert len(actions) == 3
        assert "Review contract terms" in actions
        assert "Schedule call with legal" in actions

    def test_action_items_with_star_bullets(self):
        text = "**Action Items**:\n* Do thing one\n* Do thing two"
        _, _, actions = _parse_triage_markdown(text)
        assert len(actions) == 2
        assert "Do thing one" in actions

    def test_filters_out_none_action(self):
        text = "**Action Items**:\n- none"
        _, _, actions = _parse_triage_markdown(text)
        assert actions == []

    def test_empty_input_returns_defaults(self):
        urgency, note, actions = _parse_triage_markdown("")
        assert urgency == "normal"
        assert note == ""
        assert actions == []

    def test_case_insensitive_headers(self):
        text = "**URGENCY**: URGENT\n**SUMMARY**: All caps summary"
        urgency, note, _ = _parse_triage_markdown(text)
        assert urgency == "urgent"
        assert "All caps summary" in note

    def test_suggested_reply_stops_action_collection(self):
        text = "**Action Items**:\n- real action\n**Suggested Reply**: ignore this\n- should not be action"
        _, _, actions = _parse_triage_markdown(text)
        assert len(actions) == 1
        assert "real action" in actions
