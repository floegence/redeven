package ai

import (
	"context"
	"crypto/sha256"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	"github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
)

func TestPublishedFloretV7MigratesTargetThreadCopyAndAcceptsNewTurn(t *testing.T) {
	sourcePath := os.Getenv("REDEVEN_FLOWER_MIGRATION_DB")
	threadID := os.Getenv("REDEVEN_FLOWER_MIGRATION_THREAD_ID")
	if sourcePath == "" || threadID == "" {
		t.Skip("set REDEVEN_FLOWER_MIGRATION_DB and REDEVEN_FLOWER_MIGRATION_THREAD_ID for opt-in qualification")
	}
	sourceHash, err := targetThreadFileSHA256(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	copyPath := filepath.Join(t.TempDir(), "target-thread.sqlite")
	if err := copyTargetThreadFile(sourcePath, copyPath); err != nil {
		t.Fatal(err)
	}

	gateway := florettest.NewScriptedGateway(
		flprovider.Identity{Provider: "qualification", Model: "v7", StateCompatibilityKey: "qualification:v7"},
		flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported},
		florettest.Step{Events: []flprovider.Event{
			{Type: flprovider.EventDelta, Text: "target thread continued"},
			{Type: flprovider.EventDone, Reason: "stop"},
		}},
	)
	host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(copyPath)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = host.Shutdown(context.Background()) })
	service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
		return flruntime.NewAgent(config.AgentConfig{
			Profile:      config.AgentProfile{ID: "target-thread-qualification", Name: "Target Thread Qualification"},
			SystemPrompt: "Continue the migrated thread using the current Redeven surface.",
			Context:      config.ContextPolicy{ContextWindowTokens: config.DefaultContextWindowTokens},
		}, gateway)
	}))
	if err != nil {
		t.Fatal(err)
	}

	typedThreadID := identity.ThreadID(threadID)
	before, err := service.View(t.Context(), typedThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Items) == 0 {
		t.Fatal("migrated target thread has no historical items")
	}
	prefixIDs := make([]string, len(before.Items))
	for index, item := range before.Items {
		prefixIDs[index] = item.ID
	}

	if _, err := service.Send(t.Context(), flruntime.SendInput{
		ThreadID:   typedThreadID,
		Input:      flruntime.UserInput{Text: "Continue this migrated thread with the current version."},
		RequestKey: "redeven-v7-target-thread-new-turn",
	}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		after, viewErr := service.View(t.Context(), typedThreadID)
		if viewErr != nil {
			t.Fatal(viewErr)
		}
		if after.Activity == flruntime.ThreadActivityIdle && len(after.Items) >= len(prefixIDs)+2 {
			for index, id := range prefixIDs {
				if after.Items[index].ID != id {
					t.Fatalf("historical item prefix changed at %d: got %q want %q", index, after.Items[index].ID, id)
				}
			}
			last := after.Items[len(after.Items)-1]
			if last.Kind != flruntime.ThreadItemAssistant || last.Text != "target thread continued" {
				t.Fatalf("new turn result=%#v", last)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("target thread did not complete a new turn: activity=%q items=%d failure=%#v", after.Activity, len(after.Items), after.Failure)
		}
		time.Sleep(10 * time.Millisecond)
	}

	afterSourceHash, err := targetThreadFileSHA256(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if sourceHash != afterSourceHash {
		t.Fatal("source database changed while qualifying its copy")
	}

	wantAskUserPairs := 0
	if raw := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_MIGRATION_EXPECT_ASK_USER_PAIRS")); raw != "" {
		wantAskUserPairs, err = strconv.Atoi(raw)
		if err != nil || wantAskUserPairs < 0 {
			t.Fatalf("invalid REDEVEN_FLOWER_MIGRATION_EXPECT_ASK_USER_PAIRS=%q", raw)
		}
	}
	if wantAskUserPairs > 0 {
		requests := gateway.Requests()
		if len(requests) != 1 {
			t.Fatalf("target thread provider requests=%d, want 1", len(requests))
		}
		calls := 0
		results := 0
		for _, message := range requests[0].Messages {
			for _, call := range message.ToolCalls {
				if call.Name == "ask_user" {
					calls++
				}
			}
			if message.ToolResult != nil && message.ToolResult.ToolName == "ask_user" {
				results++
			}
			if message.Role == flprovider.RoleUser && (strings.Contains(message.Text, "Agent requested user input") || strings.Contains(message.Text, `"interaction_response"`)) {
				t.Fatalf("target thread retained legacy interaction text: %#v", message)
			}
		}
		if calls != wantAskUserPairs || results != wantAskUserPairs {
			t.Fatalf("target thread ask_user pairs=(calls:%d results:%d), want %d: %#v", calls, results, wantAskUserPairs, requests[0].Messages)
		}
	}
}

func copyTargetThreadFile(sourcePath, destinationPath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()
	destination, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(destination, source); err != nil {
		_ = destination.Close()
		return err
	}
	return destination.Close()
}

func targetThreadFileSHA256(path string) ([sha256.Size]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return [sha256.Size]byte{}, err
	}
	var sum [sha256.Size]byte
	copy(sum[:], hash.Sum(nil))
	return sum, nil
}
