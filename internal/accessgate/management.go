package accessgate

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"image/png"
	"strings"
	"time"

	"github.com/pquerna/otp/totp"
)

type SecurityStatus struct {
	Enabled                bool   `json:"enabled"`
	PasswordConfigured     bool   `json:"password_configured"`
	RecoveryPending        bool   `json:"recovery_pending"`
	RecoveryCodesRemaining int    `json:"recovery_codes_remaining"`
	Revision               uint64 `json:"revision"`
}

type SecurityRequest struct {
	Action       string `json:"action"`
	OperationID  string `json:"operation_id,omitempty"`
	Password     string `json:"password,omitempty"`
	Code         string `json:"code,omitempty"`
	RecoveryCode string `json:"recovery_code,omitempty"`
	Saved        bool   `json:"saved,omitempty"`
}

type SecurityResult struct {
	SecurityStatus
	OperationID   string   `json:"operation_id,omitempty"`
	Secret        string   `json:"secret,omitempty"`
	QRImage       string   `json:"qr_image,omitempty"`
	RecoveryCodes []string `json:"recovery_codes,omitempty"`
}

type managementOperation struct {
	binding, action, secret, credentialID, salt string
	passwordHash                                []byte
	codes, hashes                               []string
	revision                                    uint64
	expires                                     time.Time
	verified                                    bool
	step                                        int64
	committed                                   bool
}

func (g *Gate) SecurityStatus() SecurityStatus {
	if g == nil {
		return SecurityStatus{}
	}
	g.authMu.Lock()
	defer g.authMu.Unlock()
	return g.securityStatusLocked()
}
func (g *Gate) securityStatusLocked() SecurityStatus {
	return SecurityStatus{Enabled: g.auth.Secret != "", PasswordConfigured: len(g.auth.PasswordHash) > 0, RecoveryPending: g.auth.RecoveryPending, RecoveryCodesRemaining: len(g.auth.RecoveryHashes), Revision: g.auth.Revision}
}

