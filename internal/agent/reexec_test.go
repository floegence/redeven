package agent

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/runtimeidentity"
)

func TestResolveSelfExecPlanSeparatesActivationRootFromRuntimeSuite(t *testing.T) {
	root := t.TempDir()
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("a", 64)
	suite := filepath.Join(root, ".redeven-runtime-suites", hash)
	if err := os.MkdirAll(suite, 0o700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(suite, "redeven")
	if err := os.WriteFile(executable, []byte("runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	runtimePath := filepath.Join(suite, "redevplugin-runtime")
	if err := os.WriteFile(runtimePath, []byte("plugin runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	activation := filepath.Join(root, "redeven")
	if err := os.Symlink(filepath.Join(".redeven-runtime-suites", hash, "redeven"), activation); err != nil {
		t.Fatal(err)
	}
	canonical, err := runtimeidentity.CanonicalExecutablePath(activation)
	if err != nil {
		t.Fatal(err)
	}

	plan, err := resolveSelfExecPlan(canonical, "127.0.0.1:43123")
	if err != nil {
		t.Fatal(err)
	}
	if plan.exePath != canonical || plan.installDir != canonicalRoot || plan.activationPath != filepath.Join(canonicalRoot, "redeven") {
		t.Fatalf("unexpected self exec plan: %#v", plan)
	}
	gotRuntimePath, err := bundledReDevPluginRuntimePath(plan.exePath)
	if err != nil {
		t.Fatal(err)
	}
	wantRuntimePath := filepath.Join(filepath.Dir(canonical), "redevplugin-runtime")
	if gotRuntimePath != wantRuntimePath {
		t.Fatalf("bundled runtime path = %q, want %q", gotRuntimePath, wantRuntimePath)
	}
}

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
