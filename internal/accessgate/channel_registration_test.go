package accessgate

import (
	"context"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestChannelRegistrationInheritsLoginDeadlineAndRevocation(t *testing.T) {
	for _, reason := range []string{"logout", "expiry"} {
		t.Run(reason, func(t *testing.T) {
			g := New(Options{Password: "secret"})
			login, err := g.MintLocalSession("secret")
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(time.Hour)
			if reason == "expiry" {
				deadline = time.Now().Add(200 * time.Millisecond)
			}
			g.mu.Lock()
			g.localSessions[login.SessionToken].expiresAt = deadline
			g.mu.Unlock()
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			g.RegisterChannelWithOptions(session.Meta{ChannelID: "browser"}, RegisterChannelOptions{AccessSessionID: login.AccessSessionID, Cancel: cancel})
			defer g.UnregisterChannel("browser")
			if !g.IsChannelUnlocked("browser") {
				t.Fatal("valid login was rejected")
			}
			g.mu.Lock()
			inherited := g.channels["browser"].expiresAt
			g.mu.Unlock()
			if !inherited.Equal(deadline) {
				t.Fatalf("deadline = %v, want %v", inherited, deadline)
			}
			if reason == "logout" {
				g.RevokeLocalSession(login.SessionToken)
			}
			select {
			case <-ctx.Done():
			case <-time.After(3 * time.Second):
				t.Fatal("registered lifetime missed revocation")
			}
			if g.IsChannelUnlocked("browser") {
				t.Fatal("revoked channel retained access")
			}
			g.RegisterChannelWithOptions(session.Meta{ChannelID: "late"}, RegisterChannelOptions{AccessSessionID: login.AccessSessionID})
			defer g.UnregisterChannel("late")
			if g.IsChannelUnlocked("late") {
				t.Fatal("revoked login authorized a later channel")
			}
		})
	}
}

func TestChannelRegistrationKeepsRemoteAuthenticationChannelAlive(t *testing.T) {
	g, _ := persistentTestGate(t)
	_, codes := enableTestMFA(t, g)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	g.RegisterChannelWithOptions(session.Meta{ChannelID: "remote"}, RegisterChannelOptions{Cancel: cancel})
	defer g.UnregisterChannel("remote")
	if ctx.Err() != nil || g.IsChannelUnlocked("remote") {
		t.Fatal("pending channel must stay connected without business access")
	}
	first, err := g.AuthenticateChannel("remote", AuthenticationRequest{Password: "environment password"}, "peer")
	if err != nil {
		t.Fatal(err)
	}
	if !first.SecondFactorRequired || first.Unlocked || g.IsChannelUnlocked("remote") || ctx.Err() != nil {
		t.Fatal("password-only challenge must remain authentication-only")
	}
	result, err := g.AuthenticateChannel("remote", AuthenticationRequest{ChallengeID: first.ChallengeID, RecoveryCode: codes[0]}, "peer")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Unlocked || !g.IsChannelUnlocked("remote") || ctx.Err() != nil {
		t.Fatal("completed MFA did not authorize the live channel")
	}
	g.authMu.Lock()
	g.revokeOrdinaryLocked()
	g.authMu.Unlock()
	if ctx.Err() == nil || g.IsChannelUnlocked("remote") {
		t.Fatal("authenticated remote channel missed revocation")
	}
}

func TestChannelRegistrationAcrossAuthenticationEnable(t *testing.T) {
	g, err := OpenPersistent(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = g.Close() })
	ordinary, cancelOrdinary := context.WithCancel(t.Context())
	defer cancelOrdinary()
	trusted, cancelTrusted := context.WithCancel(t.Context())
	defer cancelTrusted()
	g.RegisterChannelWithOptions(session.Meta{ChannelID: "before"}, RegisterChannelOptions{AccessSessionID: "direct:before", Cancel: cancelOrdinary})
	g.RegisterChannelWithOptions(session.Meta{ChannelID: "host"}, RegisterChannelOptions{Trusted: true, Cancel: cancelTrusted})
	if !g.IsChannelUnlocked("before") || ordinary.Err() != nil {
		t.Fatal("unprotected browser must stay connected")
	}
	_, codes := enableTestMFA(t, g)
	if ordinary.Err() == nil || g.IsChannelUnlocked("before") {
		t.Fatal("enabling authentication failed to revoke existing unprotected channel")
	}
	if trusted.Err() != nil || !g.IsChannelUnlocked("host") {
		t.Fatal("policy change revoked private host authority")
	}
	for _, lineage := range []string{"", "direct:before", "direct:late", "unknown-login"} {
		g.RegisterChannelWithOptions(session.Meta{ChannelID: "late"}, RegisterChannelOptions{AccessSessionID: lineage})
		if g.IsChannelUnlocked("late") {
			t.Fatalf("old or missing login %q bypassed current authentication", lineage)
		}
		if st := g.channels["late"]; !st.expiresAt.IsZero() || st.expiryTimer != nil {
			t.Fatal("registration synthesized an authorization deadline")
		}
		g.UnregisterChannel("late")
	}
	challenge := loginChallenge(t, g, "after")
	login, err := g.AuthenticateLocal(AuthenticationRequest{ChallengeID: challenge, RecoveryCode: codes[0]}, "peer", "after")
	if err != nil {
		t.Fatal(err)
	}
	g.RegisterChannelWithOptions(session.Meta{ChannelID: "after"}, RegisterChannelOptions{AccessSessionID: login.AccessSessionID})
	if !g.IsChannelUnlocked("after") {
		t.Fatal("current-policy login was rejected")
	}
}
