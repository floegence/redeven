package appserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type localHostAccessKey struct{}

var errChatGPTLocalOnly = errors.New("ChatGPT authentication must be managed on this device")

// WithVerifiedLocalHost is called only after authenticated native host admission.
// The native owner checks its actual host_access; public/renderer headers cannot
// establish this context, and SSH/Gateway/private placement alone cannot grant it.
func WithVerifiedLocalHost(r *http.Request, owner string) *http.Request {
	digest := sha256.Sum256([]byte(owner))
	return r.WithContext(context.WithValue(r.Context(), localHostAccessKey{}, hex.EncodeToString(digest[:])))
}

func VerifiedLocalHost(r *http.Request) string {
	owner, _ := r.Context().Value(localHostAccessKey{}).(string)
	return owner
}

type authCapability struct {
	Available bool   `json:"available"`
	BindingID string `json:"binding_id,omitempty"`
	Reason    string `json:"reason,omitempty"`
}
type authCapabilities struct {
	OpenAIChatGPT authCapability `json:"openai_chatgpt"`
}

func localAuthCapabilities(meta *session.Meta) authCapabilities {
	if meta != nil && meta.CanAdmin && meta.LocalHostAccess != "" {
		digest := sha256.Sum256([]byte(meta.LocalHostAccess + "\x00" + meta.ChannelID))
		return authCapabilities{OpenAIChatGPT: authCapability{Available: true, BindingID: hex.EncodeToString(digest[:16])}}
	}
	return authCapabilities{OpenAIChatGPT: authCapability{Reason: "local_host_required"}}
}

// Remote API-key edits may preserve an existing account binding, but cannot
// create, change, remove or copy ChatGPT authentication to another connection.
func preservesChatGPTBindings(previous *config.AIConfig, next config.AIModelProfile) bool {
	saved := map[string]string{}
	if previous != nil {
		for _, p := range previous.Providers {
			if p.EffectiveAuthMethod() == config.AIAuthChatGPT {
				saved[p.ID] = p.AccountID
			}
		}
	}
	for _, p := range next.Providers {
		if p.EffectiveAuthMethod() == config.AIAuthChatGPT {
			if account, ok := saved[p.ID]; !ok || account != p.AccountID {
				return false
			}
			delete(saved, p.ID)
		}
	}
	return len(saved) == 0
}