// Manage is reachable only through the authenticated private owner control
// service or an offline CLI holding the same environment state lock.
func (g *Gate) Manage(binding, label string, req SecurityRequest) (*SecurityResult, error) {
	g.authMu.Lock()
	defer g.authMu.Unlock()
	if g.store == nil {
		return nil, errors.New("persistent authentication is unavailable")
	}
	var generation int64
	if err := g.store.db.QueryRow("SELECT generation FROM authentication WHERE singleton=1").Scan(&generation); err != nil {
		return nil, err
	}
	if generation != g.store.generation {
		return nil, ErrRestartRequired
	}
	now := time.Now()
	for id, op := range g.management {
		if !now.Before(op.expires) {
			delete(g.management, id)
		}
	}
	out := func() *SecurityResult { return &SecurityResult{SecurityStatus: g.securityStatusLocked()} }
	if req.Action == "status" {
		return out(), nil
	}
	if req.Action == "recover" {
		next := g.auth
		next.RecoveryPending = true
		next.Revision++
		if err := g.persistLocked(next); err != nil {
			return nil, err
		}
		g.enabled.Store(true)
		g.revokeOrdinaryLocked()
		g.audit("owner_recovery_started", binding, "trusted_management")
		return out(), nil
	}
	if req.Action == "cancel" {
		if op := g.management[req.OperationID]; op != nil && op.binding == binding {
			delete(g.management, req.OperationID)
		}
		return out(), nil
	}
	if req.Action == "setup" || req.Action == "replace" || req.Action == "rotate" || req.Action == "disable" {
		if len(g.management) >= 32 {
			return nil, errors.New("too many pending security operations")
		}
		if req.Action == "setup" && g.auth.Secret != "" && !g.auth.RecoveryPending {
			return nil, errors.New("authenticator already configured")
		}
		if req.Action != "setup" && (g.auth.Secret == "" || g.auth.RecoveryPending) {
			return nil, errors.New("finish authenticator setup first")
		}
		if !g.auth.RecoveryPending && req.Action != "setup" {
			if err := g.verifyPasswordForSubject(req.Password, "management"); err != nil {
				return nil, err
			}
			if g.auth.Secret != "" {
				if err := g.verifyFactorLocked(req.Code, req.RecoveryCode, now); err != nil {
					return nil, err
				}
			}
		}
		if len(g.auth.PasswordHash) == 0 || g.auth.RecoveryPending {
			if req.Action != "setup" {
				return nil, ErrRecoveryPending
			}
			if req.Password == "" {
				return nil, errors.New("set an environment password before enabling two-factor authentication")
			}
		}
		id, err := randomToken(32)
		if err != nil {
			return nil, err
		}
		op := &managementOperation{binding: binding, action: req.Action, revision: g.auth.Revision, expires: now.Add(5 * time.Minute), step: -1}
		result := out()
		result.OperationID = id
		if req.Action == "setup" || req.Action == "replace" {
			if strings.TrimSpace(label) == "" {
				label = "Environment"
			}
			key, err := totp.Generate(totp.GenerateOpts{Issuer: "Redeven", AccountName: label + " (" + g.store.environmentID[:8] + ")", SecretSize: 20})
			if err != nil {
				return nil, err
			}
			op.secret = key.Secret()
			op.credentialID, err = randomToken(16)
			if err != nil {
				return nil, err
			}
			img, err := key.Image(256, 256)
			if err != nil {
				return nil, err
			}
			var image bytes.Buffer
			if err = png.Encode(&image, img); err != nil {
				return nil, err
			}
			result.Secret = op.secret
			result.QRImage = "data:image/png;base64," + base64.StdEncoding.EncodeToString(image.Bytes())
			if g.auth.RecoveryPending || len(g.auth.PasswordHash) == 0 {
				hash, err := HashPassword(req.Password)
				if err != nil {
					return nil, err
				}
				op.passwordHash = hash
			}
		} else {
			op.verified = true
		}
		if req.Action != "disable" {
			op.salt, err = randomToken(32)
			if err != nil {
				return nil, err
			}
			for range 8 {
				raw := make([]byte, 16)
				if _, err = rand.Read(raw); err != nil {
					return nil, err
				}
				code := strings.ToUpper(hex.EncodeToString(raw))
				op.codes = append(op.codes, code[:8]+"-"+code[8:16]+"-"+code[16:24]+"-"+code[24:])
				op.hashes = append(op.hashes, digestCode(op.salt, code))
			}
		}
		if req.Action == "rotate" {
			result.RecoveryCodes = append([]string(nil), op.codes...)
		}
		g.management[id] = op
		g.audit("setup_started", binding, "trusted_management")
		return result, nil
	}
	op := g.management[req.OperationID]
	if op == nil || op.binding != binding || !now.Before(op.expires) {
		return nil, errors.New("security setup expired; start again")
	}
	if op.committed && req.Action == "commit" {
		return out(), nil
	}
	if op.revision != g.auth.Revision {
		return nil, errors.New("security settings changed; start again")
	}
	switch req.Action {
	case "verify":
		if op.action != "setup" && op.action != "replace" {
			return nil, errors.New("invalid security operation")
		}
		if !op.verified {
			if now.UnixMilli() < g.auth.CooldownUntil {
				return nil, &RateLimitError{RetryAfter: time.Duration(g.auth.CooldownUntil-now.UnixMilli()) * time.Millisecond}
			}
			step, ok := matchingStep(op.secret, req.Code, now)
			if !ok {
				next := g.auth
				next.Failures++
				next.LastFailure = now.UnixMilli()
				next.CooldownUntil = now.Add(g.cooldownForFailuresLocked(next.Failures)).UnixMilli()
				if err := g.persistLocked(next); err != nil {
					return nil, err
				}
				return nil, ErrSecondFactor
			}
			op.step = step
			op.verified = true
		}
		result := out()
		result.OperationID = req.OperationID
		result.RecoveryCodes = append([]string(nil), op.codes...)
		return result, nil
	case "commit":
		if !op.verified || (op.action != "disable" && !req.Saved) {
			return nil, errors.New("verify your authenticator and save the recovery codes first")
		}
		next := g.auth
		next.Revision++
		if op.action == "disable" {
			next.Secret = ""
			next.CredentialID = ""
			next.RecoverySalt = ""
			next.RecoveryHashes = nil
		} else {
			next.RecoverySalt = op.salt
			next.RecoveryHashes = append([]string(nil), op.hashes...)
			if op.secret != "" {
				next.Secret = op.secret
				next.CredentialID = op.credentialID
				next.LastStep = op.step
				code, _ := totp.GenerateCode(op.secret, time.Unix(op.step*30, 0))
				next.LastCodeHash = digestCode(op.credentialID, code)
				next.LastCodeUntil = (op.step + 2) * 30
			}
			if len(op.passwordHash) > 0 {
				next.PasswordHash = op.passwordHash
			}
			next.RecoveryPending = false
			next.Failures = 0
			next.LastFailure = 0
			next.CooldownUntil = 0
		}
		if err := g.persistLocked(next); err != nil {
			return nil, err
		}
		g.passwordHash = append([]byte(nil), next.PasswordHash...)
		g.enabled.Store(len(next.PasswordHash) > 0)
		g.revokeOrdinaryLocked()
		op.committed = true
		op.secret = ""
		op.codes = nil
		op.hashes = nil
		op.passwordHash = nil
		g.audit(op.action+"_committed", binding, "trusted_management")
		return out(), nil
	default:
		return nil, errors.New("unknown security action")
	}
}

func (g *Gate) revokeOrdinaryLocked() {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, s := range g.localSessions {
		g.revoked = append(g.revoked, ExpiredLocalSession{AccessSessionID: s.accessSessionID})
	}
	g.localSessions = make(map[string]*localSessionState)
	g.resumeTokens = make(map[string]*resumeTokenState)
	for _, s := range g.channels {
		if !s.trusted {
			s.unlocked = false
			if s.cancel != nil {
				s.cancel()
			}
		}
	}
	g.challenges = make(map[string]*authChallenge)
	g.delegations = make(map[string]*childDelegation)
}
