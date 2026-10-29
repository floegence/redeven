package environmentcenter

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/pbkdf2"
)

const SessionIdle = time.Hour
const SessionAbsolute = 12 * time.Hour
const ChallengeLifetime = 5 * time.Minute
const SetupLifetime = 15 * time.Minute
const GrantLifetime = 10 * time.Minute
const MaxDevices = 16

type deviceSession struct {
	ID                          string
	Device                      string
	Label                       string
	Created, Activity, Absolute time.Time
	Revision                    int64
	Context                     context.Context
	cancel                      context.CancelFunc
	timer                       *time.Timer
	timerGeneration             uint64
}
type Device struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Created  int64  `json:"created_at"`
	Activity int64  `json:"last_activity_at"`
	Expires  int64  `json:"expires_at"`
	Current  bool   `json:"current"`
}
type challenge struct {
	Browser, Session, Action string
	Revision                 int64
	Expires                  time.Time
	Attempts                 int
}
type setupOperation struct {
	Token, URI                                            string
	Browser, Bootstrap, Session, Action, Secret, CodeHash string
	PasswordHash                                          []byte
	Codes, Hashes                                         []string
	Revision                                              int64
	Expires                                               time.Time
	Verified                                              bool
	Step                                                  int64
	Attempts                                              int
}
type setupCommitReceipt struct {
	Operation, Browser, Session string
	Revision                    int64
	Expires                     time.Time
}
type actionGrant struct {
	Session, Action string
	Revision        int64
	Expires         time.Time
}
type Authentication struct {
	Password  string `json:"password,omitempty"`
	Challenge string `json:"challenge,omitempty"`
	Code      string `json:"code,omitempty"`
	Recovery  string `json:"recovery_code,omitempty"`
	Action    string `json:"action,omitempty"`
}
type AuthenticationResult struct {
	Challenge    string  `json:"challenge,omitempty"`
	Grant        string  `json:"grant,omitempty"`
	Token        string  `json:"-"`
	Device       *Device `json:"device,omitempty"`
	RecoveryUsed bool    `json:"recovery_used,omitempty"`
}
type SetupResult struct {
	Operation string   `json:"operation"`
	Secret    string   `json:"secret,omitempty"`
	URI       string   `json:"uri,omitempty"`
	Codes     []string `json:"recovery_codes,omitempty"`
}

type Security struct {
	Configured        bool  `json:"configured"`
	RecoveryPending   bool  `json:"recovery_pending"`
	Revision          int64 `json:"revision,omitempty"`
	RecoveryRemaining int   `json:"recovery_remaining,omitempty"`
}

func (c *Center) Security() Security { c.mu.Lock(); defer c.mu.Unlock(); return c.securityLocked() }
func (c *Center) securityLocked() Security {
	return Security{Configured: len(c.state.PasswordHash) > 0 && c.state.Secret != "", RecoveryPending: c.state.RecoveryPending, Revision: c.state.Revision, RecoveryRemaining: len(c.state.RecoveryHashes)}
}

// OwnerBootstrap is called exclusively from the verified OS-owner socket or an
// offline command holding the Center state lock. It is not an HTTP API action.
func (c *Center) OwnerBootstrap(recover bool) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.securityLocked().Configured && !recover {
		return "", ErrDenied
	}
	next := c.state
	if recover {
		next.RecoveryPending = true
		next.Revision++
	}
	token := randomID()
	next.BootstrapHash = digest(token)
	next.BootstrapExpiry = c.now().Add(SetupLifetime).UnixMilli()
	c.auditLocked(&next, "owner_setup", "issued", "")
	if err := c.saveLocked(next); err != nil {
		return "", err
	}
	c.revokeAllLocked()
	c.setups = map[string]*setupOperation{}
	c.bootstrapHash = next.BootstrapHash
	c.bootstrapExpiry = time.UnixMilli(next.BootstrapExpiry)
	return token, nil
}
func validPassword(p string) bool {
	return len([]byte(p)) >= 12 && len([]byte(p)) <= 72 && strings.TrimSpace(p) != "" && !strings.ContainsRune(p, 0)
}
func (c *Center) beginAuth() bool {
	select {
	case c.authBudget <- struct{}{}:
		return true
	default:
		return false
	}
}
func (c *Center) endAuth() { <-c.authBudget }
func (c *Center) SetupStart(bootstrap, browser, password string) (SetupResult, error) {
	if !c.beginAuth() {
		return SetupResult{}, ErrBusy
	}
	defer c.endAuth()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pruneLocked()
	if browser == "" || c.closed || digest(bootstrap) != c.bootstrapHash || !c.now().Before(c.bootstrapExpiry) || len(c.setups) >= 8 {
		return SetupResult{}, ErrDenied
	}
	if err := passwordPolicy(password); err != nil {
		return SetupResult{}, err
	}
	if result, found, err := c.retrySetupStartLocked(browser, password); found {
		return result, err
	}
	revision := c.state.Revision
	c.mu.Unlock()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	c.mu.Lock()
	if c.closed || revision != c.state.Revision || digest(bootstrap) != c.bootstrapHash || !c.now().Before(c.bootstrapExpiry) {
		return SetupResult{}, ErrExpired
	}
	if err != nil {
		return SetupResult{}, err
	}
	if result, found, err := c.retrySetupStartLocked(browser, password); found {
		return result, err
	}
	return c.newSetupLocked(browser, c.bootstrapHash, "", "setup", hash)
}

