package automation

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/floegence/redevplugin/v3/pkg/schedule"
)

// Schedules adapts the published scheduler to immutable workflow publications.
// The scheduler owns cadence and claims; this store remains the run authority.
type Schedules struct {
	Store     *Store
	Plans     *schedule.Store
	Authorize func(context.Context, Owner, Run) error
}
type ScheduleInput struct {
	Revision   int64            `json:"revision"`
	Version    int64            `json:"version"`
	Enabled    bool             `json:"enabled"`
	Cadence    schedule.Cadence `json:"cadence"`
	Overlap    string           `json:"overlap"`
	Missed     string           `json:"missed"`
	QueueLimit int              `json:"queue_limit"`
}
type ScheduleView struct {
	ScheduleInput
	ID     string     `json:"id"`
	NextAt *time.Time `json:"next_at,omitempty"`
}
type schedulePayload struct {
	WorkflowID string `json:"workflow_id"`
	Version    int64  `json:"version"`
}

func scheduleOwner(o Owner) schedule.Owner {
	return schedule.Owner{Kind: "redeven.automation", Subject: o.User, Environment: o.Environment}
}
func scheduleError(err error) error {
	switch {
	case errors.Is(err, schedule.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, schedule.ErrConflict):
		return ErrConflict
	case errors.Is(err, schedule.ErrInvalid):
		return ErrInvalid
	}
	return err
}
func planView(p schedule.Plan) (ScheduleView, error) {
	var payload schedulePayload
	if json.Unmarshal(p.Payload, &payload) != nil || payload.WorkflowID != p.ID || payload.Version < 1 {
		return ScheduleView{}, ErrInvalid
	}
	v := ScheduleView{ID: p.ID, ScheduleInput: ScheduleInput{Revision: p.Revision, Version: payload.Version, Enabled: p.Enabled, Cadence: p.Cadence, Overlap: p.Overlap, Missed: p.Missed, QueueLimit: p.QueueLimit}}
	if !p.NextAt.IsZero() {
		next := p.NextAt
		v.NextAt = &next
	}
	return v, nil
}
func (s *Schedules) Get(ctx context.Context, o Owner, id string) (*ScheduleView, error) {
	if _, err := s.Store.Get(ctx, o, id); err != nil {
		return nil, err
	}
	p, err := s.Plans.Get(ctx, scheduleOwner(o), id)
	if errors.Is(err, schedule.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, scheduleError(err)
	}
	v, err := planView(p)
	return &v, err
}
func (s *Schedules) Save(ctx context.Context, o Owner, id string, input ScheduleInput) (ScheduleView, error) {
	w, err := s.Store.Get(ctx, o, id)
	if err != nil {
		return ScheduleView{}, err
	}
	if w.Archived || w.Plugin != nil {
		return ScheduleView{}, ErrConflict
	}
	p, err := s.Store.Publication(ctx, o, id, input.Version)
	if err != nil {
		return ScheduleView{}, err
	}
	if input.Enabled {
		r := Run{WorkflowID: id, DefinitionVersion: p.Version, Definition: p.Definition}
		if s.Authorize == nil {
			return ScheduleView{}, ErrUnauthorized
		}
		if err = s.Authorize(ctx, o, r); err != nil {
			return ScheduleView{}, err
		}
	}
	raw, _ := json.Marshal(schedulePayload{WorkflowID: id, Version: input.Version})
	plan, err := s.Plans.Put(ctx, schedule.Plan{ID: id, Owner: scheduleOwner(o), Enabled: input.Enabled, Cadence: input.Cadence, Overlap: input.Overlap, Missed: input.Missed, QueueLimit: input.QueueLimit, Payload: raw}, input.Revision, time.Now().UTC())
	if err != nil {
		return ScheduleView{}, scheduleError(err)
	}
	return planView(plan)
}
func (s *Schedules) Pause(ctx context.Context, o Owner, id string) error {
	p, err := s.Plans.Get(ctx, scheduleOwner(o), id)
	if errors.Is(err, schedule.ErrNotFound) {
		return nil
	}
	if err != nil {
		return scheduleError(err)
	}
	if !p.Enabled {
		return nil
	}
	p.Enabled = false
	_, err = s.Plans.Put(ctx, p, p.Revision, time.Now().UTC())
	return scheduleError(err)
}
func (s *Schedules) Claims(ctx context.Context, o Owner, id string) ([]schedule.Claim, error) {
	if _, err := s.Store.Get(ctx, o, id); err != nil {
		return nil, err
	}
	v, err := s.Plans.Claims(ctx, scheduleOwner(o), id)
	return v, scheduleError(err)
}
func (s *Schedules) claim(c schedule.Claim) (Owner, schedulePayload, error) {
	var p schedulePayload
	if c.Owner.Kind != "redeven.automation" || json.Unmarshal(c.Payload, &p) != nil || p.WorkflowID != c.PlanID || p.Version < 1 {
		return Owner{}, p, ErrInvalid
	}
	o := Owner{User: c.Owner.Subject, Environment: c.Owner.Environment}
	if !o.valid() {
		return o, p, ErrInvalid
	}
	return o, p, nil
}
func (s *Schedules) Submit(ctx context.Context, c schedule.Claim) (schedule.Receipt, error) {
	o, p, err := s.claim(c)
	if err != nil {
		return schedule.Receipt{}, err
	}
	// A retained admission takes precedence over a subsequently paused plan.
	if r, e := s.Store.RunForRequest(ctx, o, c.ID); e == nil {
		return scheduleReceipt(r), nil
	} else if !errors.Is(e, ErrNotFound) {
		return schedule.Receipt{}, e
	}
	w, err := s.Store.Get(ctx, o, p.WorkflowID)
	if err != nil {
		return schedule.Receipt{}, err
	}
	plan, err := s.Plans.Get(ctx, c.Owner, c.PlanID)
	if err != nil {
		return schedule.Receipt{}, err
	}
	if w.Archived || w.Plugin != nil || !plan.Enabled || plan.Revision != c.PlanRevision {
		return schedule.Receipt{Outcome: "not_committed"}, nil
	}
	pub, err := s.Store.Publication(ctx, o, p.WorkflowID, p.Version)
	if err != nil {
		return schedule.Receipt{}, err
	}
	if s.Authorize == nil {
		return schedule.Receipt{Outcome: "not_committed"}, nil
	}
	if err = s.Authorize(ctx, o, Run{WorkflowID: p.WorkflowID, DefinitionVersion: p.Version, Definition: pub.Definition}); err != nil {
		return schedule.Receipt{Outcome: "not_committed"}, nil
	}
	r, err := s.Store.CreateRun(ctx, o, p.WorkflowID, c.ID, p.Version, "live", c.ScheduledAt)
	if err != nil {
		return schedule.Receipt{}, err
	}
	return scheduleReceipt(r), nil
}
func (s *Schedules) Inspect(ctx context.Context, c schedule.Claim) (schedule.Receipt, error) {
	o, p, err := s.claim(c)
	if err != nil {
		return schedule.Receipt{}, err
	}
	r, err := s.Store.RunForRequest(ctx, o, c.ID)
	if errors.Is(err, ErrNotFound) {
		return schedule.Receipt{Outcome: "not_committed"}, nil
	}
	if err != nil {
		return schedule.Receipt{}, err
	}
	if r.WorkflowID != p.WorkflowID || r.DefinitionVersion != p.Version || !r.ScheduledAt.Equal(c.ScheduledAt) {
		return schedule.Receipt{}, ErrConflict
	}
	// Observation reads only the canonical admission/outcome. Revocation stops
	// further effects in Engine, but must not erase or hide an existing receipt.
	return scheduleReceipt(r), nil
}
func scheduleReceipt(r Run) schedule.Receipt {
	receipt := schedule.Receipt{Reference: r.ID}
	switch r.Status {
	case "completed":
		receipt.Outcome = "completed"
	case "failed", "partial":
		receipt.Outcome = "failed"
	case "canceled":
		receipt.Outcome = "canceled"
	}
	return receipt
}
func (s *Store) RunForRequest(ctx context.Context, o Owner, request string) (Run, error) {
	if !o.valid() || !identityPattern.MatchString(request) {
		return Run{}, ErrNotFound
	}
	return decodeRow[Run](s.db.QueryRowContext(ctx, "SELECT body FROM runs WHERE request_id=? AND owner_user=? AND owner_env=?", request, o.User, o.Environment))
}
