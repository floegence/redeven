package ai

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/floegence/redeven-agent/internal/settings"
	_ "modernc.org/sqlite"
)

func TestE2E_IntentRouting_DBConfiguredModelIdentityPrompt(t *testing.T) {
	t.Parallel()

	// This is an opt-in e2e test that uses the locally configured model in threads.sqlite.
	// It is skipped by default to keep CI deterministic and secret-free.
	if strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_DB_MODEL")) != "1" {
		t.Skip("set REDEVEN_AI_E2E_DB_MODEL=1 to enable this e2e test")
	}

	cfgPath := firstNonEmptyValue(
		strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_CONFIG_PATH")),
		defaultRedevenPath("config.json"),
	)
	secretsPath := firstNonEmptyValue(
		strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_SECRETS_PATH")),
		defaultRedevenPath("secrets.json"),
	)
	dbPath := firstNonEmptyValue(
		strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_DB_PATH")),
		defaultRedevenPath("ai", "threads.sqlite"),
	)

	modelID, err := latestThreadModelID(dbPath)
	if err != nil {
		t.Fatalf("load latest model_id from db: %v", err)
	}
	providerID, _, ok := strings.Cut(modelID, "/")
	if !ok || strings.TrimSpace(providerID) == "" {
		t.Fatalf("invalid model_id from db: %q", modelID)
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg == nil || cfg.AI == nil {
		t.Fatalf("config has no ai section: %s", cfgPath)
	}
	if !cfg.AI.IsAllowedModelID(modelID) {
		t.Fatalf("db model_id %q is not allowed by config %s", modelID, cfgPath)
	}

	secrets := settings.NewSecretsStore(secretsPath)
	if secrets == nil {
		t.Fatalf("init secrets store failed: %s", secretsPath)
	}
	key, keyOK, keyErr := secrets.GetAIProviderAPIKey(providerID)
	if keyErr != nil {
		t.Fatalf("load provider api key: %v", keyErr)
	}
	if !keyOK || strings.TrimSpace(key) == "" {
		t.Fatalf("missing api key for provider %q in %s", providerID, secretsPath)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	svc, err := NewService(Options{
		Logger:              logger,
		StateDir:            t.TempDir(),
		FSRoot:              t.TempDir(),
		Shell:               "bash",
		Config:              cfg.AI,
		RunMaxWallTime:      2 * time.Minute,
		RunIdleTimeout:      90 * time.Second,
		ToolApprovalTimeout: 30 * time.Second,
		ResolveProviderAPIKey: func(pid string) (string, bool, error) {
			return secrets.GetAIProviderAPIKey(pid)
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	meta := session.Meta{
		EndpointID:        "env_e2e_db_model",
		NamespacePublicID: "ns_e2e_db_model",
		ChannelID:         "ch_e2e_db_model",
		UserPublicID:      "u_e2e_db_model",
		UserEmail:         "u_e2e_db_model@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	for i := 0; i < 3; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)

		thread, createErr := svc.CreateThread(ctx, &meta, fmt.Sprintf("db-model-intent-e2e-%d", i), modelID, "")
		if createErr != nil {
			cancel()
			t.Fatalf("CreateThread(%d): %v", i, createErr)
		}

		runID := fmt.Sprintf("run_e2e_db_model_intent_%d", i)
		rr := httptest.NewRecorder()
		runErr := svc.StartRun(ctx, &meta, runID, RunStartRequest{
			ThreadID: thread.ThreadID,
			Model:    modelID,
			Input:    RunInput{Text: "你是谁"},
			Options:  RunOptions{MaxSteps: 1, Mode: "plan"},
		}, rr)
		if runErr != nil {
			cancel()
			t.Fatalf("StartRun(%d): %v", i, runErr)
		}

		runEvents, listErr := svc.ListRunEvents(ctx, &meta, runID, 2000)
		cancel()
		if listErr != nil {
			t.Fatalf("ListRunEvents(%d): %v", i, listErr)
		}

		classified := findRunEventPayload(t, runEvents.Events, "intent.classified")
		if got := strings.TrimSpace(fmt.Sprint(classified["intent"])); got != RunIntentSocial {
			t.Fatalf("attempt=%d intent=%q, want=%q", i, got, RunIntentSocial)
		}
		if got := strings.TrimSpace(fmt.Sprint(classified["intent_source"])); got != RunIntentSourceModel {
			t.Fatalf("attempt=%d intent_source=%q, want=%q", i, got, RunIntentSourceModel)
		}

		routed := findRunEventPayload(t, runEvents.Events, "intent.routed")
		if got := strings.TrimSpace(fmt.Sprint(routed["path"])); got != "social_responder" {
			t.Fatalf("attempt=%d routed_path=%q, want=%q", i, got, "social_responder")
		}

		for _, ev := range runEvents.Events {
			if strings.TrimSpace(ev.EventType) == "tool.call" {
				t.Fatalf("attempt=%d should not invoke tools on social intent", i)
			}
		}
	}
}

func latestThreadModelID(dbPath string) (string, error) {
	dbPath = strings.TrimSpace(dbPath)
	if dbPath == "" {
		return "", fmt.Errorf("missing db path")
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return "", err
	}
	defer db.Close()

	const q = `
SELECT model_id
FROM ai_threads
WHERE TRIM(model_id) != ''
ORDER BY updated_at_unix_ms DESC
LIMIT 1`

	var modelID string
	if err := db.QueryRow(q).Scan(&modelID); err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("no model_id found in ai_threads")
		}
		return "", err
	}
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return "", fmt.Errorf("latest model_id is empty")
	}
	return modelID, nil
}

func defaultRedevenPath(parts ...string) string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return filepath.Join(parts...)
	}
	all := make([]string, 0, len(parts)+2)
	all = append(all, home, ".redeven")
	all = append(all, parts...)
	return filepath.Join(all...)
}

func firstNonEmptyValue(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}