func (c *Center) retrySetupStartLocked(browser, password string) (SetupResult, bool, error) {
	for _, op := range c.setups {
		if op.Action != "setup" || op.Bootstrap != c.bootstrapHash || op.Revision != c.state.Revision || !c.now().Before(op.Expires) {
			continue
		}
		if op.Browser != browser || bcrypt.CompareHashAndPassword(op.PasswordHash, []byte(password)) != nil {
			return SetupResult{}, true, ErrDenied
		}
		return SetupResult{Operation: op.Token, Secret: op.Secret, URI: op.URI}, true, nil
	}
	return SetupResult{}, false, nil
}
func (c *Center) newSetupLocked(browser, bootstrap, session, action string, hash []byte) (SetupResult, error) {
	if len(c.setups) >= 8 {
		return SetupResult{}, ErrBusy
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: "Redeven Env Center", AccountName: c.key.Origin, SecretSize: 20})
	if err != nil {
		return SetupResult{}, err
	}
	token := randomID()
	op := &setupOperation{Browser: browser, Bootstrap: bootstrap, Session: session, Action: action, Secret: key.Secret(), PasswordHash: hash, Revision: c.state.Revision, Expires: c.now().Add(SetupLifetime), Step: -1}
	op.Token, op.URI = token, key.URL()
	for range 8 {
		code := randomID()
		op.Codes = append(op.Codes, code)
		op.Hashes = append(op.Hashes, digest(c.key.Instance+":"+code))
	}
	c.setups[digest(token)] = op
	return SetupResult{Operation: token, Secret: key.Secret(), URI: key.URL()}, nil
}
func (c *Center) setupLocked(token, browser, session string) (*setupOperation, error) {
	op := c.setups[digest(token)]
	if op == nil || op.Browser != browser || op.Session != session || op.Revision != c.state.Revision || !c.now().Before(op.Expires) {
		return nil, ErrExpired
	}
	if op.Action == "setup" && (op.Bootstrap != c.bootstrapHash || !c.now().Before(c.bootstrapExpiry)) {
		return nil, ErrExpired
	}
	if op.Session != "" {
		if _, err := c.sessionLocked(op.Session); err != nil {
			return nil, err
		}
	}
	return op, nil
}
func (c *Center) SetupVerify(token, browser, session, code string) (SetupResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	op, err := c.setupLocked(token, browser, session)
	if err != nil {
		return SetupResult{}, err
	}
	if op.Attempts >= 5 {
		return SetupResult{}, ErrExpired
	}
	if c.blockedLocked("setup") {
		return SetupResult{}, ErrBusy
	}
	if op.Verified && (op.Action == "recovery_rotate" || digest(code) != op.CodeHash) {
		return SetupResult{}, ErrFactor
	}
	if !op.Verified {
		step, ok := matchingStep(op.Secret, code, c.now())
		if !ok {
			op.Attempts++
			if op.Attempts >= 5 {
				delete(c.setups, digest(token))
			}
			_ = c.failureLocked("setup")
			return SetupResult{}, ErrFactor
		}
		op.Verified = true
		op.Step = step
		op.CodeHash = digest(code)
	}
	return SetupResult{Operation: token, Codes: append([]string(nil), op.Codes...)}, nil
}
func (c *Center) SetupCommit(token, browser, session string, saved bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if receipt := c.setupReceipt; saved && receipt != nil && !c.closed && receipt.Operation == digest(token) && receipt.Browser == browser && receipt.Session == digest(session) && receipt.Revision == c.state.Revision && c.now().Before(receipt.Expires) {
		return nil
	}
	op, err := c.setupLocked(token, browser, session)
	if err != nil {
		return err
	}
	if !saved || !op.Verified {
		return ErrDenied
	}
	next := c.state
	next.Revision++
	next.Secret = op.Secret
	next.RecoveryHashes = append([]string(nil), op.Hashes...)
	if op.Action != "recovery_rotate" {
		next.LastStep = op.Step
		next.LastCodeHash = op.CodeHash
		next.LastCodeUntil = (op.Step + 2) * 30
	}
	next.RecoveryPending = false
	next.BootstrapHash = ""
	next.BootstrapExpiry = 0
	next.Failures = map[string]throttle{}
	if len(op.PasswordHash) > 0 {
		next.PasswordHash = op.PasswordHash
	}
	if len(next.PasswordHash) == 0 {
		return ErrDenied
	}
	c.auditLocked(&next, op.Action, "committed", "")
	if err = c.saveLocked(next); err != nil {
		return err
	}
	c.bootstrapHash = ""
	c.setups = map[string]*setupOperation{}
	c.revokeAllLocked()
	c.setupReceipt = &setupCommitReceipt{Operation: digest(token), Browser: browser, Session: digest(session), Revision: c.state.Revision, Expires: c.now().Add(SetupLifetime)}
	return nil
}
func (c *Center) SetupCancel(token, browser, session string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.setupLocked(token, browser, session); err == nil {
		delete(c.setups, digest(token))
	}
}

