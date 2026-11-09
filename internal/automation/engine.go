package automation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"strings"
	"sync"
	"time"
)

// Executor is an adapter to existing invocation authority. Started requests are
// reconciled by their stable identity; errors alone never authorize replay.
type Executor interface {
	Start(context.Context, Owner, Run, Attempt) (string, error)
	Inspect(context.Context, Owner, Run, Attempt) (ExecutionStatus, error)
	Cancel(context.Context, Owner, Attempt) error
	Tool(context.Context, Owner, Run, Attempt, Node) (json.RawMessage, error)
	Authorize(context.Context, Owner, Run) error
}
type ToolFailure struct {
	Cause             error
	ConfirmedReadOnly bool
}

func (e *ToolFailure) Error() string { return e.Cause.Error() }
func (e *ToolFailure) Unwrap() error { return e.Cause }

type ExecutionStatus struct {
	Terminal bool
	Outcome  string
	Context  any
	Result   json.RawMessage
}
type Engine struct {
	Store    *Store
	Executor Executor
	locks    [256]sync.Mutex
}

func terminal(state string) bool {
	return state == "completed" || state == "partial" || state == "failed" || state == "canceled"
}
func latestAttempts(r Run, node string) []Attempt {
	index := map[string]int{}
	out := []Attempt{}
	for _, a := range r.Attempts {
		if a.NodeID != node || a.Invalidated {
			continue
		}
		key := ""
		if a.Item != nil {
			key = a.Item.ID
		}
		if i, ok := index[key]; ok {
			out[i] = a
		} else {
			index[key] = len(out)
			out = append(out, a)
		}
	}
	return out
}
func nodeStatus(r Run, id string) (done, success bool) {
	as := latestAttempts(r, id)
	if len(as) == 0 {
		return false, false
	}
	success = true
	for _, a := range as {
		if a.State == "pending" || a.State == "submitted" || a.State == "review" || a.State == "unknown" {
			return false, false
		}
		if a.State != "completed" && !(a.State == "skipped" && (a.Error == "condition_not_met" || a.Error == "condition_branch")) {
			success = false
		}
	}
	return true, success
}
func findNode(r Run, id string) (Node, bool) {
	for _, n := range r.Definition.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return Node{}, false
}
func (s *Store) SubmitResult(ctx context.Context, o Owner, id, attempt string, data json.RawMessage) (Run, error) {
	if !json.Valid(data) || len(data) > 65536 {
		return Run{}, ErrInvalid
	}
	return s.UpdateRun(ctx, o, id, func(r *Run) error {
		for i := range r.Attempts {
			a := &r.Attempts[i]
			if a.ID != attempt {
				continue
			}
			node, ok := findNode(*r, a.NodeID)
			if !ok {
				return ErrNotFound
			}
			if err := ValidateOutput(node.OutputSchema, data); err != nil {
				return err
			}
			if len(a.Result) > 0 {
				if string(a.Result) == string(data) {
					return nil
				}
				return ErrConflict
			}
			if a.State != "submitted" {
				return ErrConflict
			}
			a.Result = append(json.RawMessage(nil), data...)
			return nil
		}
		return ErrNotFound
	})
}
func (e *Engine) Step(ctx context.Context, o Owner, id string) error {
	// Fixed stripes bound memory while preserving mutual exclusion for a run.
	key := sha256.Sum256([]byte(id))
	mu := &e.locks[key[0]]
	mu.Lock()
	defer mu.Unlock()

	r, err := e.Store.Run(ctx, o, id)
	if err != nil || terminal(r.Status) {
		return err
	}
	authorized := e.Executor.Authorize(ctx, o, r) == nil
	if !authorized {
		r.Status = "blocked"
	}
	if time.Now().After(r.DeadlineAt) {
		r.CancelRequested = true
	}
	if !authorized || r.CancelRequested {
		_, err = e.Store.UpdateRun(ctx, o, id, func(current *Run) error {
			current.CancelRequested = current.CancelRequested || r.CancelRequested
			if !authorized {
				current.Status = "blocked"
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	r, err = e.Store.Run(ctx, o, id)
	if err != nil {
		return err
	}
	for _, a := range r.Attempts {
		if a.Invalidated {
			continue
		}
		if a.State != "submitted" && a.State != "unknown" {
			continue
		}
		n, _ := findNode(r, a.NodeID)
		if n.Kind != "agent" && n.Kind != "parallel" && n.Kind != "tool" {
			if r.CancelRequested {
				_, err = e.Store.UpdateRun(ctx, o, id, func(current *Run) error {
					for i := range current.Attempts {
						item := &current.Attempts[i]
						if item.ID == a.ID && !item.Invalidated && (item.State == "submitted" || item.State == "unknown") {
							item.State = "canceled"
							item.FinishedAt = time.Now().UTC()
						}
					}
					return nil
				})
				if err != nil {
					return err
				}
				continue
			}
			if authorized && !r.CancelRequested {
				if err := e.executeLocal(ctx, o, r, a, n); err != nil {
					return err
				}
			}
			continue
		}
		if r.CancelRequested || !authorized {
			_ = e.Executor.Cancel(ctx, o, a)
		}
		status, readErr := e.Executor.Inspect(ctx, o, r, a)
		if readErr != nil {
			continue
		}
		if !status.Terminal {
			continue
		}
		_, err = e.Store.UpdateRun(ctx, o, id, func(current *Run) error {
			for i := range current.Attempts {
				item := &current.Attempts[i]
				if item.ID != a.ID {
					continue
				}
				if status.Outcome == "not_started" {
					item.State = "pending"
					item.Error = ""
					return nil
				}
				if len(status.Result) > 0 {
					node, _ := findNode(*current, item.NodeID)
					if err := ValidateOutput(node.OutputSchema, status.Result); err != nil {
						item.State = "failed"
						item.Error = "invalid_result"
						return nil
					}
					item.Result = status.Result
				}
				item.FinishedAt = time.Now().UTC()
				for _, c := range current.Contributions {
					if c.Kind == "requirement" && c.Revision > item.ContextRevision {
						item.State = "failed"
						item.Error = "requirements_changed"
						return nil
					}
				}
				if status.Outcome == "unknown" {
					item.State = "unknown"
					item.Error = "execution_outcome_unknown"
				} else if status.Outcome == "completed" && len(item.Result) > 0 {
					item.State = "completed"
					current.ContextRevision++
					current.Contributions = append(current.Contributions, Contribution{ID: stableID("result_", item.ID), Kind: "result", NodeID: item.NodeID, AttemptID: item.ID, Data: item.Result, Basis: item.ContextRevision, Revision: current.ContextRevision, CreatedAt: item.FinishedAt})
				} else {
					item.State = "failed"
					item.Error = status.Outcome
					if status.Outcome == "completed" {
						item.Error = "result_not_submitted"
					}
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	r, err = e.Store.Run(ctx, o, id)
	if err != nil {
		return err
	}
	if !authorized && !r.CancelRequested {
		return nil
	}
	if r.CancelRequested {
		pending := false
		for _, a := range r.Attempts {
			if a.State == "submitted" || a.State == "unknown" {
				pending = true
			}
		}
		_, err = e.Store.UpdateRun(ctx, o, id, func(r *Run) error {
			r.Status = "canceling"
			if !pending {
				r.Status = "canceled"
				r.FinishedAt = time.Now().UTC()
			}
			return nil
		})
		return err
	}
	active := 0
	for _, n := range r.Definition.Nodes {
		for _, a := range latestAttempts(r, n.ID) {
			if a.State == "submitted" || a.State == "unknown" {
				active++
			}
		}
	}
	for _, n := range r.Definition.Nodes {
		if active >= r.Definition.MaxConcurrent {
			break
		}
		if len(latestAttempts(r, n.ID)) > 0 {
			continue
		}
		ready, allowed := true, true
		branchSkipped := false
		for _, dep := range n.DependsOn {
			done, ok := nodeStatus(r, dep)
			if !done {
				ready = false
			}
			for _, a := range latestAttempts(r, dep) {
				branchSkipped = branchSkipped || (a.State == "skipped" && (a.Error == "condition_not_met" || a.Error == "condition_branch"))
			}
			if !ok {
				allowed = false
			}
		}
		if !ready {
			continue
		}
		if (branchSkipped && n.Kind != "join") || (!allowed && !acceptsPartial(r, n)) {
			reason := "dependency_incomplete"
			if branchSkipped {
				reason = "condition_branch"
			}
			_, err = e.Store.UpdateRun(ctx, o, id, func(r *Run) error {
				r.Attempts = append(r.Attempts, Attempt{ID: stableID("attempt_", r.ID, n.ID, "skip"), NodeID: n.ID, Number: 1, State: "skipped", Error: reason})
				return nil
			})
			if err != nil {
				return err
			}
			continue
		}
		items := []*Item{nil}
		if n.Kind == "parallel" {
			source := n.Items
			if n.ItemsFrom != "" {
				values := latestAttempts(r, n.ItemsFrom)
				if len(values) != 1 || json.Unmarshal(values[0].Result, &source) != nil {
					return e.failNode(ctx, o, r, n, "invalid_item_list")
				}
			}
			if len(source) == 0 || len(source) > 500 {
				return e.failNode(ctx, o, r, n, "empty_or_oversized_item_list")
			}
			seen := map[string]bool{}
			items = nil
			for _, item := range source {
				if !identityPattern.MatchString(item.ID) || seen[item.ID] {
					return e.failNode(ctx, o, r, n, "duplicate_item_identity")
				}
				seen[item.ID] = true
				copy := item
				items = append(items, &copy)
			}
		}
		_, err = e.Store.UpdateRun(ctx, o, id, func(r *Run) error {
			for _, item := range items {
				key := ""
				if item != nil {
					key = item.ID
				}
				number := 1
				for _, old := range r.Attempts {
					if old.NodeID == n.ID && old.ItemID() == key && old.Number >= number {
						number = old.Number + 1
					}
				}
				if number > 10 {
					return ErrInvalid
				}
				attemptID := stableID("attempt_", r.ID, n.ID, key, fmt.Sprint(number))
				r.Attempts = append(r.Attempts, Attempt{ID: attemptID, NodeID: n.ID, Item: item, Number: number, RequestID: attemptID, State: "pending", ContextRevision: r.ContextRevision})
			}
			r.Status = "running"
			return nil
		})
		if err != nil {
			return err
		}
	}
	r, err = e.Store.Run(ctx, o, id)
	if err != nil {
		return err
	}
	for _, n := range r.Definition.Nodes {
		perNode := 0
		for _, a := range latestAttempts(r, n.ID) {
			if a.State == "submitted" || a.State == "unknown" {
				perNode++
			}
		}
		for _, a := range latestAttempts(r, n.ID) {
			if a.State != "pending" {
				continue
			}
			ready, allowed := true, true
			for _, dep := range n.DependsOn {
				done, success := nodeStatus(r, dep)
				ready = ready && done
				allowed = allowed && success
			}
			if !ready {
				continue
			}
			if !allowed && !acceptsPartial(r, n) {
				_, err = e.Store.UpdateRun(ctx, o, id, func(current *Run) error {
					for i := range current.Attempts {
						if current.Attempts[i].ID == a.ID {
							current.Attempts[i].State = "skipped"
							current.Attempts[i].Error = "dependency_incomplete"
						}
					}
					return nil
				})
				if err != nil {
					return err
				}
				continue
			}
			if a.State != "pending" || active >= r.Definition.MaxConcurrent {
				continue
			}
			if n.Kind == "parallel" && perNode >= n.Concurrency {
				continue
			}
			r, err = e.Store.Run(ctx, o, id)
			if err != nil {
				return err
			}
			admissionStopped := errors.New("run no longer admits work")
			r, err = e.Store.UpdateRun(ctx, o, id, func(current *Run) error {
				// This retained transition is the admission boundary. A cancellation
				// received during an earlier node must stop the remaining batch.
				if current.CancelRequested || time.Now().After(current.DeadlineAt) {
					return admissionStopped
				}
				inputsAllowed := true
				for _, dependency := range n.DependsOn {
					done, success := nodeStatus(*current, dependency)
					if !done {
						return admissionStopped
					}
					inputsAllowed = inputsAllowed && success
				}
				if !inputsAllowed && !acceptsPartial(*current, n) {
					return admissionStopped
				}
				for i := range current.Attempts {
					item := &current.Attempts[i]
					if item.ID == a.ID && !item.Invalidated && item.State == "pending" {
						item.ContextRevision = current.ContextRevision
						item.StartedAt = time.Now().UTC()
						item.State = "submitted"
						a = *item
						return nil
					}
				}
				return ErrConflict
			})
			if errors.Is(err, admissionStopped) {
				return nil
			}
			if err != nil {
				return err
			}
			if n.Kind == "agent" || n.Kind == "parallel" {
				thread, startErr := e.Executor.Start(ctx, o, r, a)
				_, err = e.Store.UpdateRun(ctx, o, id, func(r *Run) error {
					for i := range r.Attempts {
						if r.Attempts[i].ID == a.ID {
							r.Attempts[i].ThreadID = thread
							if startErr != nil {
								r.Attempts[i].State = "unknown"
								r.Attempts[i].Error = "admission_unconfirmed"
							}
						}
					}
					return nil
				})
				active++
				perNode++
			} else {
				err = e.executeLocal(ctx, o, r, a, n)
			}
			if err != nil {
				return err
			}
		}
	}
	r, err = e.Store.Run(ctx, o, id)
	if err != nil {
		return err
	}
	all, complete, review := true, true, false
	for _, n := range r.Definition.Nodes {
		done, ok := nodeStatus(r, n.ID)
		all = all && done
		complete = complete && ok
		for _, a := range latestAttempts(r, n.ID) {
			review = review || a.State == "review"
		}
	}
	if all {
		_, err = e.Store.UpdateRun(ctx, o, id, func(r *Run) error {
			r.Status = "completed"
			if !complete {
				r.Status = "failed"
				if r.Definition.AllowPartial {
					r.Status = "partial"
				}
			}
			r.FinishedAt = time.Now().UTC()
			return nil
		})
	} else if review {
		_, err = e.Store.UpdateRun(ctx, o, id, func(r *Run) error { r.Status = "review"; return nil })
	}
	return err
}
func (e *Engine) failNode(ctx context.Context, o Owner, r Run, n Node, reason string) error {
	_, err := e.Store.UpdateRun(ctx, o, r.ID, func(r *Run) error {
		r.Attempts = append(r.Attempts, Attempt{ID: stableID("attempt_", r.ID, n.ID, "failed"), NodeID: n.ID, Number: 1, State: "failed", Error: reason})
		return nil
	})
	return err
}
func (e *Engine) executeLocal(ctx context.Context, o Owner, r Run, a Attempt, n Node) error {
	inputs := map[string]any{}
	for _, dep := range n.DependsOn {
		values := []any{}
		for _, item := range latestAttempts(r, dep) {
			if item.State == "completed" && len(item.Result) > 0 {
				var v any
				_ = json.Unmarshal(item.Result, &v)
				values = append(values, v)
			}
		}
		inputs[dep] = values
	}
	var result json.RawMessage
	var artifact *Artifact
	state := "completed"
	reason := ""
	switch n.Kind {
	case "join":
		coverage := map[string]int{"total": 0, "completed": 0, "failed": 0, "skipped": 0, "unknown": 0}
		gaps := []map[string]string{}
		for _, dep := range n.DependsOn {
			for _, item := range latestAttempts(r, dep) {
				coverage["total"]++
				coverage[item.State]++
				if item.State != "completed" {
					gaps = append(gaps, map[string]string{"node_id": dep, "item_id": item.ItemID(), "state": item.State, "reason": item.Error})
				}
			}
		}
		result = json.RawMessage(jsonText(map[string]any{"results": inputs, "coverage": coverage, "gaps": gaps, "complete": coverage["completed"] == coverage["total"]}))
	case "condition":
		values := latestAttempts(r, n.Condition.NodeID)
		var source any
		if len(values) == 1 {
			_ = json.Unmarshal(values[0].Result, &source)
		}
		for _, part := range strings.Split(n.Condition.Field, ".") {
			m, ok := source.(map[string]any)
			if !ok {
				source = nil
				break
			}
			source = m[part]
		}
		var expected any
		_ = json.Unmarshal(n.Condition.Equals, &expected)
		if jsonText(source) != jsonText(expected) {
			state = "skipped"
			reason = "condition_not_met"
		}
		result = json.RawMessage(jsonText(map[string]any{"matched": state == "completed"}))
	case "render":
		t, err := template.New("report").Option("missingkey=error").Parse(n.Template)
		output := boundedBuffer{limit: 2 << 20}
		if err == nil {
			err = t.Execute(&output, map[string]any{"Title": r.Definition.Title, "Run": r.ID, "ScheduledAt": r.ScheduledAt, "Inputs": inputs, "Context": r.Contributions})
		}
		if err != nil || output.Len() > 2<<20 {
			state = "failed"
			reason = "template_invalid"
		} else {
			digest := sha256.Sum256(output.Bytes())
			artifact = &Artifact{ID: stableID("artifact_", r.ID, a.ID), NodeID: n.ID, MediaType: "text/html", Content: output.String(), Digest: hex.EncodeToString(digest[:]), ContextRevision: r.ContextRevision, CreatedAt: time.Now().UTC()}
			result = json.RawMessage(jsonText(map[string]any{"artifact_id": artifact.ID, "sha256": artifact.Digest}))
		}
	case "deliver":
		artifacts := []string{}
		for _, dep := range n.DependsOn {
			for _, item := range r.Artifacts {
				if item.NodeID == dep && !item.Invalidated {
					artifacts = append(artifacts, item.ID)
				}
			}
		}
		if len(artifacts) == 0 {
			state = "failed"
			reason = "artifact_required"
			break
		}
		result = json.RawMessage(jsonText(map[string]any{"saved": !n.RequireReview, "artifact_ids": artifacts, "external_delivery": false}))
		if n.RequireReview {
			state = "review"
		}
	case "tool":
		var err error
		result, err = e.Executor.Tool(ctx, o, r, a, n)
		if err != nil {
			state = "unknown"
			reason = "tool_outcome_unconfirmed"
			var failure *ToolFailure
			if errors.As(err, &failure) && failure.ConfirmedReadOnly {
				state = "failed"
				reason = "tool_read_failed"
			}
		}
	default:
		state = "failed"
		reason = "unsupported_node"
	}
	if state == "completed" {
		if err := ValidateOutput(n.OutputSchema, result); err != nil {
			state = "failed"
			reason = "invalid_result"
			artifact = nil
		}
	}
	_, err := e.Store.UpdateRun(ctx, o, r.ID, func(r *Run) error {
		var current *Attempt
		for i := range r.Attempts {
			if r.Attempts[i].ID == a.ID {
				current = &r.Attempts[i]
				break
			}
		}
		if current == nil || current.Invalidated || current.State != "submitted" {
			return ErrConflict
		}
		for _, c := range r.Contributions {
			if c.Kind == "requirement" && c.Revision > a.ContextRevision {
				state, reason, artifact, result = "failed", "requirements_changed", nil, nil
				break
			}
		}
		for i := range r.Attempts {
			if r.Attempts[i].ID == a.ID {
				r.Attempts[i].State = state
				r.Attempts[i].Error = reason
				r.Attempts[i].Result = result
				r.Attempts[i].FinishedAt = time.Now().UTC()
			}
		}
		if artifact != nil {
			r.Artifacts = append(r.Artifacts, *artifact)
		}
		if state == "completed" {
			r.ContextRevision++
			r.Contributions = append(r.Contributions, Contribution{ID: stableID("result_", a.ID), Kind: "result", NodeID: n.ID, AttemptID: a.ID, Data: result, Basis: a.ContextRevision, Revision: r.ContextRevision, CreatedAt: time.Now().UTC()})
		}
		return nil
	})
	return err
}

// boundedBuffer aborts template expansion before allocating an oversized artifact.
type boundedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		return 0, ErrInvalid
	}
	return b.Buffer.Write(p)
}
func (s *Store) Approve(ctx context.Context, o Owner, id, attempt string) (Run, error) {
	return s.UpdateRun(ctx, o, id, func(r *Run) error {
		g, err := s.GrantVersion(ctx, o, r.WorkflowID, r.DefinitionVersion)
		if err != nil || !g.Enabled || g.Revision != r.DefinitionVersion || !g.ExpiresAt.After(time.Now()) {
			return ErrUnauthorized
		}
		if r.CancelRequested {
			return ErrConflict
		}
		for i := range r.Attempts {
			a := &r.Attempts[i]
			if a.ID != attempt || a.State != "review" || a.Invalidated {
				continue
			}
			for _, c := range r.Contributions {
				if c.Kind == "requirement" && c.Revision > a.ContextRevision {
					return ErrConflict
				}
			}
			a.State = "completed"
			var receipt map[string]any
			if json.Unmarshal(a.Result, &receipt) != nil {
				return ErrInvalid
			}
			receipt["saved"] = true
			receipt["reviewed"] = true
			a.Result = json.RawMessage(jsonText(receipt))
			a.FinishedAt = time.Now().UTC()
			r.ContextRevision++
			r.Contributions = append(r.Contributions, Contribution{ID: stableID("result_", a.ID), Kind: "result", NodeID: a.NodeID, AttemptID: a.ID, Data: a.Result, Basis: a.ContextRevision, Revision: r.ContextRevision, CreatedAt: a.FinishedAt})
			r.Status = "running"
			return nil
		}
		return ErrConflict
	})
}

// Retry preserves successful items whose inputs are unchanged. Descendants are
// invalidated and expanded again only after their new dependencies settle.
func (s *Store) Retry(ctx context.Context, o Owner, id string) (Run, error) {
	return s.UpdateRun(ctx, o, id, func(r *Run) error {
		if !terminal(r.Status) || r.CancelRequested {
			return ErrConflict
		}
		affected := map[string]bool{}
		downstream := map[string]bool{}
		for _, n := range r.Definition.Nodes {
			for _, a := range latestAttempts(*r, n.ID) {
				if a.State == "unknown" {
					return ErrUnknown
				}
				if a.State == "failed" || a.State == "skipped" && a.Error == "dependency_incomplete" {
					affected[n.ID] = true
				}
			}
		}
		if len(affected) == 0 {
			return ErrConflict
		}
		for changed := true; changed; {
			changed = false
			for _, n := range r.Definition.Nodes {
				for _, dep := range n.DependsOn {
					if affected[dep] {
						downstream[n.ID] = true
						if !affected[n.ID] {
							affected[n.ID] = true
							changed = true
						}
					}
				}
			}
		}
		invalid := map[string]bool{}
		added := []Attempt{}
		for _, n := range r.Definition.Nodes {
			if !affected[n.ID] {
				continue
			}
			for _, a := range latestAttempts(*r, n.ID) {
				if !downstream[n.ID] && a.State == "completed" {
					continue
				}
				if a.Number >= 10 {
					return ErrInvalid
				}
				invalid[a.ID] = true
				if downstream[n.ID] {
					continue
				}
				a.Number++
				a.ID = stableID("attempt_", r.ID, n.ID, a.ItemID(), fmt.Sprint(a.Number))
				a.RequestID = a.ID
				a.State = "pending"
				a.ThreadID = ""
				a.Result = nil
				a.Error = ""
				a.StartedAt = time.Time{}
				a.FinishedAt = time.Time{}
				a.Invalidated = false
				added = append(added, a)
			}
		}
		for i := range r.Attempts {
			if invalid[r.Attempts[i].ID] {
				r.Attempts[i].Invalidated = true
			}
		}
		for i := range r.Contributions {
			if invalid[r.Contributions[i].AttemptID] {
				r.Contributions[i].Invalidated = true
			}
		}
		for i := range r.Artifacts {
			if affected[r.Artifacts[i].NodeID] {
				r.Artifacts[i].Invalidated = true
			}
		}
		r.Attempts = append(r.Attempts, added...)
		r.Status = "running"
		r.FinishedAt = time.Time{}
		r.DeadlineAt = time.Now().UTC().Add(time.Duration(r.Definition.TimeoutSeconds) * time.Second)
		r.ContextRevision++
		return nil
	})
}
func (a Attempt) ItemID() string {
	if a.Item != nil {
		return a.Item.ID
	}
	return ""
}

func acceptsPartial(r Run, n Node) bool {
	if n.Kind != "join" || n.JoinPolicy != "partial" || !r.Definition.AllowPartial {
		return false
	}
	count := 0
	for _, dep := range n.DependsOn {
		for _, a := range latestAttempts(r, dep) {
			if a.State == "completed" {
				count++
			}
		}
	}
	minimum := n.MinimumSuccess
	if minimum < 1 {
		minimum = 1
	}
	return count >= minimum
}
