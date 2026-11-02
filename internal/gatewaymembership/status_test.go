package gatewaymembership

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestAttachmentObservationSeparatesRelationFromConnection(t *testing.T) {
	for _, tc := range []struct {
		name              string
		running, observed bool
		state             flowersec.ConnectionState
		failure           error
		connection, phase string
		connected         int
	}{
		{name: "no observation", running: true, connection: "unknown", phase: "unknown"},
		{name: "stopped", state: flowersec.ConnectionConnected, observed: true, connection: "stopped", phase: "runtime_stopped"},
		{name: "connecting", running: true, observed: true, state: flowersec.ConnectionConnecting, connection: "connecting", phase: "connecting"},
		{name: "connected", running: true, observed: true, state: flowersec.ConnectionConnected, connection: "connected", phase: "joined", connected: 1},
		{name: "waiting", running: true, observed: true, state: flowersec.ConnectionWaiting, connection: "disconnected", phase: "disconnected"},
		{name: "closed", running: true, observed: true, state: flowersec.ConnectionClosed, connection: "disconnected", phase: "disconnected"},
		{name: "idle", running: true, observed: true, state: flowersec.ConnectionIdle, connection: "disconnected", phase: "disconnected"},
		{name: "failure", running: true, observed: true, state: flowersec.ConnectionFailed, failure: errors.New("network failure"), connection: "failed", phase: "connection_failed"},
		{name: "no error wording inference", running: true, observed: true, state: flowersec.ConnectionFailed, failure: errors.New("GATEWAY_DENIED"), connection: "failed", phase: "connection_failed"},
		{name: "denied", running: true, observed: true, state: flowersec.ConnectionFailed, failure: fmt.Errorf("wrapped: %w", ErrDenied), connection: "failed", phase: "reauthorization_required"},
		{name: "identity failed", running: true, observed: true, state: flowersec.ConnectionFailed, failure: ErrInvalidProof, connection: "failed", phase: "reauthorization_required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			connections := map[string]flowersec.ConnectionSnapshot{}
			if tc.observed {
				connections["gateway"] = flowersec.ConnectionSnapshot{State: tc.state, Failure: &flowersec.ConnectionFailure{Error: tc.failure}}
			}
			now := time.UnixMilli(1900000000000)
			result := ObserveAttachments([]*RuntimeConfig{{GatewayID: "gateway", AttachmentID: "attachment"}}, "attachment", tc.running, connections, now)
			item := result.Attachments[0]
			if item.AttachmentState != "joined" || item.ConnectionState != tc.connection || item.Phase != tc.phase || !item.RouteSelected || result.Counts != (AttachmentCounts{Total: 1, Joined: 1, Connected: tc.connected}) || result.ObservedAtUnixMS != now.UnixMilli() || result.RuntimeRunning != tc.running {
				t.Fatalf("unexpected observation: %+v %+v", result, item)
			}
		})
	}
}

func TestAttachmentCollectionHasNoAggregatePhase(t *testing.T) {
	members := []*RuntimeConfig{
		{GatewayID: "pending", AttachmentID: "pending", PendingJoin: &gp.MemberJoinRequest{}},
		{GatewayID: "removed", AttachmentID: "removed", Leaving: true},
		{GatewayID: "online", AttachmentID: "online"},
		{GatewayID: "offline", AttachmentID: "offline"},
	}
	connections := map[string]flowersec.ConnectionSnapshot{}
	for _, member := range members[:3] {
		connections[member.GatewayID] = flowersec.ConnectionSnapshot{State: flowersec.ConnectionConnected}
	}
	result := ObserveAttachments(members, "online", true, connections, time.Now())
	if result.Counts != (AttachmentCounts{Total: 4, Joined: 2, Joining: 1, Removing: 1, Connected: 1}) {
		t.Fatalf("bad counts: %+v", result.Counts)
	}
	if result.Attachments[0].Phase != "joining" || result.Attachments[1].Phase != "removal_pending" || result.Attachments[3].Phase != "unknown" {
		t.Fatal(result.Attachments)
	}
	raw, _ := json.Marshal(result)
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	if _, ok := wire["phase"]; ok {
		t.Fatal("aggregate phase returned")
	}
	if _, ok := wire["joined"]; ok {
		t.Fatal("aggregate joined returned")
	}
	empty, _ := json.Marshal(ObserveAttachments(nil, "", false, nil, time.Now()))
	if !bytes.Contains(empty, []byte("\"attachments\":[]")) {
		t.Fatalf("empty collection: %s", empty)
	}
}