func matchingStep(secret, code string, now time.Time) (int64, bool) {
	if len(code) != 6 {
		return -1, false
	}
	step := now.Unix() / 30
	matched := int64(-1)
	for offset := int64(-1); offset <= 1; offset++ {
		candidate, err := totp.GenerateCodeCustom(secret, time.Unix((step+offset)*30, 0), totp.ValidateOpts{Period: 30, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1})
		if err == nil && subtle.ConstantTimeCompare([]byte(candidate), []byte(code)) == 1 {
			matched = step + offset
		}
	}
	return matched, matched >= 0
}
func (c *Center) factorLocked(code, recovery string) (bool, error) {
	next := c.state
	now := c.now()
	usedRecovery := false
	if recovery != "" && code == "" {
		hash := digest(c.key.Instance + ":" + strings.TrimSpace(recovery))
		index := -1
		for i, h := range next.RecoveryHashes {
			if subtle.ConstantTimeCompare([]byte(hash), []byte(h)) == 1 {
				index = i
			}
		}
		if index < 0 {
			return false, ErrFactor
		}
		next.RecoveryHashes = append(append([]string(nil), next.RecoveryHashes[:index]...), next.RecoveryHashes[index+1:]...)
		usedRecovery = true
	} else if code != "" && recovery == "" {
		step, ok := matchingStep(next.Secret, code, now)
		if !ok || step <= next.LastStep || now.Unix() < next.LastCodeUntil && digest(code) == next.LastCodeHash {
			return false, ErrFactor
		}
		next.LastStep = step
		next.LastCodeHash = digest(code)
		next.LastCodeUntil = (step + 2) * 30
	} else {
		return false, ErrFactor
	}
	if usedRecovery {
		c.auditLocked(&next, "recovery_code", "consumed", "")
	} else {
		c.auditLocked(&next, "factor", "accepted", "")
	}
	if err := c.saveLocked(next); err != nil {
		return false, err
	}
	return usedRecovery, nil
}
func (c *Center) blockedLocked(source string) bool {
	now := c.now().UnixMilli()
	return now < c.state.Failures["administrator"].Until || now < c.state.Failures[source].Until
}
func (c *Center) failureLocked(source string) error {
	next := c.state
	next.Failures = make(map[string]throttle, len(c.state.Failures)+2)
	now := c.now()
	for k, v := range c.state.Failures {
		if now.UnixMilli()-v.Last < 3600000 {
			next.Failures[k] = v
		}
	}
	for _, key := range []string{"administrator", source} {
		v := next.Failures[key]
		v.Failures++
		v.Last = now.UnixMilli()
		delay := time.Duration(0)
		if v.Failures >= 5 {
			shift := min(v.Failures-5, 6)
			delay = time.Second * time.Duration(1<<shift)
		}
		v.Until = now.Add(delay).UnixMilli()
		next.Failures[key] = v
	}
	if len(next.Failures) > 128 {
		for k := range next.Failures {
			if k != "administrator" && k != source {
				delete(next.Failures, k)
				break
			}
		}
	}
	c.auditLocked(&next, "authentication", "denied", "")
	return c.saveLocked(next)
}
func (c *Center) Authenticate(browser, session, source, label string, req Authentication) (AuthenticationResult, error) {
	if !c.beginAuth() {
		return AuthenticationResult{}, ErrBusy
	}
	defer c.endAuth()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pruneLocked()
	if c.closed || browser == "" || !c.securityLocked().Configured || c.state.RecoveryPending {
		return AuthenticationResult{}, ErrDenied
	}
	source = digest(source)
	if c.blockedLocked(source) {
		return AuthenticationResult{}, ErrBusy
	}
	if req.Challenge == "" {
		if req.Code != "" || req.Recovery != "" || len(req.Password) > 72 || len(req.Password) < 1 {
			return AuthenticationResult{}, ErrDenied
		}
		if len(c.challenges) >= 64 {
			return AuthenticationResult{}, ErrBusy
		}
		if req.Action != "" {
			if len(req.Action) > 512 {
				return AuthenticationResult{}, ErrDenied
			}
			if _, err := c.sessionLocked(session); err != nil {
				return AuthenticationResult{}, err
			}
		}
		revision := c.state.Revision
		passwordHash := append([]byte(nil), c.state.PasswordHash...)
		c.mu.Unlock()
		compareErr := bcrypt.CompareHashAndPassword(passwordHash, []byte(req.Password))
		c.mu.Lock()
		if c.closed || c.state.RecoveryPending || revision != c.state.Revision {
			return AuthenticationResult{}, ErrDenied
		}
		if req.Action != "" {
			if _, err := c.sessionLocked(session); err != nil {
				return AuthenticationResult{}, err
			}
		}
		if c.blockedLocked(source) || len(c.challenges) >= 64 {
			return AuthenticationResult{}, ErrBusy
		}
		if err := compareErr; err != nil {
			if err = c.failureLocked(source); err != nil {
				return AuthenticationResult{}, err
			}
			return AuthenticationResult{}, ErrDenied
		}
		token := randomID()
		c.challenges[digest(token)] = &challenge{Browser: browser, Session: session, Action: req.Action, Revision: c.state.Revision, Expires: c.now().Add(ChallengeLifetime)}
		return AuthenticationResult{Challenge: token}, nil
	}
	ch := c.challenges[digest(req.Challenge)]
	if ch == nil || ch.Browser != browser || ch.Session != session || ch.Action != req.Action || ch.Revision != c.state.Revision || !c.now().Before(ch.Expires) || ch.Attempts >= 5 || req.Password != "" {
		return AuthenticationResult{}, ErrExpired
	}
	if ch.Action != "" {
		if _, err := c.sessionLocked(session); err != nil {
			return AuthenticationResult{}, err
		}
	}
	used, err := c.factorLocked(req.Code, req.Recovery)
	if err != nil {
		ch.Attempts++
		if ch.Attempts >= 5 {
			delete(c.challenges, digest(req.Challenge))
		}
		if e := c.failureLocked(source); e != nil {
			return AuthenticationResult{}, e
		}
		return AuthenticationResult{}, err
	}
	delete(c.challenges, digest(req.Challenge))
	next := c.state
	next.Failures = map[string]throttle{}
	if ch.Action != "" {
		c.auditLocked(&next, "sensitive_authentication", "succeeded", ch.Action)
	} else {
		c.auditLocked(&next, "authentication", "succeeded", "")
	}
	if err = c.saveLocked(next); err != nil {
		return AuthenticationResult{}, err
	}
	if ch.Action != "" {
		if len(c.grants) >= 64 {
			return AuthenticationResult{}, ErrBusy
		}
		token := randomID()
		c.grants[digest(token)] = &actionGrant{Session: session, Action: ch.Action, Revision: c.state.Revision, Expires: c.now().Add(GrantLifetime)}
		return AuthenticationResult{Grant: token, RecoveryUsed: used}, nil
	}
	if len(c.sessions) >= MaxDevices {
		return AuthenticationResult{}, ErrBusy
	}
	token := randomID()
	ctx, cancel := context.WithCancel(context.Background())
	now := c.now()
	d := &deviceSession{ID: randomID(), Device: randomID(), Label: strings.TrimSpace(label), Created: now, Activity: now, Absolute: now.Add(SessionAbsolute), Revision: c.state.Revision, Context: ctx, cancel: cancel}
	if len(d.Label) > 120 {
		d.Label = d.Label[:120]
	}
	if d.Label == "" {
		d.Label = "Browser"
	}
	c.sessions[digest(token)] = d
	c.scheduleLocked(digest(token), d)
	device := c.deviceLocked(d, true)
	return AuthenticationResult{Token: token, Device: &device, RecoveryUsed: used}, nil
}
func (c *Center) grantLocked(session, token, action string) error {
	if _, err := c.sessionLocked(session); err != nil {
		return err
	}
	g := c.grants[digest(token)]
	if g == nil || g.Session != session || g.Action != action || g.Revision != c.state.Revision || !c.now().Before(g.Expires) {
		return ErrDenied
	}
	delete(c.grants, digest(token))
	return nil
}
func (c *Center) ChangePassword(session, grant, password string) error {
	if err := passwordPolicy(password); err != nil {
		return err
	}
	if !c.beginAuth() {
		return ErrBusy
	}
	defer c.endAuth()
	c.mu.Lock()
	defer c.mu.Unlock()
	d, err := c.sessionLocked(session)
	if err != nil {
		return err
	}
	device := d.ID
	c.mu.Unlock()
	action := passwordAction(password, device)
	c.mu.Lock()
	if err := c.grantLocked(session, grant, action); err != nil {
		return err
	}
	revision := c.state.Revision
	c.mu.Unlock()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	c.mu.Lock()
	if _, e := c.sessionLocked(session); e != nil || revision != c.state.Revision {
		return ErrDenied
	}
	if err != nil {
		return err
	}
	next := c.state
	next.PasswordHash = hash
	next.Revision++
	c.auditLocked(&next, "password", "changed", "")
	if err = c.saveLocked(next); err != nil {
		return err
	}
	c.revokeAllLocked()
	return nil
}

