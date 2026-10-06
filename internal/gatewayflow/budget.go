// Package gatewayflow accounts for all Gateway business streams, including
// pending opens. LAN reverse access and Cloud CONNECT share the same budget.
package gatewayflow

import (
	"context"
	"errors"
	"sync"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

var ErrCapacity = errors.New("GATEWAY_CONNECTION_LIMIT")

type Kind string

const (
	LAN   Kind = "lan"
	Cloud Kind = "cloud"
)

type Budget struct {
	mu                 sync.Mutex
	active             map[*Reservation]struct{}
	perMember, total   int
	closed             bool
	accepted, rejected uint64
}

type Reservation struct {
	MemberID string
	Version  uint64
	Kind     Kind
	budget   *Budget
	cancel   context.CancelFunc
	once     sync.Once
}

func New(perMember, total int) *Budget {
	if perMember <= 0 {
		perMember = gp.MaxMemberConnections
	}
	if total <= 0 {
		total = gp.MaxGatewayConnections
	}
	return &Budget{active: make(map[*Reservation]struct{}), perMember: perMember, total: total}
}

// Reserve is called before opening a reverse stream or dialing a destination.
// Release must run only after both forwarding directions have stopped.
func (b *Budget) Reserve(memberID string, version uint64, kind Kind, cancel context.CancelFunc) (*Reservation, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed || memberID == "" || version == 0 || cancel == nil || (kind != LAN && kind != Cloud) {
		b.rejected++
		return nil, ErrCapacity
	}
	if len(b.active) >= b.total {
		b.rejected++
		return nil, ErrCapacity
	}
	count := 0
	for r := range b.active {
		if r.MemberID == memberID {
			count++
		}
	}
	if count >= b.perMember {
		b.rejected++
		return nil, ErrCapacity
	}
	r := &Reservation{MemberID: memberID, Version: version, Kind: kind, budget: b, cancel: cancel}
	b.active[r] = struct{}{}
	b.accepted++
	return r, nil
}

func (r *Reservation) Release() {
	if r == nil {
		return
	}
	r.once.Do(func() { r.budget.mu.Lock(); delete(r.budget.active, r); r.budget.mu.Unlock() })
}

// Cancel requests closure without reporting completion. Counts remain visible
// until forwarding workers release their reservations. An empty kind selects both.
func (b *Budget) Cancel(memberID string, through uint64, kind Kind) {
	b.mu.Lock()
	var cancellations []context.CancelFunc
	for r := range b.active {
		if r.MemberID == memberID && r.Version <= through && (kind == "" || r.Kind == kind) {
			cancellations = append(cancellations, r.cancel)
		}
	}
	b.mu.Unlock()
	for _, cancel := range cancellations {
		cancel()
	}
}

func (b *Budget) Count(memberID string, through uint64, kind Kind) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	count := 0
	for r := range b.active {
		if (memberID == "" || r.MemberID == memberID) && (through == 0 || r.Version <= through) && (kind == "" || r.Kind == kind) {
			count++
		}
	}
	return count
}

func (b *Budget) Close() {
	b.mu.Lock()
	b.closed = true
	var cancellations []context.CancelFunc
	for r := range b.active {
		cancellations = append(cancellations, r.cancel)
	}
	b.mu.Unlock()
	for _, cancel := range cancellations {
		cancel()
	}
}

// Statistics is a process-local snapshot. Active includes pending opens and
// cancellations until their forwarding workers release the reservation.
type Statistics struct {
	Active, LAN, Cloud, Limit int
	Accepted, Rejected        uint64
}

func (b *Budget) Statistics() Statistics {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := Statistics{Active: len(b.active), Limit: b.total, Accepted: b.accepted, Rejected: b.rejected}
	for r := range b.active {
		if r.Kind == LAN {
			out.LAN++
		} else {
			out.Cloud++
		}
	}
	return out
}
