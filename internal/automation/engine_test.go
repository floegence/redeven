package automation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type testExecutor struct {
	starts        []Attempt
	states        map[string]ExecutionStatus
	revoked       bool
	cancels       int
	authorizeHook func()
	startHook     func()
}

func (x *testExecutor) Start(_ context.Context, _ Owner, _ Run, a Attempt) (string, error) {
	x.starts = append(x.starts, a)
	if x.startHook != nil {
		x.startHook()
	}
	return "thread_" + a.ID, nil
}
func (x *testExecutor) Inspect(_ context.Context, _ Owner, _ Run, a Attempt) (ExecutionStatus, error) {
	return x.states[a.ID], nil
}
func (x *testExecutor) Cancel(context.Context, Owner, Attempt) error { x.cancels++; return nil }
func (x *testExecutor) Tool(context.Context, Owner, Run, Attempt, Node) (json.RawMessage, error) {
	return json.RawMessage(`{"ok":true}`), nil
}
func (x *testExecutor) Authorize(context.Context, Owner, Run) error {
	if x.authorizeHook != nil {
		x.authorizeHook()
	}
	if x.revoked {
		return ErrUnauthorized
	}
	return nil
}

var testOwner = Owner{"user", "env"}

func fixture(t *testing.T, nodes []Node) (*Store, *Engine, Run) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "flows.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	d := Definition{Title: "Inspection", Goal: "Inspect every target", Model: "test/model", WorkingDirectory: "/work", Nodes: nodes, MaxConcurrent: 2, TimeoutSeconds: 300}
	w, err := s.Create(context.Background(), testOwner, "create", d)
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.Publish(context.Background(), testOwner, w.ID, w.Revision, Grant{Model: d.Model, WorkingDirectory: d.WorkingDirectory, Authority: GrantAuthority{Namespace: "namespace", App: "app", Read: true, Write: true, Execute: true}, Enabled: true, ExpiresAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.CreateRun(context.Background(), testOwner, w.ID, "run", p.Version, "test", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return s, &Engine{Store: s, Executor: &testExecutor{states: map[string]ExecutionStatus{}}}, r
}
func agent(id string, deps ...string) Node {
	return Node{ID: id, Title: id, Kind: "agent", Instruction: "Inspect", DependsOn: deps, OutputSchema: json.RawMessage(`{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}},"additionalProperties":false}`)}
}
func step(t *testing.T, e *Engine, id string) Run {
	t.Helper()
	if err := e.Step(context.Background(), testOwner, id); err != nil {
		t.Fatal(err)
	}
	r, err := e.Store.Run(context.Background(), testOwner, id)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func complete(t *testing.T, e *Engine, r Run, id string) {
	t.Helper()
	a := latestAttempts(r, id)[0]
	if _, err := e.Store.SubmitResult(context.Background(), testOwner, r.ID, a.ID, json.RawMessage(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	e.Executor.(*testExecutor).states[a.ID] = ExecutionStatus{Terminal: true, Outcome: "completed"}
}
func TestDependencyResultAndRestartContext(t *testing.T) {
	s, e, r := fixture(t, []Node{agent("research"), agent("review", "research")})
	r = step(t, e, r.ID)
	if len(r.Attempts) != 1 {
		t.Fatal("dependent work admitted early")
	}
	if _, err := s.SubmitResult(context.Background(), testOwner, r.ID, r.Attempts[0].ID, json.RawMessage(`{"wrong":1}`)); err == nil {
		t.Fatal("invalid result accepted")
	}
	complete(t, e, r, "research")
	r = step(t, e, r.ID)
	if len(r.Contributions) != 1 || len(r.Attempts) != 2 || r.Attempts[1].ContextRevision != r.ContextRevision {
		t.Fatalf("shared context not visible: %+v", r)
	}
	brief, err := s.Brief(context.Background(), testOwner, r.ID)
	if err != nil || !strings.Contains(brief, "research") || !strings.Contains(brief, "Structured result") {
		t.Fatal(brief, err)
	}
	complete(t, e, r, "review")
	r = step(t, e, r.ID)
	if r.Status != "completed" {
		t.Fatal(r.Status)
	}
}
func TestRevocationCancelsActiveAndBlocksDownstream(t *testing.T) {
	_, e, r := fixture(t, []Node{agent("one"), agent("two", "one")})
	r = step(t, e, r.ID)
	x := e.Executor.(*testExecutor)
	x.revoked = true
	r = step(t, e, r.ID)
	if r.Status != "blocked" || len(x.starts) != 1 || x.cancels != 1 {
		t.Fatalf("revocation not enforced: %+v", r)
	}
}
func TestRetryWaitsForDependenciesAndPreservesHistory(t *testing.T) {
	_, e, r := fixture(t, []Node{agent("one"), agent("two", "one")})
	r = step(t, e, r.ID)
	x := e.Executor.(*testExecutor)
	x.states[r.Attempts[0].ID] = ExecutionStatus{Terminal: true, Outcome: "failed"}
	r = step(t, e, r.ID)
	if r.Status != "failed" {
		t.Fatal(r.Status)
	}
	r, err := e.Store.Retry(context.Background(), testOwner, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	r = step(t, e, r.ID)
	if len(x.starts) != 2 || x.starts[1].NodeID != "one" {
		t.Fatalf("dependent retry started early: %+v", x.starts)
	}
	complete(t, e, r, "one")
	r = step(t, e, r.ID)
	if len(x.starts) != 3 || x.starts[2].NodeID != "two" {
		t.Fatal(x.starts)
	}
	if len(r.Attempts) != 4 {
		t.Fatal("retry erased history")
	}
}
func TestParallelBoundsAndStableIdentities(t *testing.T) {
	n := agent("cluster")
	n.Kind = "parallel"
	n.Concurrency = 1
	n.Items = []Item{{"a", "A", json.RawMessage(`{}`)}, {"b", "B", json.RawMessage(`{}`)}, {"c", "C", json.RawMessage(`{}`)}}
	_, e, r := fixture(t, []Node{n})
	r = step(t, e, r.ID)
	x := e.Executor.(*testExecutor)
	if len(r.Attempts) != 3 || len(x.starts) != 1 {
		t.Fatal("parallel bounds")
	}
	for i := 0; i < 3; i++ {
		a := r.Attempts[i]
		if _, err := e.Store.SubmitResult(context.Background(), testOwner, r.ID, a.ID, json.RawMessage(`{"ok":true}`)); err != nil {
			t.Fatal(err)
		}
		x.states[a.ID] = ExecutionStatus{Terminal: true, Outcome: "completed"}
		r = step(t, e, r.ID)
	}
	if r.Status != "completed" || len(x.starts) != 3 {
		t.Fatal(r.Status)
	}
}
func TestUnknownIsNotReplayedOrRetried(t *testing.T) {
	_, e, r := fixture(t, []Node{agent("one")})
	r = step(t, e, r.ID)
	x := e.Executor.(*testExecutor)
	x.states[r.Attempts[0].ID] = ExecutionStatus{Terminal: true, Outcome: "unknown"}
	for i := 0; i < 3; i++ {
		r = step(t, e, r.ID)
	}
	if len(x.starts) != 1 || r.Attempts[0].State != "unknown" {
		t.Fatal("uncertain execution replayed")
	}
	if _, err := e.Store.Retry(context.Background(), testOwner, r.ID); err == nil {
		t.Fatal("unknown retry accepted")
	}
}
func TestOwnershipRevisionAndRequestIdentity(t *testing.T) {
	s, _, r := fixture(t, []Node{agent("one")})
	ctx := context.Background()
	if _, err := s.Run(ctx, Owner{"other", "env"}, r.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	w, _ := s.Get(ctx, testOwner, r.WorkflowID)
	d := w.Definition
	d.Title = "Different"
	if _, err := s.Create(ctx, testOwner, "create", d); !errors.Is(err, ErrConflict) {
		t.Fatal("request collision accepted", err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	accepted := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Save(ctx, testOwner, w.ID, w.Revision, d); err == nil {
				mu.Lock()
				accepted++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if accepted != 1 {
		t.Fatal(accepted)
	}
}
func TestHTMLAndReviewedDelivery(t *testing.T) {
	_, e, r := fixture(t, []Node{{ID: "report", Title: "Report", Kind: "render", Template: "<h1>{{.Title}}</h1>"}, {ID: "save", Title: "Save", Kind: "deliver", Tool: "artifact.save", DependsOn: []string{"report"}, RequireReview: true}})
	r = step(t, e, r.ID)
	r = step(t, e, r.ID)
	if len(r.Artifacts) != 1 || r.Status != "review" {
		t.Fatal(r.Status)
	}
	if _, err := e.Store.Approve(context.Background(), testOwner, r.ID, latestAttempts(r, "save")[0].ID); err != nil {
		t.Fatal(err)
	}
	r = step(t, e, r.ID)
	if r.Status != "completed" {
		t.Fatal(r.Status)
	}
}

func TestRetryPreservesSuccessfulParallelItems(t *testing.T) {
	n := agent("clusters")
	n.Kind = "parallel"
	n.Concurrency = 2
	n.Items = []Item{{"a", "A", json.RawMessage(`{}`)}, {"b", "B", json.RawMessage(`{}`)}}
	s, e, r := fixture(t, []Node{n})
	r = step(t, e, r.ID)
	x := e.Executor.(*testExecutor)
	complete(t, e, r, "clusters")
	x.states[r.Attempts[1].ID] = ExecutionStatus{Terminal: true, Outcome: "failed"}
	r = step(t, e, r.ID)
	if _, err := s.Retry(context.Background(), testOwner, r.ID); err != nil {
		t.Fatal(err)
	}
	r = step(t, e, r.ID)
	if len(x.starts) != 3 || x.starts[2].Item.ID != "b" {
		t.Fatalf("successful item replayed: %+v", x.starts)
	}
	if r.Contributions[0].Invalidated {
		t.Fatal("successful item evidence invalidated")
	}
}

func TestReviewRejectsRevokedGrant(t *testing.T) {
	s, e, r := fixture(t, []Node{{ID: "report", Title: "Report", Kind: "render", Template: "<h1>Report</h1>"}, {ID: "save", Title: "Save", Kind: "deliver", Tool: "artifact.save", DependsOn: []string{"report"}, RequireReview: true}})
	r = step(t, e, r.ID)
	r = step(t, e, r.ID)
	if err := s.Revoke(context.Background(), testOwner, r.WorkflowID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Approve(context.Background(), testOwner, r.ID, latestAttempts(r, "save")[0].ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("revoked review accepted", err)
	}
}

func TestDynamicItemsReexpandAfterSourceRetry(t *testing.T) {
	source := agent("source")
	source.OutputSchema = json.RawMessage(`{"type":"array"}`)
	parallel := agent("targets", "source")
	parallel.Kind = "parallel"
	parallel.Concurrency = 2
	parallel.ItemsFrom = "source"
	s, e, r := fixture(t, []Node{source, parallel})
	r = step(t, e, r.ID)
	x := e.Executor.(*testExecutor)
	x.states[r.Attempts[0].ID] = ExecutionStatus{Terminal: true, Outcome: "failed"}
	r = step(t, e, r.ID)
	if _, err := s.Retry(t.Context(), testOwner, r.ID); err != nil {
		t.Fatal(err)
	}
	r = step(t, e, r.ID)
	a := latestAttempts(r, "source")[0]
	if _, err := s.SubmitResult(t.Context(), testOwner, r.ID, a.ID, json.RawMessage(`[{"id":"new-target","label":"New target","data":{}}]`)); err != nil {
		t.Fatal(err)
	}
	x.states[a.ID] = ExecutionStatus{Terminal: true, Outcome: "completed"}
	r = step(t, e, r.ID)
	items := latestAttempts(r, "targets")
	if len(items) != 1 || items[0].Item == nil || items[0].Item.ID != "new-target" {
		t.Fatalf("stale expansion %+v", items)
	}
}

func TestPartialJoinExplicitlyReportsCoverage(t *testing.T) {
	group := agent("targets")
	group.Kind = "parallel"
	group.Concurrency = 2
	group.Items = []Item{{"a", "A", json.RawMessage(`{}`)}, {"b", "B", json.RawMessage(`{}`)}}
	_, e, r := fixture(t, []Node{group, {ID: "join", Title: "Coverage", Kind: "join", DependsOn: []string{"targets"}, JoinPolicy: "partial", MinimumSuccess: 1}, {ID: "report", Title: "Report", Kind: "render", DependsOn: []string{"join"}, Template: `{{range index .Inputs "join"}}{{.coverage.completed}}/{{.coverage.total}}{{end}}`}})
	_, err := e.Store.UpdateRun(t.Context(), testOwner, r.ID, func(r *Run) error { r.Definition.AllowPartial = true; return nil })
	if err != nil {
		t.Fatal(err)
	}
	r = step(t, e, r.ID)
	complete(t, e, r, "targets")
	e.Executor.(*testExecutor).states[r.Attempts[1].ID] = ExecutionStatus{Terminal: true, Outcome: "failed"}
	for i := 0; i < 4; i++ {
		r = step(t, e, r.ID)
	}
	if r.Status != "partial" || len(r.Artifacts) != 1 || r.Artifacts[0].Content != "1/2" {
		t.Fatalf("coverage not visible: %+v", r)
	}
}

func TestConditionSkipsOnlyItsBranch(t *testing.T) {
	_, e, r := fixture(t, []Node{agent("source"), {ID: "condition", Title: "Condition", Kind: "condition", DependsOn: []string{"source"}, Condition: &Condition{NodeID: "source", Field: "ok", Equals: json.RawMessage(`false`)}}, agent("branch", "condition"), {ID: "join", Title: "Join", Kind: "join", DependsOn: []string{"source", "branch"}}})
	r = step(t, e, r.ID)
	complete(t, e, r, "source")
	for i := 0; i < 5; i++ {
		r = step(t, e, r.ID)
	}
	if r.Status != "completed" || len(e.Executor.(*testExecutor).starts) != 1 || latestAttempts(r, "branch")[0].Error != "condition_branch" {
		t.Fatal(r.Status, r.Attempts)
	}
}

func TestChangedRequirementInvalidatesEarlierResults(t *testing.T) {
	s, e, r := fixture(t, []Node{agent("first"), agent("second", "first")})
	r = step(t, e, r.ID)
	complete(t, e, r, "first")
	r = step(t, e, r.ID)
	updated, err := s.Contribute(t.Context(), testOwner, r.ID, Contribution{ID: "changed-requirement", Kind: "requirement", Text: "Use the revised scope", Basis: r.ContextRevision})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Contributions[0].Invalidated || latestAttempts(updated, "first")[0].Error != "requirements_changed" {
		t.Fatal("stale success retained")
	}
	complete(t, e, r, "second")
	r = step(t, e, r.ID)
	if r.Status != "failed" || latestAttempts(r, "second")[0].Error != "requirements_changed" {
		t.Fatal(r.Status, r.Attempts)
	}
}

func TestRenderStopsAtBoundedOutput(t *testing.T) {
	var b boundedBuffer
	b.limit = 4
	if _, err := b.Write([]byte("12345")); !errors.Is(err, ErrInvalid) || b.Len() != 0 {
		t.Fatal(err, b.Len())
	}
	if _, err := b.Write([]byte("1234")); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Write([]byte("5")); !errors.Is(err, ErrInvalid) || b.Len() != 4 {
		t.Fatal(err, b.Len())
	}
}

func TestLateLocalResultCannotPublishAfterNewRequirement(t *testing.T) {
	s, e, r := fixture(t, []Node{{ID: "report", Title: "Report", Kind: "render", Template: "<h1>Old</h1>"}})
	a := Attempt{ID: "attempt", NodeID: "report", State: "submitted", Number: 1, ContextRevision: r.ContextRevision}
	r, err := s.UpdateRun(t.Context(), testOwner, r.ID, func(r *Run) error { r.Attempts = append(r.Attempts, a); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Contribute(t.Context(), testOwner, r.ID, Contribution{ID: "change", Kind: "requirement", Text: "New requirement", Basis: r.ContextRevision}); err != nil {
		t.Fatal(err)
	}
	if err = e.executeLocal(t.Context(), testOwner, r, a, r.Definition.Nodes[0]); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Run(t.Context(), testOwner, r.ID)
	if len(got.Artifacts) != 0 || got.Attempts[0].Error != "requirements_changed" {
		t.Fatal("stale result published", got)
	}
}

func TestCanceledRecoveredLocalStepSettlesWithoutReexecution(t *testing.T) {
	s, e, r := fixture(t, []Node{{ID: "render", Title: "Report", Kind: "render", Template: "<h1>Must not render</h1>"}})
	_, err := s.UpdateRun(t.Context(), testOwner, r.ID, func(current *Run) error {
		current.CancelRequested = true
		current.Attempts = []Attempt{{ID: "inflight-local", NodeID: "render", State: "submitted", ContextRevision: current.ContextRevision}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	r = step(t, e, r.ID)
	if r.Status != "canceled" || r.Attempts[0].State != "canceled" || len(r.Artifacts) != 0 {
		t.Fatal("local cancellation did not settle", r)
	}
}

func TestCancellationDuringAuthorizationRemainsMonotonic(t *testing.T) {
	for _, revoked := range []bool{false, true} {
		t.Run(fmt.Sprint(revoked), func(t *testing.T) {
			s, e, r := fixture(t, []Node{agent("one")})
			x := e.Executor.(*testExecutor)
			x.revoked = revoked
			x.authorizeHook = func() {
				if _, err := s.RequestCancel(t.Context(), testOwner, r.ID); err != nil {
					t.Fatal(err)
				}
			}
			r = step(t, e, r.ID)
			if !r.CancelRequested || r.Status != "canceled" || len(x.starts) != 0 {
				t.Fatalf("cancellation was lost during authorization: status=%s canceled=%t starts=%d", r.Status, r.CancelRequested, len(x.starts))
			}
		})
	}
}

func TestCancellationBetweenAdmissionsStopsRemainingNodes(t *testing.T) {
	s, e, r := fixture(t, []Node{agent("one"), agent("two")})
	x := e.Executor.(*testExecutor)
	x.startHook = func() {
		if _, err := s.RequestCancel(t.Context(), testOwner, r.ID); err != nil {
			t.Fatal(err)
		}
	}
	r = step(t, e, r.ID)
	if !r.CancelRequested || len(x.starts) != 1 {
		t.Fatalf("admitted more work after cancellation: canceled=%t starts=%d", r.CancelRequested, len(x.starts))
	}
}

func TestCancellationDuringAuthorizationStopsRecoveredLocalStep(t *testing.T) {
	s, e, r := fixture(t, []Node{{ID: "render", Title: "Report", Kind: "render", Template: "<h1>Must not render</h1>"}})
	_, err := s.UpdateRun(t.Context(), testOwner, r.ID, func(current *Run) error {
		current.Attempts = []Attempt{{ID: "recovered", NodeID: "render", State: "submitted", ContextRevision: current.ContextRevision}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	e.Executor.(*testExecutor).authorizeHook = func() {
		if _, err := s.RequestCancel(t.Context(), testOwner, r.ID); err != nil {
			t.Fatal(err)
		}
	}
	r = step(t, e, r.ID)
	if r.Status != "canceled" || len(r.Artifacts) != 0 {
		t.Fatal("recovered local step executed after cancellation", r.Status, len(r.Artifacts))
	}
}

func TestNewRequirementBetweenAdmissionsRechecksDependencies(t *testing.T) {
	s, e, r := fixture(t, []Node{agent("source"), agent("first", "source"), agent("second", "source")})
	r = step(t, e, r.ID)
	complete(t, e, r, "source")
	x := e.Executor.(*testExecutor)
	x.startHook = func() {
		current, err := s.Run(t.Context(), testOwner, r.ID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.Contribute(t.Context(), testOwner, r.ID, Contribution{ID: "new-requirement", Kind: "requirement", Text: "Verify the updated scope", Basis: current.ContextRevision}); err != nil {
			t.Fatal(err)
		}
	}
	r = step(t, e, r.ID)
	if len(x.starts) != 2 || latestAttempts(r, "second")[0].State != "pending" {
		t.Fatal("dependent work admitted against invalidated inputs", len(x.starts), r.Attempts)
	}
}