func (g *Server) handleChatGPTAuth(w http.ResponseWriter, r *http.Request) {
	meta, ok := g.requirePermission(w, r, requiredPermissionAdmin)
	if !ok {
		return
	}
	if !localAuthCapabilities(meta).OpenAIChatGPT.Available {
		writeJSON(w, http.StatusForbidden, apiResp{OK: false, Error: "ChatGPT sign-in is available only on this device.", ErrorCode: "chatgpt_local_only"})
		return
	}
	if g.chatGPT == nil {
		writeJSON(w, 503, apiResp{OK: false, Error: "local account storage is unavailable"})
		return
	}
	if r.URL.Path == "/_redeven_proxy/api/ai/auth/chatgpt/accounts" {
		if r.Method != http.MethodGet || r.URL.RawQuery != "" {
			writeJSON(w, 405, apiResp{OK: false, Error: "method not allowed"})
			return
		}
		cfg, err := g.loadConfigLocked()
		if err != nil {
			writeJSON(w, 503, apiResp{OK: false, ErrorCode: "storage_unavailable", Error: "Account status is unavailable."})
			return
		}
		out := map[string]chatgpt.AccountStatus{}
		counts := map[string]int{}
		if cfg.AI != nil {
			for _, p := range cfg.AI.Providers {
				if p.EffectiveAuthMethod() == config.AIAuthChatGPT {
					counts[p.AccountID]++
				}
			}
		}
		if cfg.AI != nil {
			for _, p := range cfg.AI.Providers {
				if p.EffectiveAuthMethod() != config.AIAuthChatGPT {
					continue
				}
				status, err := g.chatGPT.Status(p.AccountID)
				if err != nil {
					status = chatgpt.AccountStatus{AccountID: p.AccountID, State: "storage_unavailable", ErrorCode: "storage_unavailable"}
				}
				status.BindingCount = counts[p.AccountID]
				out[p.ID] = status
			}
		}
		if g.aiProvider != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 50*time.Millisecond)
			svc, _, _, release, err := g.aiProvider.AcquireAIService(ctx)
			if release != nil {
				defer release()
			}
			if err == nil && svc != nil {
				for id, status := range out {
					status.ActiveTaskCount = svc.AccountTaskCount(status.AccountID)
					out[id] = status
				}
			}
			cancel()
		}
		saved := []chatgpt.AccountStatus{}
		var signOuts []chatgpt.SignOutResult
		accounts, readErr := g.secrets.ChatGPTAccounts(r.Context())
		if readErr != nil {
			writeJSON(w, 503, apiResp{OK: false, ErrorCode: "storage_unavailable", Error: "Account status is unavailable."})
			return
		}
		for id, account := range accounts {
			status, err := g.chatGPT.Status(id)
			if err != nil {
				writeJSON(w, 503, apiResp{OK: false, ErrorCode: "storage_unavailable", Error: "Account status is unavailable."})
				return
			}
			status.BindingCount = counts[id]
			for _, bound := range out {
				if bound.AccountID == id {
					status.ActiveTaskCount = bound.ActiveTaskCount
					break
				}
			}
			saved = append(saved, status)
			if counts[id] != 0 || account.Lifecycle != "signing_out" && account.Lifecycle != "signed_out" {
				continue
			}
			confirmed := account.RevocationConfirmed != nil && *account.RevocationConfirmed
			complete := account.Lifecycle == "signed_out"
			if !complete || !confirmed {
				signOuts = append(signOuts, chatgpt.SignOutResult{AccountID: id, LocalCleanupComplete: complete, RevocationConfirmed: confirmed, ErrorCode: account.ErrorCode})
			}
		}
		sort.Slice(saved, func(i, j int) bool {
			if saved[i].Email != saved[j].Email {
				return saved[i].Email < saved[j].Email
			}
			return saved[i].AccountID < saved[j].AccountID
		})
		sort.Slice(signOuts, func(i, j int) bool { return signOuts[i].AccountID < signOuts[j].AccountID })
		writeJSON(w, 200, apiResp{OK: true, Data: struct {
			SavedAccounts []chatgpt.AccountStatus          `json:"saved_accounts"`
			Accounts      map[string]chatgpt.AccountStatus `json:"accounts"`
			SignOuts      []chatgpt.SignOutResult          `json:"account_sign_outs"`
		}{saved, out, signOuts}})
		return
	}
	var body struct {
		AttemptID         string `json:"attempt_id,omitempty"`
		PreviousAttemptID string `json:"previous_attempt_id,omitempty"`
		AccountID         string `json:"account_id,omitempty"`
		Reconsent         bool   `json:"reconsent,omitempty"`
		NewRegistration   bool   `json:"new_registration,omitempty"`
		ScopeID           string `json:"scope_id"`
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, apiResp{OK: false, Error: "method not allowed"})
		return
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if dec.Decode(&body) != nil || dec.Decode(&struct{}{}) != io.EOF || body.ScopeID == "" || len(body.ScopeID) > 128 || strings.ContainsAny(body.ScopeID, "\x00\r\n") {
		writeJSON(w, 400, apiResp{OK: false, Error: "invalid authorization request"})
		return
	}
	owner := meta.LocalHostAccess + ":" + meta.ChannelID + ":" + body.ScopeID
	var out any
	var err error
	switch r.URL.Path {
	case "/_redeven_proxy/api/ai/auth/chatgpt/start":
		out, err = g.chatGPT.Start(owner, chatgpt.SignInOptions{AccountID: body.AccountID, Reconsent: body.Reconsent, PreviousAttemptID: body.PreviousAttemptID, NewRegistration: body.NewRegistration})
	case "/_redeven_proxy/api/ai/auth/chatgpt/status":
		out, err = g.chatGPT.Poll(owner, body.AttemptID)
	case "/_redeven_proxy/api/ai/auth/chatgpt/cancel":
		g.chatGPT.Cancel(owner, body.AttemptID)
		out = struct{}{}
	case "/_redeven_proxy/api/ai/auth/chatgpt/sign-out", "/_redeven_proxy/api/ai/auth/chatgpt/acknowledge", "/_redeven_proxy/api/ai/auth/chatgpt/retry":
		// Account actions belong to the canonical local registry, independently
		// of connection configuration or its current availability.
		_, exists, readErr := g.secrets.ChatGPTAccount(body.AccountID)
		if readErr != nil {
			err = chatgpt.Failure("storage_unavailable")
			break
		}
		if !exists {
			err = chatgpt.Failure("authorization_required")
			break
		}
		if strings.HasSuffix(r.URL.Path, "sign-out") {
			// Once accepted, the Runtime owns completion even if the UI disconnects.
			result, signOutErr := g.chatGPT.SignOutAccount(context.Background(), body.AccountID)
			if signOutErr != nil && result.ErrorCode == "" {
				result.ErrorCode = "storage_unavailable"
			}
			out = result
		} else if strings.HasSuffix(r.URL.Path, "retry") {
			err = g.chatGPT.RetryAccount(r.Context(), body.AccountID)
			out, _ = g.chatGPT.Status(body.AccountID)
		} else {
			err = g.chatGPT.Acknowledge(r.Context(), body.AccountID)
			out = struct{}{}
		}
	default:
		writeJSON(w, 404, apiResp{OK: false, Error: "authorization route not found"})
		return
	}
	if err != nil {
		code := "chatgpt_authorization_failed"
		var failure *chatgpt.Error
		if errors.As(err, &failure) {
			code = failure.Code
		}
		writeJSON(w, 400, apiResp{OK: false, Error: "ChatGPT authorization could not complete.", ErrorCode: code})
		return
	}
	writeJSON(w, 200, apiResp{OK: true, Data: out})
}

func (g *Server) CancelChatGPTForChannel(channelID string) {
	if g != nil && g.chatGPT != nil {
		g.chatGPT.CancelChannel(channelID)
	}
}

// Configuration and logout have separate outcomes. No draft or failed save
// reaches this path; disabled connections continue to count as bindings.
func (g *Server) signOutRemovedAccounts(previous, next *config.AIConfig) []chatgpt.SignOutResult {
	refs := func(cfg *config.AIConfig) map[string]bool {
		out := map[string]bool{}
		if cfg != nil {
			for _, p := range cfg.Providers {
				if p.EffectiveAuthMethod() == config.AIAuthChatGPT {
					out[p.AccountID] = true
				}
			}
		}
		return out
	}
	old, current := refs(previous), refs(next)
	var results []chatgpt.SignOutResult
	ids := make([]string, 0, len(old))
	for id := range old {
		if !current[id] {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	results = make([]chatgpt.SignOutResult, len(ids))
	var operations sync.WaitGroup
	for index, id := range ids {
		operations.Add(1)
		go func() {
			defer operations.Done()
			result, err := g.chatGPT.SignOutAccount(context.Background(), id)
			if err != nil && result.ErrorCode == "" {
				result.ErrorCode = "storage_unavailable"
			}
			results[index] = result
		}()
	}
	operations.Wait()
	return results
}
