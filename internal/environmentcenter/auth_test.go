package environmentcenter

import (
	"errors"
	"github.com/pquerna/otp/totp"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

const testPassword = "correct horse battery staple"

func TestDeviceRevocationClearsPendingAuthentication(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	challenge, err := c.Authenticate("browser", login.Token, "source", "browser", Authentication{Password: testPassword, Action: "factor:replace"})
	if err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	c.grants["pending"] = &actionGrant{Session: login.Token}
	c.setups["pending"] = &setupOperation{Session: login.Token}
	c.mu.Unlock()
	if err := c.Revoke(login.Token, "", false); err != nil {
		t.Fatal(err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.challenges[digest(challenge.Challenge)] != nil || c.grants["pending"] != nil || c.setups["pending"] != nil {
		t.Fatal("revoked device retained pending authentication records")
	}
}

func configuredCenter(t *testing.T) (*Center, string, string, []string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "center")
	c, err := Open(dir, "https://center.example.test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	now := time.Unix(1800000000, 0)
	c.now = func() time.Time { return now }
	token, err := c.OwnerBootstrap(false)
	if err != nil {
		t.Fatal(err)
	}
	setup, err := c.SetupStart(token, "browser-a", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Authenticate("browser-a", "", "source", "Test", Authentication{Password: testPassword}); !errors.Is(err, ErrDenied) {
		t.Fatalf("incomplete setup authenticated: %v", err)
	}
	code, _ := totp.GenerateCode(setup.Secret, now)
	verified, err := c.SetupVerify(setup.Operation, "browser-a", "", code)
	if err != nil {
		t.Fatal(err)
	}
	if err = c.SetupCommit(setup.Operation, "browser-a", "", true); err != nil {
		t.Fatal(err)
	}
	return c, dir, setup.Secret, verified.Codes
}
func loginRecovery(t *testing.T, c *Center, browser, code string) AuthenticationResult {
	t.Helper()
	a, err := c.Authenticate(browser, "", "test-source", "Test browser", Authentication{Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	b, err := c.Authenticate(browser, "", "test-source", "Test browser", Authentication{Challenge: a.Challenge, Recovery: code})
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func TestSetupRequiresOwnerAndAtomicFactors(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	if _, err := c.SetupStart("invalid", "browser", testPassword); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
	if _, err := c.OwnerBootstrap(false); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
	auth := loginRecovery(t, c, "browser-a", codes[0])
	if auth.Token == "" || auth.Device == nil {
		t.Fatal("missing device")
	}
	if _, err := c.Session(auth.Token); err != nil {
		t.Fatal(err)
	}
}
func TestChallengesCannotCrossBrowserPurposeOrSession(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	a, err := c.Authenticate("a", "", "test-source", "Browser", Authentication{Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	for _, req := range []struct{ browser, session, action string }{{"b", "", ""}, {"a", "", "factor:replace"}, {"a", "forged", ""}} {
		if _, err = c.Authenticate(req.browser, req.session, "test-source", "Browser", Authentication{Challenge: a.Challenge, Recovery: codes[0], Action: req.action}); !errors.Is(err, ErrExpired) {
			t.Fatalf("crossed challenge: %v", err)
		}
	}
	if _, err = c.Authenticate("a", "", "test-source", "Browser", Authentication{Challenge: a.Challenge, Recovery: codes[0]}); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Authenticate("a", "", "test-source", "Browser", Authentication{Challenge: a.Challenge, Recovery: codes[0]}); !errors.Is(err, ErrExpired) {
		t.Fatal(err)
	}
}
func TestRecoveryConsumptionIsAtomicAndSurvivesRestart(t *testing.T) {
	c, dir, _, codes := configuredCenter(t)
	a, _ := c.Authenticate("a", "", "source", "Browser", Authentication{Password: testPassword})
	b, _ := c.Authenticate("b", "", "source", "Browser", Authentication{Password: testPassword})
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0
	for _, v := range []struct{ browser, challenge string }{{"a", a.Challenge}, {"b", b.Challenge}} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.Authenticate(v.browser, "", "source", "Browser", Authentication{Challenge: v.challenge, Recovery: codes[0]}); err == nil {
				mu.Lock()
				success++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if success != 1 {
		t.Fatalf("success=%d", success)
	}
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(dir, "https://center.example.test")
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	restored.now = c.now
	a, err = restored.Authenticate("a", "", "source", "Browser", Authentication{Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restored.Authenticate("a", "", "source", "Browser", Authentication{Challenge: a.Challenge, Recovery: codes[0]}); !errors.Is(err, ErrFactor) {
		t.Fatal(err)
	}
}
func TestTOTPReplaySurvivesRestart(t *testing.T) {
	c, dir, secret, _ := configuredCenter(t)
	now := c.now().Add(time.Minute)
	c.now = func() time.Time { return now }
	a, _ := c.Authenticate("a", "", "source", "Browser", Authentication{Password: testPassword})
	code, _ := totp.GenerateCode(secret, now)
	result, err := c.Authenticate("a", "", "source", "Browser", Authentication{Challenge: a.Challenge, Code: code})
	if err != nil {
		t.Fatal(err)
	}
	if err = c.Close(); err != nil {
		t.Fatal(err)
	}
	c, err = Open(dir, "https://center.example.test")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.now = func() time.Time { return now }
	if _, err = c.Session(result.Token); !errors.Is(err, ErrDenied) {
		t.Fatal("restart revived session")
	}
	a, _ = c.Authenticate("a", "", "source", "Browser", Authentication{Password: testPassword})
	if _, err = c.Authenticate("a", "", "source", "Browser", Authentication{Challenge: a.Challenge, Code: code}); !errors.Is(err, ErrFactor) {
		t.Fatal(err)
	}
}
func TestDeviceRevocationAndExpiry(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	a := loginRecovery(t, c, "a", codes[0])
	b := loginRecovery(t, c, "b", codes[1])
	c.mu.Lock()
	ctx := c.sessions[digest(a.Token)].Context
	c.mu.Unlock()
	if err := c.Revoke(a.Token, "", false); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("active device not canceled")
	}
	if _, err := c.Session(b.Token); err != nil {
		t.Fatal(err)
	}
	now := c.now().Add(61 * time.Minute)
	c.mu.Lock()
	c.now = func() time.Time { return now }
	c.mu.Unlock()
	if _, err := c.Activity(b.Token); !errors.Is(err, ErrDenied) {
		t.Fatal("activity revived expired device")
	}
}
func TestActionGrantsBindExactPayloadAndRevokeOnChange(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	a := loginRecovery(t, c, "a", codes[0])
	action := "password:" + digest("new strong password")
	challenge, err := c.Authenticate("a", a.Token, "source", "", Authentication{Password: testPassword, Action: action})
	if err != nil {
		t.Fatal(err)
	}
	grant, err := c.Authenticate("a", a.Token, "source", "", Authentication{Challenge: challenge.Challenge, Recovery: codes[1], Action: action})
	if err != nil {
		t.Fatal(err)
	}
	if err = c.ChangePassword(a.Token, grant.Grant, "different strong password"); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
	if err = c.ChangePassword(a.Token, grant.Grant, "new strong password"); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Session(a.Token); !errors.Is(err, ErrDenied) {
		t.Fatal("security change did not revoke")
	}
}
func TestMissingCommittedStateFailsClosed(t *testing.T) {
	for _, name := range []string{"center.key", "center.sqlite"} {
		t.Run(name, func(t *testing.T) {
			c, dir, _, _ := configuredCenter(t)
			if err := c.Close(); err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(filepath.Join(dir, name)); err != nil {
				t.Fatal(err)
			}
			if got, err := Open(dir, "https://center.example.test"); err == nil {
				got.Close()
				t.Fatal("missing authority recreated")
			}
		})
	}
}
func TestOwnerRecoveryClosesAccessBeforeNewSetup(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	a := loginRecovery(t, c, "a", codes[0])
	token, err := c.OwnerBootstrap(true)
	if err != nil || token == "" {
		t.Fatal(err)
	}
	if _, err = c.Session(a.Token); !errors.Is(err, ErrDenied) {
		t.Fatal("recovery retained access")
	}
	if _, err = c.Authenticate("b", "", "source", "", Authentication{Password: testPassword}); !errors.Is(err, ErrDenied) {
		t.Fatal("recovery allowed login")
	}
	if _, err = c.SetupStart(token, "b", "replacement strong password"); err != nil {
		t.Fatal(err)
	}
}

func TestRecoveryRotationWaitsForSavedConfirmation(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "a", codes[0])
	first, err := c.Authenticate("a", login.Token, "source", "Browser", Authentication{Password: testPassword, Action: "recovery:rotate"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := c.Authenticate("a", login.Token, "source", "Browser", Authentication{Challenge: first.Challenge, Recovery: codes[1], Action: "recovery:rotate"})
	if err != nil {
		t.Fatal(err)
	}
	pending, err := c.RotateRecovery("a", login.Token, second.Grant)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Session(login.Token); err != nil {
		t.Fatal("rotation committed before codes were saved")
	}
	if err = c.SetupCommit(pending.Operation, "a", login.Token, false); !errors.Is(err, ErrDenied) {
		t.Fatal("unsaved codes committed")
	}
	other := loginRecovery(t, c, "b", codes[2])
	if err = c.SetupCommit(pending.Operation, "b", login.Token, true); !errors.Is(err, ErrExpired) {
		t.Fatal("another browser committed rotation")
	}
	if err = c.SetupCommit(pending.Operation, "a", login.Token, true); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Session(other.Token); !errors.Is(err, ErrDenied) {
		t.Fatal("rotation retained old sessions")
	}
	loginRecovery(t, c, "c", pending.Codes[0])
}

func TestOfflineRecoveryRequiresExclusiveLockAndSurvivesStartup(t *testing.T) {
	c, dir, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "a", codes[0])
	if other, err := Open(dir, c.key.Origin); err == nil {
		other.Close()
		t.Fatal("opened live state")
	}
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	offline, err := Open(dir, c.key.Origin)
	if err != nil {
		t.Fatal(err)
	}
	token, err := offline.OwnerBootstrap(true)
	if err != nil {
		t.Fatal(err)
	}
	offline.Close()
	restored, err := Open(dir, c.key.Origin)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if !restored.Security().RecoveryPending {
		t.Fatal("recovery did not fence business")
	}
	if _, err = restored.Session(login.Token); err == nil {
		t.Fatal("recovery revived device")
	}
	setup, err := restored.SetupStart(token, "recovery-browser", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	code, _ := totp.GenerateCode(setup.Secret, restored.now())
	if _, err = restored.SetupVerify(setup.Operation, "recovery-browser", "", code); err != nil {
		t.Fatal(err)
	}
	if err = restored.SetupCommit(setup.Operation, "recovery-browser", "", true); err != nil {
		t.Fatal(err)
	}
	if _, err = restored.SetupStart(token, "other", testPassword); err == nil {
		t.Fatal("used owner credential accepted")
	}
}

func TestPasswordPolicyRejectsCommonAndUnboundedInputs(t *testing.T) {
	for _, password := range []string{"Password12345", "123456789012", "aaaaaaaaaaaa", "administrator", "too short"} {
		if passwordPolicy(password) == nil {
			t.Fatalf("accepted weak password %q", password)
		}
	}
	if passwordPolicy(testPassword) != nil {
		t.Fatal("passphrase rejected")
	}
}

func TestTOTPConcurrentConsumptionHasOneWinner(t *testing.T) {
	c, _, secret, _ := configuredCenter(t)
	now := c.now().Add(time.Minute)
	c.now = func() time.Time { return now }
	first, err := c.Authenticate("first", "", "source", "Browser", Authentication{Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	second, err := c.Authenticate("second", "", "source", "Browser", Authentication{Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	code, err := totp.GenerateCode(secret, now)
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, request := range []struct{ browser, challenge string }{{"first", first.Challenge}, {"second", second.Challenge}} {
		go func() {
			<-start
			_, err := c.Authenticate(request.browser, "", "source", "Browser", Authentication{Challenge: request.challenge, Code: code})
			results <- err
		}()
	}
	close(start)
	winners := 0
	for range 2 {
		if err := <-results; err == nil {
			winners++
		} else if !errors.Is(err, ErrFactor) {
			t.Fatal(err)
		}
	}
	if winners != 1 {
		t.Fatalf("concurrent TOTP winners: %d", winners)
	}
}

func TestAuthenticationThrottlePersistsAndRecovers(t *testing.T) {
	c, dir, _, codes := configuredCenter(t)
	now := c.now()
	for range 5 {
		if _, err := c.Authenticate("browser", "", "source", "Browser", Authentication{Password: "incorrect password"}); !errors.Is(err, ErrDenied) {
			t.Fatal(err)
		}
	}
	if _, err := c.Authenticate("new-browser", "", "different-source", "Browser", Authentication{Password: testPassword}); !errors.Is(err, ErrBusy) {
		t.Fatalf("new challenge escaped administrator throttle: %v", err)
	}
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(dir, c.key.Origin)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	restored.now = func() time.Time { return now }
	if _, err := restored.Authenticate("new-browser", "", "different-source", "Browser", Authentication{Password: testPassword}); !errors.Is(err, ErrBusy) {
		t.Fatalf("restart erased throttle: %v", err)
	}
	now = now.Add(2 * time.Second)
	loginRecovery(t, restored, "new-browser", codes[0])
}

func TestFactorReplacementCancelPreservesOldFactor(t *testing.T) {
	c, _, secret, codes := configuredCenter(t)
	login := loginRecovery(t, c, "first", codes[0])
	challenge, err := c.Authenticate("first", login.Token, "source", "Browser", Authentication{Password: testPassword, Action: "factor:replace"})
	if err != nil {
		t.Fatal(err)
	}
	grant, err := c.Authenticate("first", login.Token, "source", "Browser", Authentication{Challenge: challenge.Challenge, Recovery: codes[1], Action: "factor:replace"})
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := c.ReplaceFactor("first", login.Token, grant.Grant)
	if err != nil {
		t.Fatal(err)
	}
	c.SetupCancel(replacement.Operation, "first", login.Token)
	if c.state.Secret != secret {
		t.Fatal("canceled factor replacement changed old factor")
	}
	if _, err = c.Session(login.Token); err != nil {
		t.Fatal(err)
	}
	loginRecovery(t, c, "second", codes[2])
}
