package flowerwork

import (
	"context"
	"errors"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestBindingHasOneAuthoritativeOwner(t *testing.T) {
	r := New()
	a := func(kind string) Adapter {
		return AdapterFunc(func(_ context.Context, _ *session.Meta, thread string) (*Resolved, error) {
			return &Resolved{Binding: Binding{Kind: kind, ThreadID: thread}}, nil
		})
	}
	if err := r.Register("workflow", a("workflow")); err != nil {
		t.Fatal(err)
	}
	if err := r.Register("workflow", a("workflow")); err == nil {
		t.Fatal("duplicate accepted")
	}
	if _, err := r.Resolve(t.Context(), &session.Meta{}, "thread"); err != nil {
		t.Fatal(err)
	}
	if err := r.Register("plugin", a("plugin")); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Resolve(t.Context(), &session.Meta{}, "thread"); !errors.Is(err, ErrUnavailable) {
		t.Fatal("ambiguous binding accepted", err)
	}
}
func TestFailedAdapterDoesNotDowngradeToOrdinaryWork(t *testing.T) {
	r := New()
	want := errors.New("owner storage unavailable")
	_ = r.Register("flow", AdapterFunc(func(context.Context, *session.Meta, string) (*Resolved, error) { return nil, want }))
	if _, err := r.Resolve(t.Context(), &session.Meta{}, "thread"); !errors.Is(err, want) {
		t.Fatal(err)
	}
}

func TestProfileExposesOnlyDeclaredToolSurface(t *testing.T) {
	profile := Profile{ToolNames: []string{"automation_read_context", "automation_submit_result"}}
	for _, name := range []string{"automation_read_definition", "automation_save_definition", "plugin_author_build", "terminal.exec"} {
		if profile.AllowsTool(name) {
			t.Fatal("undeclared tool", name)
		}
	}
	if !profile.AllowsTool("automation_read_context") {
		t.Fatal("declared tool missing")
	}
	author := Profile{ToolPrefixes: []string{"plugin_author_"}}
	if !author.AllowsTool("plugin_author_build") || author.AllowsTool("tessiven_save_canvas") {
		t.Fatal("namespace crossover")
	}
}
