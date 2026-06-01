package agent

import (
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestRuntimePresentationSessionsExposeConnectedSessionSummary(t *testing.T) {
	a := &Agent{
		sessions: map[string]*activeSession{
			"ch_code": {
				meta: session.Meta{
					ChannelID:       "ch_code",
					FloeApp:         FloeAppRedevenCode,
					CodeSpaceID:     "cs_demo",
					UserEmail:       "alice@example.test",
					CanRead:         true,
					CanWrite:        true,
					CanExecute:      true,
					CreatedAtUnixMs: 10,
				},
				tunnelURL:         "https://tunnel.example.test/ch_code",
				connectedAtUnixMs: 200,
			},
			"ch_pf": {
				meta: session.Meta{
					ChannelID:       "ch_pf",
					FloeApp:         FloeAppRedevenPortForward,
					CodeSpaceID:     "pf_demo",
					UserEmail:       "bob@example.test",
					CanExecute:      true,
					CreatedAtUnixMs: 20,
				},
				connectedAtUnixMs: 300,
			},
			"ch_pending": {
				meta: session.Meta{
					ChannelID: "ch_pending",
					FloeApp:   FloeAppRedevenAgent,
				},
			},
		},
	}

	sessions := a.RuntimePresentationSessions()
	if len(sessions) != 2 {
		t.Fatalf("RuntimePresentationSessions() len = %d, want 2", len(sessions))
	}
	if sessions[0].ChannelID != "ch_pf" || sessions[1].ChannelID != "ch_code" {
		t.Fatalf("sessions sorted by connected_at desc = %#v", sessions)
	}
	if sessions[1].TunnelURL != "https://tunnel.example.test/ch_code" || !sessions[1].CanWrite {
		t.Fatalf("code session summary = %#v", sessions[1])
	}

	snapshot := a.RuntimeServiceSnapshot()
	if snapshot.ActiveWorkload.SessionCount != 2 || snapshot.ActiveWorkload.PortForwardCount != 1 {
		t.Fatalf("ActiveWorkload = %#v, want 2 sessions and 1 port forward", snapshot.ActiveWorkload)
	}
	if !snapshot.Capabilities.RuntimeGateway.Supported || snapshot.Capabilities.RuntimeGateway.BindMethod == "" {
		t.Fatalf("RuntimeGateway capability = %#v, want supported runtime-control binding", snapshot.Capabilities.RuntimeGateway)
	}
}
