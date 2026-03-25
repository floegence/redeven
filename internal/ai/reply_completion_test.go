package ai

import "testing"

func TestNormalizeReplyFinishReason(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		raw    string
		expect string
	}{
		{name: "empty defaults to stop", raw: "", expect: "stop"},
		{name: "stop preserved", raw: "stop", expect: "stop"},
		{name: "length preserved", raw: "length", expect: "length"},
		{name: "content filter preserved", raw: "content_filter", expect: "content_filter"},
		{name: "function call collapses to tool signal", raw: "function_call", expect: "tool_calls"},
		{name: "tool calls preserved", raw: "tool_calls", expect: "tool_calls"},
		{name: "unknown preserved", raw: "something_else", expect: "unknown"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := normalizeReplyFinishReason(tc.raw); got != tc.expect {
				t.Fatalf("normalizeReplyFinishReason(%q)=%q, want %q", tc.raw, got, tc.expect)
			}
		})
	}
}

func TestClassifyReplyFinish(t *testing.T) {
	t.Parallel()

	cases := []struct {
		reason string
		want   replyFinishClass
	}{
		{reason: "stop", want: replyFinishClassClean},
		{reason: "", want: replyFinishClassClean},
		{reason: "length", want: replyFinishClassRetry},
		{reason: "content_filter", want: replyFinishClassBlocked},
		{reason: "tool_calls", want: replyFinishClassToolSignal},
		{reason: "unknown", want: replyFinishClassInvalid},
	}
	for _, tc := range cases {
		if got := classifyReplyFinish(tc.reason); got != tc.want {
			t.Fatalf("classifyReplyFinish(%q)=%q, want %q", tc.reason, got, tc.want)
		}
	}
}

func TestImplicitReplyCompletionEligible(t *testing.T) {
	t.Parallel()

	if !implicitReplyCompletionEligible("stop") {
		t.Fatalf("stop should be eligible for implicit completion")
	}
	if !implicitReplyCompletionEligible("") {
		t.Fatalf("empty finish reason should normalize to a clean completion")
	}
	for _, reason := range []string{"length", "content_filter", "tool_calls", "unknown"} {
		if implicitReplyCompletionEligible(reason) {
			t.Fatalf("%q should not be eligible for implicit completion", reason)
		}
	}
}

func TestMapOpenAIStatus_EmptyDefaultsToStop(t *testing.T) {
	t.Parallel()

	if got := mapOpenAIStatus(""); got != "stop" {
		t.Fatalf("mapOpenAIStatus(empty)=%q, want stop", got)
	}
}
