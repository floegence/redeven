package appserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

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
	var body struct {
		AttemptID         string `json:"attempt_id,omitempty"`
		PreviousAttemptID string `json:"previous_attempt_id,omitempty"`
		AccountID         string `json:"account_id,omitempty"`
		Reconsent         bool   `json:"reconsent,omitempty"`
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
		out, err = g.chatGPT.StartWithDraft(owner, body.AccountID, body.Reconsent, body.PreviousAttemptID)
	case "/_redeven_proxy/api/ai/auth/chatgpt/status":
		out, err = g.chatGPT.Poll(owner, body.AttemptID)
	case "/_redeven_proxy/api/ai/auth/chatgpt/cancel":
		g.chatGPT.Cancel(owner, body.AttemptID)
		out = struct{}{}
	case "/_redeven_proxy/api/ai/auth/chatgpt/sign-out", "/_redeven_proxy/api/ai/auth/chatgpt/acknowledge":
		// Account actions are restricted to a currently configured binding.
		cfg, e := g.loadConfigLocked()
		if e != nil {
			err = e
			break
		}
		bound := false
		if cfg.AI != nil {
			for _, p := range cfg.AI.Providers {
				bound = bound || p.EffectiveAuthMethod() == config.AIAuthChatGPT && p.AccountID == body.AccountID
			}
		}
		if !bound {
			err = errors.New("ChatGPT account is not bound to this configuration")
			break
		}
		if strings.HasSuffix(r.URL.Path, "sign-out") {
			var confirmed bool
			confirmed, err = g.chatGPT.SignOut(r.Context(), body.AccountID)
			out = struct {
				RevocationConfirmed bool `json:"revocation_confirmed"`
			}{confirmed}
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