// Step-up binds the exact password without exposing a fast reusable fingerprint.
// Device IDs are random per login. The persisted verifier remains salted bcrypt.
// The browser derives the same value with Web Crypto.
func passwordAction(password, device string) string {
	key := pbkdf2.Key([]byte(password), []byte("redeven:center:password:"+device), 600000, 32, sha256.New)
	return "password:pbkdf2-sha256-v1:" + base64.RawURLEncoding.EncodeToString(key)
}
func (c *Center) ReplaceFactor(browser, session, grant string) (SetupResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.grantLocked(session, grant, "factor:replace"); err != nil {
		return SetupResult{}, err
	}
	return c.newSetupLocked(browser, "", session, "factor_replace", nil)
}
func (c *Center) RotateRecovery(browser, session, grant string) (SetupResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pruneLocked()
	if len(c.setups) >= 8 {
		return SetupResult{}, ErrBusy
	}
	if err := c.grantLocked(session, grant, "recovery:rotate"); err != nil {
		return SetupResult{}, err
	}
	token := randomID()
	op := &setupOperation{Browser: browser, Session: session, Action: "recovery_rotate", Secret: c.state.Secret, Revision: c.state.Revision, Expires: c.now().Add(SetupLifetime), Verified: true}
	for range 8 {
		code := randomID()
		op.Codes = append(op.Codes, code)
		op.Hashes = append(op.Hashes, digest(c.key.Instance+":"+code))
	}
	c.setups[digest(token)] = op
	return SetupResult{Operation: token, Codes: append([]string(nil), op.Codes...)}, nil
}
func (c *Center) sessionLocked(token string) (*deviceSession, error) {
	d := c.sessions[digest(token)]
	if d == nil {
		return nil, ErrDenied
	}
	if c.closed || c.state.RecoveryPending || d.Revision != c.state.Revision || !c.now().Before(d.Absolute) || !c.now().Before(d.Activity.Add(SessionIdle)) || d.Context.Err() != nil {
		c.revokeLocked(digest(token))
		return nil, ErrDenied
	}
	return d, nil
}
func (c *Center) scheduleLocked(hash string, d *deviceSession) {
	if d.timer != nil {
		d.timer.Stop()
	}
	deadline := d.Activity.Add(SessionIdle)
	if d.Absolute.Before(deadline) {
		deadline = d.Absolute
	}
	d.timerGeneration++
	generation := d.timerGeneration
	d.timer = time.AfterFunc(max(deadline.Sub(c.now()), 0), func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if current := c.sessions[hash]; current == d && current.timerGeneration == generation {
			c.revokeLocked(hash)
		}
	})
}
func (c *Center) deviceLocked(d *deviceSession, current bool) Device {
	expiry := d.Activity.Add(SessionIdle)
	if d.Absolute.Before(expiry) {
		expiry = d.Absolute
	}
	return Device{ID: d.ID, Label: d.Label, Created: d.Created.UnixMilli(), Activity: d.Activity.UnixMilli(), Expires: expiry.UnixMilli(), Current: current}
}
func (c *Center) Session(token string) (Device, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	d, err := c.sessionLocked(token)
	if err != nil {
		return Device{}, err
	}
	return c.deviceLocked(d, true), nil
}
func (c *Center) Activity(token string) (Device, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	d, err := c.sessionLocked(token)
	if err != nil {
		return Device{}, err
	}
	d.Activity = c.now()
	c.scheduleLocked(digest(token), d)
	return c.deviceLocked(d, true), nil
}
func (c *Center) Devices(token string) ([]Device, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	d, err := c.sessionLocked(token)
	if err != nil {
		return nil, err
	}
	c.pruneLocked()
	out := []Device{}
	for _, v := range c.sessions {
		out = append(out, c.deviceLocked(v, v == d))
	}
	return out, nil
}
func (c *Center) Revoke(token, target string, all bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	d, err := c.sessionLocked(token)
	if err != nil {
		return err
	}
	if target == "" {
		target = d.ID
	}
	next := c.state
	c.auditLocked(&next, "device_revoke", "committed", target)
	if err = c.saveLocked(next); err != nil {
		return err
	}
	for hash, v := range c.sessions {
		if all || v.ID == target {
			c.revokeLocked(hash)
		}
	}
	return nil
}
func (c *Center) revokeLocked(hash string) {
	if d := c.sessions[hash]; d != nil {
		d.cancel()
		if d.timer != nil {
			d.timer.Stop()
		}
		delete(c.sessions, hash)
		for key, ch := range c.challenges {
			if digest(ch.Session) == hash {
				delete(c.challenges, key)
			}
		}
		for key, g := range c.grants {
			if digest(g.Session) == hash {
				delete(c.grants, key)
			}
		}
		for key, op := range c.setups {
			if digest(op.Session) == hash {
				delete(c.setups, key)
			}
		}
	}
}
func (c *Center) revokeAllLocked() {
	for hash := range c.sessions {
		c.revokeLocked(hash)
	}
	c.challenges = map[string]*challenge{}
	c.grants = map[string]*actionGrant{}
}
func (c *Center) pruneLocked() {
	now := c.now()
	for k, ch := range c.challenges {
		if !now.Before(ch.Expires) {
			delete(c.challenges, k)
		}
	}
	for k, op := range c.setups {
		if !now.Before(op.Expires) {
			delete(c.setups, k)
		}
	}
	for k, g := range c.grants {
		if !now.Before(g.Expires) {
			delete(c.grants, k)
		}
	}
	for k, d := range c.sessions {
		if !now.Before(d.Absolute) || !now.Before(d.Activity.Add(SessionIdle)) {
			c.revokeLocked(k)
		}
	}
}
