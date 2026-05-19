package agent

import (
	"reflect"
	"testing"
)

func TestRewriteSelfExecArgsReusesRuntimeBindForDynamicBind(t *testing.T) {
	argv := []string{"redeven", "run", "--mode", "desktop", "--local-ui-bind", "127.0.0.1:0"}
	got := rewriteSelfExecArgs(argv, "127.0.0.1:43123")
	want := []string{"redeven", "run", "--mode", "desktop", "--local-ui-bind", "127.0.0.1:43123"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, want)
	}
}

func TestRewriteSelfExecArgsSupportsEqualsFlagForm(t *testing.T) {
	argv := []string{"redeven", "run", "--local-ui-bind=127.0.0.1:0"}
	got := rewriteSelfExecArgs(argv, "127.0.0.1:43123")
	want := []string{"redeven", "run", "--local-ui-bind=127.0.0.1:43123"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, want)
	}
}

func TestRewriteSelfExecArgsReusesRuntimeBindForIPv6DynamicBind(t *testing.T) {
	argv := []string{"redeven", "run", "--local-ui-bind", "[::1]:0"}
	got := rewriteSelfExecArgs(argv, "[::1]:43123")
	want := []string{"redeven", "run", "--local-ui-bind", "[::1]:43123"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, want)
	}
}

func TestRewriteSelfExecArgsLeavesFixedBindUntouched(t *testing.T) {
	argv := []string{"redeven", "run", "--local-ui-bind", "127.0.0.1:24000"}
	got := rewriteSelfExecArgs(argv, "127.0.0.1:43123")
	if !reflect.DeepEqual(got, argv) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, argv)
	}
}

func TestRewriteSelfExecArgsLeavesArgsUntouchedWhenRuntimeBindIsMissing(t *testing.T) {
	argv := []string{"redeven", "run", "--local-ui-bind", "127.0.0.1:0"}
	got := rewriteSelfExecArgs(argv, "")
	if !reflect.DeepEqual(got, argv) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, argv)
	}
}
