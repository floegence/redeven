package accessgate

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
	"github.com/pquerna/otp/totp"
)

func persistentTestGate(t *testing.T) (*Gate, string) {
	t.Helper()
	dir := t.TempDir()
	hash, err := HashPassword("environment password")
	if err != nil {
		t.Fatal(err)
	}
	if err = WritePasswordHash(dir, hash); err != nil {
		t.Fatal(err)
	}
	g, err := OpenPersistent(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = g.Close() })
	return g, dir
}
func enableTestMFA(t *testing.T, g *Gate) (string, []string) {
	t.Helper()
	setup, err := g.Manage("owner", "test", SecurityRequest{Action: "setup", Password: "environment password"})
	if err != nil {
		t.Fatal(err)
	}
	code, _ := totp.GenerateCode(setup.Secret, time.Now().Add(-30*time.Second))
	verified, err := g.Manage("owner", "test", SecurityRequest{Action: "verify", OperationID: setup.OperationID, Code: code})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = g.Manage("owner", "test", SecurityRequest{Action: "commit", OperationID: setup.OperationID, Saved: true}); err != nil {
		t.Fatal(err)
	}
	return setup.Secret, verified.RecoveryCodes
}
func loginChallenge(t *testing.T, g *Gate, binding string) string {
	t.Helper()
	r, err := g.AuthenticateLocal(AuthenticationRequest{Password: "environment password"}, "peer", binding)
	if err != nil {
		t.Fatal(err)
	}
	if r.Unlocked || r.SessionToken != "" || r.ResumeToken != "" || !r.SecondFactorRequired {
		t.Fatalf("password step issued business authority: %+v", r)
	}
	return r.ChallengeID
}
func TestPersistentAuthenticationReplayAndResponseLoss(t *testing.T) {
	g, dir := persistentTestGate(t)
	secret, codes := enableTestMFA(t, g)
	first := loginChallenge(t, g, "browser-a")
	second := loginChallenge(t, g, "browser-b")
	code, _ := totp.GenerateCode(secret, time.Now())
	requests := []struct{ id, binding string }{{first, "browser-a"}, {second, "browser-b"}}
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0
	var accepted *LocalSessionResult
	var request AuthenticationRequest
	var binding string
	for _, r := range requests {
		wg.Go(func() {
			out, err := g.AuthenticateLocal(AuthenticationRequest{ChallengeID: r.id, Code: code}, "peer", r.binding)
			if err == nil {
				mu.Lock()
				success++
				accepted = out
				request = AuthenticationRequest{ChallengeID: r.id, Code: code}
				binding = r.binding
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if success != 1 {
		t.Fatalf("successful concurrent consumers=%d", success)
	}
	retry, err := g.AuthenticateLocal(request, "peer", binding)
	if err != nil || retry.SessionToken != accepted.SessionToken {
		t.Fatalf("lost response retry: %v", err)
	}
	_ = g.Close()
	restored, err := OpenPersistent(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	challenge := loginChallenge(t, restored, "restart")
	if _, err = restored.AuthenticateLocal(AuthenticationRequest{ChallengeID: challenge, Code: code}, "different-ip", "restart"); !errors.Is(err, ErrSecondFactor) {
		t.Fatalf("replayed code after restart: %v", err)
	}
	out, err := restored.AuthenticateLocal(AuthenticationRequest{ChallengeID: challenge, RecoveryCode: codes[0]}, "peer", "restart")
	if err != nil || !out.Unlocked {
		t.Fatalf("recovery: %v", err)
	}
	if restored.SecurityStatus().RecoveryCodesRemaining != 7 {
		t.Fatal("recovery code not consumed")
	}
	challenge = loginChallenge(t, restored, "another")
	if _, err = restored.AuthenticateLocal(AuthenticationRequest{ChallengeID: challenge, RecoveryCode: codes[0]}, "peer", "another"); err == nil {
		t.Fatal("recovery code reused")
	}
}
func TestAuthenticationPolicyRevokesOrdinaryLineages(t *testing.T) {
	g, _ := persistentTestGate(t)
	ordinary, err := g.MintLocalSession("environment password")
	if err != nil {
		t.Fatal(err)
	}
	trustedCancelled := false
	g.RegisterChannelWithOptions(session.Meta{ChannelID: "trusted"}, RegisterChannelOptions{Unlocked: true, Trusted: true})
	g.BindChannelLifetime("trusted", func() { trustedCancelled = true })
	cancelled := false
	g.RegisterChannelWithOptions(session.Meta{ChannelID: "active"}, RegisterChannelOptions{Unlocked: true, AccessSessionID: ordinary.AccessSessionID})
	g.BindChannelLifetime("active", func() { cancelled = true })
	enableTestMFA(t, g)
	if g.IsLocalSessionValid(ordinary.SessionToken) || trustedCancelled || !g.IsChannelUnlocked("trusted") || !cancelled {
		t.Fatal("incorrect ordinary/trusted revocation boundary")
	}
	if _, err = g.MintLocalSession("environment password"); err != nil {
		t.Fatal(err)
	}
	if g.IsChannelUnlocked("active") {
		t.Fatal("revoked channel remains unlocked")
	}
}
func TestAuthenticationMigrationAndMissingStateFailClosed(t *testing.T) {
	g, dir := persistentTestGate(t)
	enableTestMFA(t, g)
	_ = g.Close()
	if _, err := os.Lstat(filepath.Join(dir, credentialFileName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("legacy verifier retained")
	}
	if err := os.Remove(filepath.Join(dir, authDatabaseName)); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenPersistent(dir); err == nil {
		t.Fatal("missing MFA database disabled authentication")
	}
}
func TestAuthenticationPendingSetupAndRecovery(t *testing.T) {
	g, _ := persistentTestGate(t)
	setup, err := g.Manage("owner", "env", SecurityRequest{Action: "setup", Password: "environment password"})
	if err != nil {
		t.Fatal(err)
	}
	if g.SecurityStatus().Enabled {
		t.Fatal("unconfirmed setup enabled MFA")
	}
	if _, err = g.Manage("other-owner", "env", SecurityRequest{Action: "verify", OperationID: setup.OperationID, Code: "123456"}); err == nil {
		t.Fatal("operation escaped owner binding")
	}
	enableTestMFA(t, g)
	if _, err = g.Manage("owner", "env", SecurityRequest{Action: "recover"}); err != nil {
		t.Fatal(err)
	}
	if _, err = g.MintLocalSession("environment password"); !errors.Is(err, ErrRecoveryPending) {
		t.Fatalf("recovery downgraded protection: %v", err)
	}
}
func TestAuthenticationThrottleSurvivesRestart(t *testing.T) {
	g, dir := persistentTestGate(t)
	enableTestMFA(t, g)
	for i := 0; i < 5; i++ {
		id := loginChallenge(t, g, "browser")
		_, _ = g.AuthenticateLocal(AuthenticationRequest{ChallengeID: id, Code: "invalid"}, "peer", "browser")
	}
	_ = g.Close()
	g, err := OpenPersistent(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()
	id := loginChallenge(t, g, "new-browser")
	if _, err = g.AuthenticateLocal(AuthenticationRequest{ChallengeID: id, Code: "invalid"}, "new-peer", "new-browser"); !IsRateLimited(err) {
		t.Fatalf("factor throttle reset: %v", err)
	}
}

func TestAuthenticationAdjacentCodeCollision(t *testing.T) {
	g, _ := persistentTestGate(t)
	// This fixed RFC-compatible key has code 010312 at both adjacent steps.
	state := g.auth
	state.Secret = "JBSWY3DPEHPK3PXP"
	state.CredentialID = "collision-fixture"
	if err := g.persistLocked(state); err != nil {
		t.Fatal(err)
	}
	at := time.Unix(60202684*30, 0)
	if err := g.verifyFactorLocked("010 312", "", at); err != nil {
		t.Fatal(err)
	}
	if err := g.verifyFactorLocked("010312", "", at.Add(30*time.Second)); !errors.Is(err, ErrSecondFactor) {
		t.Fatalf("adjacent collision reused: %v", err)
	}
}

func TestAuthenticationCodeSpaceDelegation(t *testing.T) {
	g, _ := persistentTestGate(t)
	parent := session.Meta{ChannelID: "parent", EndpointID: "environment", UserPublicID: "owner", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui", SessionKind: "envapp_rpc", CanRead: true, CanWrite: true, CanExecute: true}
	g.RegisterChannel(parent)
	login, err := g.UnlockChannel(parent.ChannelID, "environment password")
	if err != nil {
		t.Fatal(err)
	}
	token, err := g.DelegateCodeSpace(parent.ChannelID, "editor")
	if err != nil {
		t.Fatal(err)
	}
	child := parent
	child.ChannelID = "child"
	child.FloeApp = "com.floegence.redeven.code"
	child.CodeSpaceID = "wrong"
	child.SessionKind = "codeapp"
	g.RegisterChannel(child)
	if _, err = g.AuthenticateChannel(child.ChannelID, AuthenticationRequest{Delegation: token}, "peer"); err == nil {
		t.Fatal("delegation authorized another editor")
	}
	child.CodeSpaceID = "editor"
	g.RegisterChannel(child)
	out, err := g.AuthenticateChannel(child.ChannelID, AuthenticationRequest{Delegation: token}, "peer")
	if err != nil || !out.Unlocked || out.ResumeToken == "" {
		t.Fatalf("delegation: %v", err)
	}
	child.ChannelID = "second-child"
	g.RegisterChannel(child)
	if _, err = g.AuthenticateChannel(child.ChannelID, AuthenticationRequest{Delegation: token}, "peer"); err == nil {
		t.Fatal("delegation reused on another channel")
	}
	if err = g.ResumeChannel(child.ChannelID, out.ResumeToken); err != nil {
		t.Fatal(err)
	}
	if out.ResumeExpiresAtUnix > login.ResumeExpiresAtUnix {
		t.Fatal("child extended parent lifetime")
	}
	if _, ok := g.TakeAccessSessionByResumeToken(login.ResumeToken); !ok {
		t.Fatal("parent has no revocable lineage")
	}
	if g.IsChannelUnlocked(child.ChannelID) || g.CanResumeMeta(out.ResumeToken, child) {
		t.Fatal("parent logout left editor access alive")
	}
}

func TestAuthenticationPolicyRejectsPreviouslyUnprotectedPendingChannel(t *testing.T) {
	dir := t.TempDir()
	g, err := OpenPersistent(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()
	setup, err := g.Manage("owner", "test", SecurityRequest{Action: "setup", Password: "environment password"})
	if err != nil {
		t.Fatal(err)
	}
	code, _ := totp.GenerateCode(setup.Secret, time.Now())
	if _, err = g.Manage("owner", "test", SecurityRequest{Action: "verify", OperationID: setup.OperationID, Code: code}); err != nil {
		t.Fatal(err)
	}
	if _, err = g.Manage("owner", "test", SecurityRequest{Action: "commit", OperationID: setup.OperationID, Saved: true}); err != nil {
		t.Fatal(err)
	}
	// This artifact was issued before a password existed. It has no authenticated
	// lineage, so resolving it after policy activation must not unlock a channel.
	g.RegisterChannelWithOptions(session.Meta{ChannelID: "pending-before-mfa"}, RegisterChannelOptions{Unlocked: true})
	if g.IsChannelUnlocked("pending-before-mfa") {
		t.Fatal("stale unprotected artifact bypassed MFA")
	}
	g.RegisterChannelWithOptions(session.Meta{ChannelID: "authenticated-host"}, RegisterChannelOptions{Unlocked: true, Trusted: true})
	if !g.IsChannelUnlocked("authenticated-host") {
		t.Fatal("explicit host authority was lost")
	}
}

func TestAuthenticationSetupCannotOverwriteSavedNextStartPassword(t *testing.T) {
	g, dir := persistentTestGate(t)
	hash, err := HashPassword("next start password")
	if err != nil {
		t.Fatal(err)
	}
	if err = WritePasswordHash(dir, hash); err != nil {
		t.Fatal(err)
	}
	if _, err = g.Manage("owner", "test", SecurityRequest{Action: "setup"}); !errors.Is(err, ErrRestartRequired) {
		t.Fatalf("stale owner policy: %v", err)
	}
	if _, err = g.Manage("owner", "test", SecurityRequest{Action: "status"}); !errors.Is(err, ErrRestartRequired) {
		t.Fatalf("stale status must explain restart: %v", err)
	}
}

func TestResourceAuthenticationResumeCannotChangeScope(t *testing.T) {
	for _, app := range []string{"com.floegence.redeven.code", "com.floegence.redeven.portforward"} {
		t.Run(app, func(t *testing.T) {
			g, _ := persistentTestGate(t)
			_, codes := enableTestMFA(t, g)
			meta := session.Meta{ChannelID: "resource", UserPublicID: "user", EndpointID: "env", FloeApp: app, CodeSpaceID: "resource-a", SessionKind: "codeapp", CanRead: true}
			g.RegisterChannel(meta)
			challenge, err := g.AuthenticateChannel(meta.ChannelID, AuthenticationRequest{Password: "environment password"}, "peer")
			if err != nil {
				t.Fatal(err)
			}
			result, err := g.AuthenticateChannel(meta.ChannelID, AuthenticationRequest{ChallengeID: challenge.ChallengeID, RecoveryCode: codes[0]}, "peer")
			if err != nil || result.ResumeToken == "" {
				t.Fatalf("resource authentication: %+v %v", result, err)
			}
			resumed := meta
			resumed.ChannelID = "resumed"
			g.RegisterChannel(resumed)
			if err := g.ResumeChannel(resumed.ChannelID, result.ResumeToken); err != nil {
				t.Fatal(err)
			}
			for _, change := range []func(*session.Meta){
				func(m *session.Meta) { m.CodeSpaceID = "resource-b" },
				func(m *session.Meta) { m.FloeApp = "com.floegence.redeven.agent"; m.CodeSpaceID = "env-ui" },
				func(m *session.Meta) { m.UserPublicID = "another-user" },
				func(m *session.Meta) { m.EndpointID = "another-env" },
			} {
				other := meta
				change(&other)
				if g.CanResumeMeta(result.ResumeToken, other) {
					t.Fatalf("resource resume promoted scope: %+v", other)
				}
			}
		})
	}
}
