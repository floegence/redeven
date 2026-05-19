package runtimepresentation

import (
	"reflect"
	"sync"
)

type Sink interface {
	Start(snapshot Snapshot) error
	Emit(event Event) error
	Close(result Result) error
}

type Reporter struct {
	mu       sync.Mutex
	sinks    []Sink
	snapshot Snapshot
	closed   bool
}

func NewReporter(snapshot Snapshot, sinks ...Sink) *Reporter {
	return &Reporter{
		sinks:    append([]Sink(nil), sinks...),
		snapshot: snapshot,
	}
}

func (r *Reporter) Start() error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, sink := range r.sinks {
		if err := sink.Start(r.snapshot); err != nil {
			return err
		}
	}
	return nil
}

func (r *Reporter) UpdateSnapshot(update func(*Snapshot)) {
	if r == nil || update == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	update(&r.snapshot)
}

func (r *Reporter) Snapshot() Snapshot {
	if r == nil {
		return Snapshot{}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.snapshot
}

func (r *Reporter) Emit(event Event) error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	event = event.withTime()
	if !isZeroSnapshot(event.Snapshot) {
		r.snapshot = event.Snapshot
	} else {
		event.Snapshot = r.snapshot
	}
	for _, sink := range r.sinks {
		if err := sink.Emit(event); err != nil {
			return err
		}
	}
	return nil
}

func (r *Reporter) Close(result Result) error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	r.closed = true
	if isZeroSnapshot(result.Snapshot) {
		result.Snapshot = r.snapshot
	}
	for _, sink := range r.sinks {
		if err := sink.Close(result); err != nil {
			return err
		}
	}
	return nil
}

func isZeroSnapshot(s Snapshot) bool {
	return reflect.DeepEqual(s, Snapshot{})
}
