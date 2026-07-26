package accessgate

import (
	"errors"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestGate_UnlockAndResumeReusableToken(t *testing.T) {
	gate := New(Options{Password: "secret"})
	proxyMeta := session.Meta{
		ChannelID:    "ch-proxy",
		EndpointID:   "env_demo",
		FloeApp:      "com.floegence.redeven.agent",
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_proxy",
		UserPublicID: "user_demo",
	}
	rpcMeta1 := proxyMeta
	rpcMeta1.ChannelID = "ch-rpc-1"
	rpcMeta1.SessionKind = "envapp_rpc"
	rpcMeta2 := proxyMeta
	rpcMeta2.ChannelID = "ch-rpc-2"
	rpcMeta2.SessionKind = "envapp_rpc"

	gate.RegisterChannel(proxyMeta)
	gate.RegisterChannel(rpcMeta1)
	gate.RegisterChannel(rpcMeta2)

	unlockResult, err := gate.UnlockChannel(proxyMeta.ChannelID, "secret")
	if err != nil {
		t.Fatalf("UnlockChannel() error = %v", err)
	}
	if unlockResult == nil || unlockResult.ResumeToken == "" {
		t.Fatalf("UnlockChannel() resume token missing: %#v", unlockResult)
	}
	if !gate.IsChannelUnlocked(proxyMeta.ChannelID) {
		t.Fatalf("proxy channel should be unlocked")
	}

	if err := gate.ResumeChannel(rpcMeta1.ChannelID, unlockResult.ResumeToken); err != nil {
		t.Fatalf("ResumeChannel(rpc1) error = %v", err)
	}
	if !gate.IsChannelUnlocked(rpcMeta1.ChannelID) {
		t.Fatalf("rpc channel 1 should be unlocked")
	}

	if err := gate.ResumeChannel(rpcMeta2.ChannelID, unlockResult.ResumeToken); err != nil {
		t.Fatalf("ResumeChannel(rpc2) error = %v", err)
	}
	if !gate.IsChannelUnlocked(rpcMeta2.ChannelID) {
		t.Fatalf("rpc channel 2 should be unlocked")
	}
}

func TestGate_LocalSessionLifecycle(t *testing.T) {
	gate := New(Options{Password: "secret"})

	result, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatalf("MintLocalSession() error = %v", err)
	}
	if result == nil || result.SessionToken == "" {
		t.Fatalf("MintLocalSession() missing token: %#v", result)
	}
	if result.AccessSessionID == "" {
		t.Fatal("MintLocalSession() missing internal access session id")
	}
	if !result.Unlocked {
		t.Fatalf("MintLocalSession() should report unlocked: %#v", result)
	}
	if !gate.IsLocalSessionValid(result.SessionToken) {
		t.Fatalf("local session should be valid")
	}
	if expiresAt, ok := gate.LocalSessionExpiresAt(result.SessionToken); !ok || expiresAt.UnixMilli() != result.SessionExpiresAtUnix {
		t.Fatalf("LocalSessionExpiresAt() = (%v, %v), want unix ms %d", expiresAt, ok, result.SessionExpiresAtUnix)
	}

	gate.RevokeLocalSession(result.SessionToken)
	if gate.IsLocalSessionValid(result.SessionToken) {
		t.Fatalf("local session should be revoked")
	}
	if _, ok := gate.LocalSessionExpiresAt(result.SessionToken); ok {
		t.Fatal("revoked local session should not expose a deadline")
	}
}

func TestGate_ResumeKeepsAccessSessionIdentityAndLogoutRevokesLineage(t *testing.T) {
	gate := New(Options{Password: "secret"})
	initial, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatal(err)
	}
	if initial.SessionExpiresAtUnix != initial.ResumeExpiresAtUnix {
		t.Fatalf("initial expiry = %d, want lineage deadline %d", initial.SessionExpiresAtUnix, initial.ResumeExpiresAtUnix)
	}
	resumed, err := gate.MintLocalSessionFromResumeToken(initial.ResumeToken, session.Meta{
		EndpointID: "env_local", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui",
		SessionKind: "envapp_rpc", UserPublicID: "user_local",
	})
	if err != nil {
		t.Fatal(err)
	}
	if resumed.AccessSessionID != initial.AccessSessionID {
		t.Fatalf("resumed access session = %q, want %q", resumed.AccessSessionID, initial.AccessSessionID)
	}
	if accessSessionID, ok := gate.TakeLocalSession(resumed.SessionToken); !ok || accessSessionID != initial.AccessSessionID {
		t.Fatalf("TakeLocalSession() = (%q, %v)", accessSessionID, ok)
	}
	if gate.IsLocalSessionValid(initial.SessionToken) || gate.IsLocalSessionValid(resumed.SessionToken) {
		t.Fatal("logout left a token from the access-session lineage active")
	}
	if gate.CanResumeMeta(initial.ResumeToken, localAccessTestMeta()) {
		t.Fatal("logout left the access-session resume token active")
	}
}

