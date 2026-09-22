package accessgate

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

var ErrSecondFactor = errors.New("enter an authenticator code or recovery code")
var ErrChallengeExpired = errors.New("sign-in expired; enter your environment password again")
var ErrRestartRequired = errors.New("restart this Runtime to apply the saved environment password before changing security settings")
var ErrRecoveryPending = errors.New("host recovery is pending; finish security setup on the host")

// AuthenticationRequest is shared by browser, encrypted proxy and native streams.
// A challenge is an authentication-only capability, never a business credential.
type AuthenticationRequest struct {
	Password     string `json:"password,omitempty"`
	Delegation   string `json:"delegation,omitempty"`
	ResumeToken  string `json:"resume_token,omitempty"`
	ChallengeID  string `json:"challenge_id,omitempty"`
	Code         string `json:"code,omitempty"`
	RecoveryCode string `json:"recovery_code,omitempty"`
}

type authChallenge struct {
	verified bool
	binding  string
	revision uint64
	expires  time.Time
	attempts int
	local    *LocalSessionResult
	channel  *UnlockResult
}

func (g *Gate) TwoFactorEnabled() bool {
	if g == nil {
		return false
	}
	g.authMu.Lock()
	defer g.authMu.Unlock()
	return g.auth.Secret != ""
}

func (g *Gate) UnlockChannelWithSubject(channelID, password, subject string) (*UnlockResult, error) {
	return g.AuthenticateChannel(channelID, AuthenticationRequest{Password: password}, subject)
}
func (g *Gate) MintLocalSessionWithSubject(password, subject string) (*LocalSessionResult, error) {
	return g.AuthenticateLocal(AuthenticationRequest{Password: password}, subject, "legacy")
}

func (g *Gate) AuthenticateChannel(channelID string, req AuthenticationRequest, subject string) (*UnlockResult, error) {
	if g == nil {
		return &UnlockResult{Unlocked: true}, nil
	}
	g.authMu.Lock()
	defer g.authMu.Unlock()
	if !req.valid() {
		return nil, ErrChallengeExpired
	}
	if req.Delegation != "" {
		return g.consumeCodeSpaceLocked(channelID, req.Delegation)
	}
	if req.ResumeToken != "" {
		if err := g.ResumeChannel(channelID, req.ResumeToken); err != nil {
			return nil, err
		}
		return &UnlockResult{Unlocked: true}, nil
	}
	challenge, id, err := g.authenticateLocked(req, subject, "channel:"+channelID)
	if err != nil {
		return nil, err
	}
	if id != "" {
		return &UnlockResult{SecondFactorRequired: true, ChallengeID: id}, nil
	}
	if challenge != nil && challenge.channel != nil {
		g.mu.Lock()
		st := g.channels[channelID]
		valid := st != nil && st.unlocked && time.Now().Before(st.expiresAt)
		g.mu.Unlock()
		if !valid {
			return nil, ErrChallengeExpired
		}
		copy := *challenge.channel
		return &copy, nil
	}
	result, err := g.issueChannel(channelID)
	if err == nil && challenge != nil {
		challenge.channel = result
	}
	return result, err
}

func (g *Gate) AuthenticateLocal(req AuthenticationRequest, subject, binding string) (*LocalSessionResult, error) {
	if g == nil {
		return &LocalSessionResult{Unlocked: true}, nil
	}
	g.authMu.Lock()
	defer g.authMu.Unlock()
	if !req.valid() {
		return nil, ErrChallengeExpired
	}
	if req.Delegation != "" || req.ResumeToken != "" {
		return nil, ErrChallengeExpired
	}
	challenge, id, err := g.authenticateLocked(req, subject, "local:"+binding)
	if err != nil {
		return nil, err
	}
	if id != "" {
		return &LocalSessionResult{SecondFactorRequired: true, ChallengeID: id}, nil
	}
	if challenge != nil && challenge.local != nil {
		if !g.IsLocalSessionValid(challenge.local.SessionToken) {
			return nil, ErrChallengeExpired
		}
		copy := *challenge.local
		return &copy, nil
	}
	result, err := g.issueLocalSession()
	if err == nil && challenge != nil {
		challenge.local = result
	}
	return result, err
}

