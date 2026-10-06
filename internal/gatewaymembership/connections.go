package gatewaymembership

import (
	"context"
	"sync"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/gatewayflow"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

type memberConnection struct {
	session    flowersec.Session
	version    int64
	generation uint64
	cancel     context.CancelFunc
}

// Connections owns only live network observations. All authority is supplied
// from the durable member store's ordered commit callback.
type Connections struct {
	mu        sync.Mutex
	members   map[string]MemberRecord
	connected map[string]*memberConnection
	budget    *gatewayflow.Budget
	closed    bool
}

func NewConnections(budget *gatewayflow.Budget) *Connections {
	return &Connections{members: make(map[string]MemberRecord), connected: make(map[string]*memberConnection), budget: budget}
}

// Apply is called under the Store commit lock. It never calls back into Store,
// and cancellation does not wait for workers that may still need Store.
func (c *Connections) Apply(records []MemberRecord, policy gp.GatewayPolicy) {
	c.mu.Lock()
	defer c.mu.Unlock()
	next := make(map[string]MemberRecord, len(records))
	for _, record := range records {
		next[record.Member.MemberID] = record
	}
	for id, previous := range c.members {
		record, exists := next[id]
		if !exists || record.Member.State != "active" || record.Member.MemberVersion != previous.Member.MemberVersion {
			if connected := c.connected[id]; connected != nil {
				connected.cancel()
			}
			c.budget.Cancel(id, uint64(previous.Member.MemberVersion), "")
		} else if !EffectiveCloudAllowed(record, policy) {
			c.budget.Cancel(id, uint64(record.Member.MemberVersion), gatewayflow.Cloud)
		}
	}
	c.members = next
}

func (c *Connections) ServeMember(ctx context.Context, admission Admission, session flowersec.Session) error {
	if session == nil || admission.DesktopKeyID != "" {
		return ErrDenied
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	current := &memberConnection{session: session, version: admission.MemberVersion, generation: admission.Generation, cancel: cancel}
	c.mu.Lock()
	member, ok := c.members[admission.MemberID]
	if c.closed || !ok || member.Member.State != "active" || member.Member.MemberVersion != admission.MemberVersion || member.ConnectionGeneration != admission.Generation {
		c.mu.Unlock()
		return ErrDenied
	}
	previous := c.connected[admission.MemberID]
	c.connected[admission.MemberID] = current
	c.mu.Unlock()
	if previous != nil {
		previous.cancel()
	}
	defer func() {
		c.mu.Lock()
		if c.connected[admission.MemberID] == current {
			delete(c.connected, admission.MemberID)
		}
		c.mu.Unlock()
	}()
	_, err := session.WaitTermination(ctx)
	return err
}

// OpenReverse never dials a Runtime address. The reservation includes time
// waiting for stream admission, and remains charged until the caller releases it.
func (c *Connections) OpenReverse(ctx context.Context, memberID string, version int64) (_ flowersec.ByteStream, _ *gatewayflow.Reservation, _ context.CancelFunc, resultErr error) {
	start := time.Now()
	defer func() { gatewayflow.Observe(ctx, "access.open", start, resultErr) }()
	ctx, cancel := context.WithCancel(ctx)
	c.mu.Lock()
	member, ok := c.members[memberID]
	connection := c.connected[memberID]
	if c.closed || !ok || member.Member.State != "active" || member.Member.MemberVersion != version || connection == nil || connection.version != version {
		c.mu.Unlock()
		cancel()
		return nil, nil, nil, ErrDenied
	}
	reservation, err := c.budget.Reserve(memberID, uint64(version), gatewayflow.LAN, cancel)
	c.mu.Unlock()
	if err != nil {
		cancel()
		return nil, nil, nil, err
	}
	stream, err := connection.session.OpenStream(ctx, gp.MemberConnectionStream, flowersec.EmptyStreamMetadata())
	if err != nil {
		reservation.Release()
		cancel()
		return nil, nil, nil, err
	}
	stop := context.AfterFunc(ctx, func() { _ = stream.Close() })
	return stream, reservation, func() { stop(); cancel() }, nil
}

func (c *Connections) IsActive(memberID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.closed && c.members[memberID].Member.State == "active"
}

func (c *Connections) IsConnected(memberID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	connection := c.connected[memberID]
	member := c.members[memberID]
	return !c.closed && connection != nil && member.Member.State == "active" && member.Member.MemberVersion == connection.version
}

func (c *Connections) Close() {
	c.mu.Lock()
	c.closed = true
	for _, connection := range c.connected {
		connection.cancel()
	}
	c.mu.Unlock()
	c.budget.Close()
}
