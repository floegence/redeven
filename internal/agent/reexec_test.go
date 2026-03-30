package agent

import (
	"path/filepath"
	"reflect"
	"testing"

	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
)

func TestRewriteSelfExecArgsReusesRuntimeBindForDynamicBind(t *testing.T) {
	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	if err := localuiruntime.WriteState(runtimePath, localuiruntime.State{
		LocalUIURL: "http://127.0.0.1:43123/",
	}); err != nil {
		t.Fatalf("WriteState() error = %v", err)
	}

	argv := []string{"redeven", "run", "--mode", "desktop", "--local-ui-bind", "127.0.0.1:0"}
	got := rewriteSelfExecArgs(argv, runtimePath)
	want := []string{"redeven", "run", "--mode", "desktop", "--local-ui-bind", "127.0.0.1:43123"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, want)
	}
}

func TestRewriteSelfExecArgsSupportsEqualsFlagForm(t *testing.T) {
	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	if err := localuiruntime.WriteState(runtimePath, localuiruntime.State{
		LocalUIURL: "http://127.0.0.1:43123/",
	}); err != nil {
		t.Fatalf("WriteState() error = %v", err)
	}

	argv := []string{"redeven", "run", "--local-ui-bind=127.0.0.1:0"}
	got := rewriteSelfExecArgs(argv, runtimePath)
	want := []string{"redeven", "run", "--local-ui-bind=127.0.0.1:43123"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, want)
	}
}

func TestRewriteSelfExecArgsReusesRuntimeBindForIPv6DynamicBind(t *testing.T) {
	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	if err := localuiruntime.WriteState(runtimePath, localuiruntime.State{
		LocalUIURL: "http://[::1]:43123/",
	}); err != nil {
		t.Fatalf("WriteState() error = %v", err)
	}

	argv := []string{"redeven", "run", "--local-ui-bind", "[::1]:0"}
	got := rewriteSelfExecArgs(argv, runtimePath)
	want := []string{"redeven", "run", "--local-ui-bind", "[::1]:43123"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, want)
	}
}

func TestRewriteSelfExecArgsLeavesFixedBindUntouched(t *testing.T) {
	runtimePath := filepath.Join(t.TempDir(), "runtime", "local-ui.json")
	if err := localuiruntime.WriteState(runtimePath, localuiruntime.State{
		LocalUIURL: "http://127.0.0.1:43123/",
	}); err != nil {
		t.Fatalf("WriteState() error = %v", err)
	}

	argv := []string{"redeven", "run", "--local-ui-bind", "127.0.0.1:24000"}
	got := rewriteSelfExecArgs(argv, runtimePath)
	if !reflect.DeepEqual(got, argv) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, argv)
	}
}

func TestRewriteSelfExecArgsLeavesArgsUntouchedWhenRuntimeStateIsMissing(t *testing.T) {
	argv := []string{"redeven", "run", "--local-ui-bind", "127.0.0.1:0"}
	got := rewriteSelfExecArgs(argv, filepath.Join(t.TempDir(), "missing.json"))
	if !reflect.DeepEqual(got, argv) {
		t.Fatalf("rewriteSelfExecArgs() = %#v, want %#v", got, argv)
	}
}