func (g *Gate) authenticateLocked(req AuthenticationRequest, subject, binding string) (*authChallenge, string, error) {
	if g.auth.RecoveryPending {
		return nil, "", ErrRecoveryPending
	}
	now := time.Now()
	for id, c := range g.challenges {
		if !now.Before(c.expires) || c.revision != g.auth.Revision {
			delete(g.challenges, id)
		}
	}
	if req.ChallengeID != "" {
		c := g.challenges[req.ChallengeID]
		if c == nil || c.binding != binding || c.revision != g.auth.Revision || !now.Before(c.expires) {
			return nil, "", ErrChallengeExpired
		}
		if c.local != nil || c.channel != nil || c.verified {
			return c, "", nil
		}
		if c.attempts >= 5 {
			delete(g.challenges, req.ChallengeID)
			return nil, "", ErrChallengeExpired
		}
		if req.Password != "" || (req.Code != "" && req.RecoveryCode != "") {
			return nil, "", ErrSecondFactor
		}
		if err := g.verifyFactorLocked(req.Code, req.RecoveryCode, now); err != nil {
			c.attempts++
			if c.attempts >= 5 {
				delete(g.challenges, req.ChallengeID)
			}
			return nil, "", err
		}
		c.verified = true
		source, _, _ := strings.Cut(binding, ":")
		method := "totp"
		if req.RecoveryCode != "" {
			method = "recovery"
		}
		g.audit("auth_succeeded", source, method)
		return c, "", nil
	}
	if req.Code != "" || req.RecoveryCode != "" {
		return nil, "", ErrChallengeExpired
	}
	if err := g.verifyPasswordForSubject(req.Password, subject); err != nil {
		return nil, "", err
	}
	if g.auth.Secret == "" {
		return nil, "", nil
	}
	if len(g.challenges) >= 256 {
		return nil, "", &RateLimitError{RetryAfter: time.Minute}
	}
	id, err := randomToken(32)
	if err != nil {
		return nil, "", err
	}
	g.challenges[id] = &authChallenge{binding: binding, revision: g.auth.Revision, expires: now.Add(5 * time.Minute)}
	return nil, id, nil
}

func normalizeOTP(code string) string { return strings.ReplaceAll(strings.TrimSpace(code), " ", "") }
func digestCode(salt, code string) string {
	v := sha256.Sum256([]byte(salt + ":" + code))
	return hex.EncodeToString(v[:])
}

// Select the greatest matching step and retain the code fingerprint for its whole
// live window. This also prevents reuse when adjacent steps collide to six digits.
func matchingStep(secret, code string, now time.Time) (int64, bool) {
	code = normalizeOTP(code)
	if len(code) != 6 {
		return 0, false
	}
	step := now.Unix() / 30
	matched := int64(-1)
	for offset := int64(-1); offset <= 1; offset++ {
		candidate, err := totp.GenerateCodeCustom(secret, time.Unix((step+offset)*30, 0), totp.ValidateOpts{Period: 30, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1})
		if err == nil && subtle.ConstantTimeCompare([]byte(code), []byte(candidate)) == 1 {
			matched = step + offset
		}
	}
	return matched, matched >= 0
}

func (g *Gate) persistLocked(next authState) error {
	if g.store == nil {
		return errors.New("persistent authentication is unavailable")
	}
	if err := g.store.save(next); err != nil {
		return err
	}
	g.auth = next
	return nil
}

