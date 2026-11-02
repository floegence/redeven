package gatewayegress

import (
	"net/http"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// Controller derives network admission solely from committed local device and
// egress policy. It has no Cloud identity, credentials, namespace or callbacks.
type Controller struct {
	mu       sync.Mutex
	server   *Server
	timer    *time.Timer
	closed   bool
	revision uint64
}

func NewController(budget *gatewayflow.Budget) (*Controller, error) {
	return NewControllerWithOptions(Options{Budget: budget})
}

func NewControllerWithOptions(options Options) (*Controller, error) {
	server, err := New(options)
	if err != nil {
		return nil, err
	}
	return &Controller{server: server}, nil
}

func (c *Controller) Apply(records []gatewaymembership.MemberRecord, policy gp.GatewayPolicy) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	records = append([]gatewaymembership.MemberRecord(nil), records...)
	policy.Destinations = append([]string(nil), policy.Destinations...)
	c.revision++
	c.applyLocked(records, policy, c.revision)
}

func (c *Controller) applyLocked(records []gatewaymembership.MemberRecord, policy gp.GatewayPolicy, revision uint64) {
	now := time.Now().UnixMilli()
	deadline := int64(0)
	admitted := []Member{}
	for _, record := range records {
		if record.ClientExpiresAtUnixMS <= now || len(policy.Destinations) == 0 || !gatewaymembership.EffectiveEgressAllowed(record, policy) {
			continue
		}
		member := record.Member
		admitted = append(admitted, Member{ID: member.AttachmentID, AttachmentVersion: uint64(member.AttachmentVersion), Generation: uint64(member.AttachmentVersion), CertificateSHA256: record.ClientCertificateSHA256, AdmissionExpiresAtUnixMS: record.ClientExpiresAtUnixMS, Destinations: append([]string{}, policy.Destinations...)})
		if deadline == 0 || record.ClientExpiresAtUnixMS < deadline {
			deadline = record.ClientExpiresAtUnixMS
		}
	}
	if err := c.server.ReplaceMembers(admitted); err != nil {
		_ = c.server.ReplaceMembers(nil)
		return
	}
	if deadline > now {
		c.timer = time.AfterFunc(time.Until(time.UnixMilli(deadline)), func() {
			c.mu.Lock()
			defer c.mu.Unlock()
			if !c.closed && c.revision == revision {
				c.applyLocked(records, policy, revision)
			}
		})
	}
}

func (c *Controller) ServeHTTP(w http.ResponseWriter, r *http.Request) { c.server.ServeHTTP(w, r) }
func (c *Controller) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	if c.timer != nil {
		c.timer.Stop()
	}
	return c.server.Close()
}