func TestGate_ResumedLocalSessionCannotOutliveLineage(t *testing.T) {
	gate := New(Options{
		Password:        "secret",
		ResumeTTL:       time.Hour,
		LocalSessionTTL: 24 * time.Hour,
	})
	initial, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatal(err)
	}
	if initial.SessionExpiresAtUnix != initial.ResumeExpiresAtUnix {
		t.Fatalf("initial expiry = %d, want lineage deadline %d", initial.SessionExpiresAtUnix, initial.ResumeExpiresAtUnix)
	}
	resumed, err := gate.MintLocalSessionFromResumeToken(initial.ResumeToken, localAccessTestMeta())
	if err != nil {
		t.Fatal(err)
	}
	if resumed.SessionExpiresAtUnix != initial.ResumeExpiresAtUnix {
		t.Fatalf("resumed expiry = %d, want lineage deadline %d", resumed.SessionExpiresAtUnix, initial.ResumeExpiresAtUnix)
	}
}

func TestGate_TakeAccessSessionByResumeTokenRevokesLineage(t *testing.T) {
	gate := New(Options{Password: "secret"})
	initial, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := gate.MintLocalSessionFromResumeToken(initial.ResumeToken, localAccessTestMeta())
	if err != nil {
		t.Fatal(err)
	}
	accessSessionID, ok := gate.TakeAccessSessionByResumeToken(initial.ResumeToken)
	if !ok || accessSessionID != initial.AccessSessionID {
		t.Fatalf("TakeAccessSessionByResumeToken() = (%q, %v), want (%q, true)", accessSessionID, ok, initial.AccessSessionID)
	}
	if gate.IsLocalSessionValid(initial.SessionToken) || gate.IsLocalSessionValid(resumed.SessionToken) {
		t.Fatal("resume-token logout left a local token active")
	}
	if gate.CanResumeMeta(initial.ResumeToken, localAccessTestMeta()) {
		t.Fatal("resume-token logout left its resume token active")
	}
}

func TestGate_TakeExpiredLocalSessionsClosesIdentityOnce(t *testing.T) {
	gate := New(Options{Password: "secret", LocalSessionTTL: time.Minute})
	initial, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := gate.MintLocalSessionFromResumeToken(initial.ResumeToken, localAccessTestMeta())
	if err != nil {
		t.Fatal(err)
	}
	expired := gate.TakeExpiredLocalSessions(time.Now().Add(2 * time.Minute))
	if len(expired) != 1 || expired[0].AccessSessionID != initial.AccessSessionID {
		t.Fatalf("expired sessions = %#v", expired)
	}
	if gate.IsLocalSessionValid(initial.SessionToken) || gate.IsLocalSessionValid(resumed.SessionToken) {
		t.Fatal("expired access-session lineage remained valid")
	}
}

func localAccessTestMeta() session.Meta {
	return session.Meta{
		EndpointID: "env_local", FloeApp: "com.floegence.redeven.agent", CodeSpaceID: "env-ui",
		SessionKind: "envapp_rpc", UserPublicID: "user_local",
	}
}

func TestGate_CanResumeMetaAndRevokeResumeToken(t *testing.T) {
	gate := New(Options{Password: "secret"})

	result, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatalf("MintLocalSession() error = %v", err)
	}
	if result == nil || result.ResumeToken == "" {
		t.Fatalf("MintLocalSession() missing resume token: %#v", result)
	}

	localMeta := session.Meta{
		EndpointID:   "env_local",
		FloeApp:      "com.floegence.redeven.agent",
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_rpc",
		UserPublicID: "user_local",
	}
	if !gate.CanResumeMeta(result.ResumeToken, localMeta) {
		t.Fatalf("resume token should match local meta")
	}

	mismatched := localMeta
	mismatched.EndpointID = "env_other"
	if gate.CanResumeMeta(result.ResumeToken, mismatched) {
		t.Fatalf("resume token should reject mismatched meta")
	}

	gate.RevokeResumeToken(result.ResumeToken)
	if gate.CanResumeMeta(result.ResumeToken, localMeta) {
		t.Fatalf("resume token should be revoked")
	}
}