func (g *Gate) verifyFactorLocked(code, recovery string, now time.Time) error {
	if g.auth.Secret == "" {
		return ErrSecondFactor
	}
	if now.UnixMilli() < g.auth.CooldownUntil {
		return &RateLimitError{RetryAfter: time.Duration(g.auth.CooldownUntil-now.UnixMilli()) * time.Millisecond}
	}
	next := g.auth
	success := false
	method := "totp"
	if recovery != "" {
		method = "recovery"
		hash := digestCode(next.RecoverySalt, strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(recovery), "-", "")))
		for i, candidate := range next.RecoveryHashes {
			if subtle.ConstantTimeCompare([]byte(hash), []byte(candidate)) == 1 {
				next.RecoveryHashes = append(append([]string(nil), next.RecoveryHashes[:i]...), next.RecoveryHashes[i+1:]...)
				success = true
				break
			}
		}
	} else if step, ok := matchingStep(next.Secret, code, now); ok && step > next.LastStep {
		hash := digestCode(next.CredentialID, normalizeOTP(code))
		if (hash != next.LastCodeHash || now.Unix() >= next.LastCodeUntil) && now.Unix()/30 >= next.LastStep-1 {
			next.LastStep = step
			next.LastCodeHash = hash
			next.LastCodeUntil = (step + 2) * 30
			success = true
		}
	}
	if success {
		next.Failures = 0
		next.LastFailure = 0
		next.CooldownUntil = 0
	} else {
		if now.UnixMilli()-next.LastFailure >= DefaultFailedAttemptRetention.Milliseconds() && now.UnixMilli() >= next.CooldownUntil {
			next.Failures = 0
		}
		next.Failures++
		next.LastFailure = now.UnixMilli()
		next.CooldownUntil = now.Add(g.cooldownForFailuresLocked(next.Failures)).UnixMilli()
	}
	if err := g.persistLocked(next); err != nil {
		return err
	}
	if success {
		if method == "recovery" {
			g.audit("recovery_used", "owner", method)
		}
		return nil
	}
	g.audit("auth_failed", "owner", method)
	if now.UnixMilli() < next.CooldownUntil {
		return &RateLimitError{RetryAfter: time.Duration(next.CooldownUntil-now.UnixMilli()) * time.Millisecond}
	}
	return ErrSecondFactor
}

func (g *Gate) audit(event, binding, method string) {
	g.log.Info("runtime authentication", "event", event, "binding", binding, "auth_method", method, "policy_revision", g.auth.Revision, "credential_id", g.auth.CredentialID)
}

func AuthenticationErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrRestartRequired):
		return "SECURITY_RESTART_REQUIRED"
	case RetryAfter(err) > 0:
		return "ACCESS_PASSWORD_RETRY_LATER"
	case errors.Is(err, ErrSecondFactor):
		return "ACCESS_FACTOR_INVALID"
	case errors.Is(err, ErrChallengeExpired):
		return "ACCESS_CHALLENGE_EXPIRED"
	case errors.Is(err, ErrRecoveryPending):
		return "ACCESS_RECOVERY_PENDING"
	case errors.Is(err, ErrInvalidPassword):
		return "ACCESS_PASSWORD_INVALID"
	default:
		return "ACCESS_AUTHENTICATION_UNAVAILABLE"
	}
}

// Reject ambiguous mechanisms before looking up any reusable capability.
func (r AuthenticationRequest) valid() bool {
	if len(r.Password) > 1024 || len(r.ChallengeID) > 128 || len(r.Code) > 32 || len(r.RecoveryCode) > 128 || len(r.Delegation) > 128 || len(r.ResumeToken) > 128 {
		return false
	}
	mechanisms := 0
	if r.Password != "" {
		mechanisms++
	}
	if r.ChallengeID != "" {
		mechanisms++
	}
	if r.Delegation != "" {
		mechanisms++
	}
	if r.ResumeToken != "" {
		mechanisms++
	}
	return mechanisms <= 1 && (r.Code == "" || r.RecoveryCode == "") && ((r.Code == "" && r.RecoveryCode == "") || r.ChallengeID != "")
}
