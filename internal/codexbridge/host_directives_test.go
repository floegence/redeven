package codexbridge

import "testing"

func TestParseAssistantHostDirectives_StripsKnownDirectiveLines(t *testing.T) {
	t.Parallel()

	parsed := parseAssistantHostDirectives("Done.\n\n::git-stage{cwd=\"/repo\"} ::git-commit{cwd=\"/repo\"}\n::git-push{cwd=\"/repo\" branch=\"main\"}\n")

	if parsed.Text != "Done." {
		t.Fatalf("Text=%q, want Done.", parsed.Text)
	}
	if len(parsed.Directives) != 3 {
		t.Fatalf("Directives len=%d, want 3; directives=%+v", len(parsed.Directives), parsed.Directives)
	}
	if parsed.Directives[0].Name != "git-stage" || parsed.Directives[2].Name != "git-push" {
		t.Fatalf("unexpected directives: %+v", parsed.Directives)
	}
}

func TestParseAssistantHostDirectives_PreservesUnknownDirectiveLines(t *testing.T) {
	t.Parallel()

	parsed := parseAssistantHostDirectives("Done.\n::custom-host-action{value=\"x\"}")

	if parsed.Text != "Done.\n::custom-host-action{value=\"x\"}" {
		t.Fatalf("Text=%q", parsed.Text)
	}
	if len(parsed.Directives) != 0 {
		t.Fatalf("Directives=%+v, want empty", parsed.Directives)
	}
}

func TestParseAssistantHostDirectives_PreservesInlineMentions(t *testing.T) {
	t.Parallel()

	text := "Do not render ::git-push{cwd=\"/repo\"} as an action here."
	parsed := parseAssistantHostDirectives(text)

	if parsed.Text != text {
		t.Fatalf("Text=%q, want original", parsed.Text)
	}
	if len(parsed.Directives) != 0 {
		t.Fatalf("Directives=%+v, want empty", parsed.Directives)
	}
}

func TestParseAssistantHostDirectives_PreservesFencedExamples(t *testing.T) {
	t.Parallel()

	text := "Example:\n```text\n::git-stage{cwd=\"/repo\"}\n```\nDone.\n::archive{reason=\"finished\"}"
	parsed := parseAssistantHostDirectives(text)

	want := "Example:\n```text\n::git-stage{cwd=\"/repo\"}\n```\nDone."
	if parsed.Text != want {
		t.Fatalf("Text=%q, want %q", parsed.Text, want)
	}
	if len(parsed.Directives) != 1 || parsed.Directives[0].Name != "archive" {
		t.Fatalf("Directives=%+v, want archive only", parsed.Directives)
	}
}

func TestParseAssistantHostDirectives_HandlesQuotedBraces(t *testing.T) {
	t.Parallel()

	parsed := parseAssistantHostDirectives("Done\n::code-comment{title=\"x\" body=\"literal } brace\" file=\"/tmp/a.go\"}")

	if parsed.Text != "Done" {
		t.Fatalf("Text=%q, want Done", parsed.Text)
	}
	if len(parsed.Directives) != 1 {
		t.Fatalf("Directives len=%d, want 1", len(parsed.Directives))
	}
	if parsed.Directives[0].Args != "title=\"x\" body=\"literal } brace\" file=\"/tmp/a.go\"" {
		t.Fatalf("Args=%q", parsed.Directives[0].Args)
	}
}