func TestGate_MintLocalSessionFromResumeToken(t *testing.T) {
	gate := New(Options{Password: "secret"})

	unlockResult, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatalf("MintLocalSession() error = %v", err)
	}
	if unlockResult == nil || unlockResult.ResumeToken == "" {
		t.Fatalf("MintLocalSession() missing resume token: %#v", unlockResult)
	}

	localMeta := session.Meta{
		EndpointID:   "env_local",
		FloeApp:      "com.floegence.redeven.agent",
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_rpc",
		UserPublicID: "user_local",
	}

	sessionResult, err := gate.MintLocalSessionFromResumeToken(unlockResult.ResumeToken, localMeta)
	if err != nil {
		t.Fatalf("MintLocalSessionFromResumeToken() error = %v", err)
	}
	if sessionResult == nil || sessionResult.SessionToken == "" {
		t.Fatalf("MintLocalSessionFromResumeToken() missing local session: %#v", sessionResult)
	}
	if !gate.IsLocalSessionValid(sessionResult.SessionToken) {
		t.Fatalf("bootstrapped local session should be valid")
	}
}

func TestGate_MintLocalSessionFromResumeTokenRejectsMismatchedMeta(t *testing.T) {
	gate := New(Options{Password: "secret"})

	unlockResult, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatalf("MintLocalSession() error = %v", err)
	}

	mismatchedMeta := session.Meta{
		EndpointID:   "env_other",
		FloeApp:      "com.floegence.redeven.agent",
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_rpc",
		UserPublicID: "user_local",
	}

	if _, err := gate.MintLocalSessionFromResumeToken(unlockResult.ResumeToken, mismatchedMeta); err == nil {
		t.Fatalf("MintLocalSessionFromResumeToken() expected mismatch error")
	}
}

func TestGate_MintLocalSessionFromResumeTokenRejectsExpiredToken(t *testing.T) {
	gate := New(Options{
		Password:  "secret",
		ResumeTTL: time.Millisecond,
	})

	unlockResult, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatalf("MintLocalSession() error = %v", err)
	}

	time.Sleep(10 * time.Millisecond)

	localMeta := session.Meta{
		EndpointID:   "env_local",
		FloeApp:      "com.floegence.redeven.agent",
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_rpc",
		UserPublicID: "user_local",
	}

	if _, err := gate.MintLocalSessionFromResumeToken(unlockResult.ResumeToken, localMeta); err == nil {
		t.Fatalf("MintLocalSessionFromResumeToken() expected expiration error")
	}
}

func TestGate_UnlockRejectsWrongPassword(t *testing.T) {
	gate := New(Options{Password: "secret"})
	gate.RegisterChannel(session.Meta{ChannelID: "ch-1"})

	if _, err := gate.UnlockChannel("ch-1", "wrong"); !errors.Is(err, ErrInvalidPassword) {
		t.Fatalf("UnlockChannel() error = %v, want ErrInvalidPassword", err)
	}
}

func TestGate_UnlockRateLimitsRepeatedFailuresBySubject(t *testing.T) {
	gate := New(Options{
		Password: "secret",
		AttemptPolicy: AttemptPolicy{
			Steps: []AttemptPolicyStep{
				{Failures: 2, Cooldown: 20 * time.Millisecond},
			},
			Retention: time.Minute,
		},
	})
	gate.RegisterChannel(session.Meta{ChannelID: "ch-1"})

	if _, err := gate.UnlockChannelWithSubject("ch-1", "wrong", "203.0.113.4"); !errors.Is(err, ErrInvalidPassword) {
		t.Fatalf("first failure error = %v, want ErrInvalidPassword", err)
	}

	if _, err := gate.UnlockChannelWithSubject("ch-1", "wrong", "203.0.113.4"); !IsRateLimited(err) {
		t.Fatalf("second failure error = %v, want rate limit", err)
	}

	if _, err := gate.UnlockChannelWithSubject("ch-1", "secret", "203.0.113.4"); !IsRateLimited(err) {
		t.Fatalf("locked correct password error = %v, want rate limit", err)
	}

	time.Sleep(25 * time.Millisecond)

	result, err := gate.UnlockChannelWithSubject("ch-1", "secret", "203.0.113.4")
	if err != nil {
		t.Fatalf("UnlockChannelWithSubject() after cooldown error = %v", err)
	}
	if result == nil || !result.Unlocked {
		t.Fatalf("UnlockChannelWithSubject() after cooldown = %#v, want unlocked", result)
	}
}

func TestGate_RegisterChannelWithOptionsStartsUnlocked(t *testing.T) {
	gate := New(Options{Password: "secret"})
	meta := session.Meta{
		ChannelID:    "ch-local",
		EndpointID:   "env_local",
		FloeApp:      "com.floegence.redeven.agent",
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_rpc",
		UserPublicID: "user_local",
	}

	gate.RegisterChannelWithOptions(meta, RegisterChannelOptions{Unlocked: true})

	status := gate.Status(meta.ChannelID)
	if !status.PasswordRequired {
		t.Fatalf("status.PasswordRequired = false, want true")
	}
	if !status.Unlocked {
		t.Fatalf("status.Unlocked = false, want true")
	}
	if !gate.IsChannelUnlocked(meta.ChannelID) {
		t.Fatalf("channel should start unlocked")
	}
}
