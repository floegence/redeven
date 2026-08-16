package agent

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	flowercontrol "github.com/floegence/flowersec/flowersec-go/v2/controlplane"
	"github.com/floegence/redeven/internal/config"
)

type controlPoolTestCaller struct {
	mu                   sync.Mutex
	topUpResponse        json.RawMessage
	topUpResponseFactory func(requestID string) json.RawMessage
	ackResponse          json.RawMessage
	topUpError           error
	ackError             error
	calls                []uint32
	requestIDs           []string
}

func (caller *controlPoolTestCaller) Call(_ context.Context, typeID uint32, request, response any) error {
	caller.mu.Lock()
	defer caller.mu.Unlock()
	caller.calls = append(caller.calls, typeID)
	if typeID == controlRPCTypeControlPoolTopUp {
		var decoded controlArtifactPoolTopUpRequest
		if err := json.Unmarshal(mustJSON(request), &decoded); err == nil {
			caller.requestIDs = append(caller.requestIDs, decoded.TopUpRequestIDB64u)
		}
		if caller.topUpError != nil {
			return caller.topUpError
		}
		topUpResponse := caller.topUpResponse
		if caller.topUpResponseFactory != nil {
			topUpResponse = caller.topUpResponseFactory(decoded.TopUpRequestIDB64u)
		}
		*(response.(*json.RawMessage)) = append(json.RawMessage(nil), topUpResponse...)
		return nil
	}
	if typeID == controlRPCTypeControlPoolAck {
		if caller.ackError != nil {
			return caller.ackError
		}
		*(response.(*json.RawMessage)) = append(json.RawMessage(nil), caller.ackResponse...)
		return nil
	}
	return errors.New("unexpected control pool rpc")
}

func TestControlArtifactPoolResponseAndAckReplayAreIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	firstRaw, _ := issuePoolTestArtifact(t, "first")
	secondRaw, _ := issuePoolTestArtifact(t, "second")
	thirdRaw, thirdChannel := issuePoolTestArtifact(t, "third")
	fourthRaw, fourthChannel := issuePoolTestArtifact(t, "fourth")
	firstDigest := digestB64uForTest(firstRaw)
	secondDigest := digestB64uForTest(secondRaw)
	cfg := poolTestConfig(path, []config.ControlArtifactEntry{
		{Sequence: 1, ArtifactDigest: firstDigest, ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix(), Spent: true},
		{Sequence: 2, ArtifactJSON: secondRaw, ArtifactDigest: secondDigest, ChannelID: "second-channel", ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()},
	})
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: cfg, configPath: path, stateDir: t.TempDir()}
	response := makeControlPoolResponse(t, 7, "binding-1", []poolTestWireEntry{
		{ArtifactJSON: thirdRaw, ArtifactChannelID: thirdChannel, BindingGeneration: 7, ArtifactSequence: 3, ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()},
		{ArtifactJSON: fourthRaw, ArtifactChannelID: fourthChannel, BindingGeneration: 7, ArtifactSequence: 4, ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()},
	})
	caller := &controlPoolTestCaller{topUpResponseFactory: response, ackResponse: json.RawMessage(`{"ok":true}`)}
	if err := a.maintainControlArtifactPool(context.Background(), caller); err != nil {
		t.Fatal(err)
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ControlArtifactPool == nil || loaded.ControlArtifactPool.PendingTopUp != nil {
		t.Fatalf("pool after acknowledged top-up = %#v", loaded.ControlArtifactPool)
	}
	if len(loaded.ControlArtifactPool.Entries) != 4 || loaded.ControlArtifactPool.RecoveryState != config.ControlArtifactRecoveryReady {
		t.Fatalf("pool after top-up = %#v", loaded.ControlArtifactPool)
	}
	if len(caller.calls) != 2 || caller.calls[0] != controlRPCTypeControlPoolTopUp || caller.calls[1] != controlRPCTypeControlPoolAck {
		t.Fatalf("control pool calls = %#v", caller.calls)
	}

	// A lost response leaves one pending request; retrying uses the same ID.
	secondPath := filepath.Join(t.TempDir(), "config.json")
	secondCfg := poolTestConfig(secondPath, []config.ControlArtifactEntry{{Sequence: 1, ArtifactDigest: firstDigest, ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix(), Spent: true}, {Sequence: 2, ArtifactJSON: secondRaw, ArtifactDigest: secondDigest, ChannelID: "second-channel", ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()}})
	if err := config.Save(secondPath, secondCfg); err != nil {
		t.Fatal(err)
	}
	secondAgent := &Agent{cfg: secondCfg, configPath: secondPath, stateDir: t.TempDir()}
	replayingCaller := &controlPoolTestCaller{topUpResponseFactory: response, ackResponse: json.RawMessage(`{"ok":true}`), topUpError: errors.New("response lost")}
	if err := secondAgent.maintainControlArtifactPool(context.Background(), replayingCaller); err == nil {
		t.Fatal("lost top-up response was reported successful")
	}
	pendingCfg, err := config.Load(secondPath)
	if err != nil || pendingCfg.ControlArtifactPool == nil || pendingCfg.ControlArtifactPool.PendingTopUp == nil {
		t.Fatalf("pending top-up was not persisted: cfg=%#v err=%v", pendingCfg, err)
	}
	requestID := pendingCfg.ControlArtifactPool.PendingTopUp.RequestIDB64u
	replayingCaller.topUpError = nil
	if err := secondAgent.maintainControlArtifactPool(context.Background(), replayingCaller); err != nil {
		t.Fatal("replayed top-up:", err)
	}
	if len(replayingCaller.requestIDs) < 2 || replayingCaller.requestIDs[0] != requestID || replayingCaller.requestIDs[1] != requestID {
		t.Fatalf("top-up request IDs = %#v, want replayed %q", replayingCaller.requestIDs, requestID)
	}
}

func TestControlArtifactPoolAckLossKeepsAppliedResponse(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	firstRaw, _ := issuePoolTestArtifact(t, "first-ack")
	secondRaw, _ := issuePoolTestArtifact(t, "second-ack")
	thirdRaw, thirdChannel := issuePoolTestArtifact(t, "third-ack")
	cfg := poolTestConfig(path, []config.ControlArtifactEntry{{Sequence: 1, ArtifactDigest: digestB64uForTest(firstRaw), ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix(), Spent: true}, {Sequence: 2, ArtifactJSON: secondRaw, ArtifactDigest: digestB64uForTest(secondRaw), ChannelID: "second-ack-channel", ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()}})
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: cfg, configPath: path, stateDir: t.TempDir()}
	response := makeControlPoolResponse(t, 7, "binding-1", []poolTestWireEntry{{ArtifactJSON: thirdRaw, ArtifactChannelID: thirdChannel, BindingGeneration: 7, ArtifactSequence: 3, ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()}})
	caller := &controlPoolTestCaller{topUpResponseFactory: response, ackResponse: json.RawMessage(`{"ok":true}`), ackError: errors.New("ack lost")}
	if err := a.maintainControlArtifactPool(context.Background(), caller); err == nil {
		t.Fatal("lost ACK was reported successful")
	}
	intermediate, err := config.Load(path)
	if err != nil || intermediate.ControlArtifactPool == nil || intermediate.ControlArtifactPool.PendingTopUp == nil || intermediate.ControlArtifactPool.PendingTopUp.State != config.ControlArtifactTopUpApplied {
		t.Fatalf("applied response was not retained: %#v err=%v", intermediate, err)
	}
	caller.ackError = nil
	if err := a.maintainControlArtifactPool(context.Background(), caller); err != nil {
		t.Fatal("ACK replay:", err)
	}
	if len(caller.calls) != 3 || caller.calls[2] != controlRPCTypeControlPoolAck {
		t.Fatalf("ACK replay calls = %#v", caller.calls)
	}
}

func TestControlArtifactPoolRejectsInvalidResponseAndRequiresRelink(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	firstRaw, _ := issuePoolTestArtifact(t, "invalid-first")
	secondRaw, _ := issuePoolTestArtifact(t, "invalid-second")
	cfg := poolTestConfig(path, []config.ControlArtifactEntry{{Sequence: 1, ArtifactDigest: digestB64uForTest(firstRaw), ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix(), Spent: true}, {Sequence: 2, ArtifactJSON: secondRaw, ArtifactDigest: digestB64uForTest(secondRaw), ChannelID: "invalid-second-channel", ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()}})
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: cfg, configPath: path, stateDir: t.TempDir()}
	caller := &controlPoolTestCaller{
		topUpResponseFactory: func(requestID string) json.RawMessage {
			encoded, _ := json.Marshal(controlArtifactPoolTopUpResponse{
				TopUpRequestIDB64u: requestID,
				Pool: controlArtifactPoolWire{
					Version: config.ControlArtifactPoolContractVersion, LogicalProviderBindingID: "binding-1",
					BindingGeneration: 7, TargetWaterline: config.ControlArtifactTargetWaterline,
					RefreshHorizonSeconds: config.ControlArtifactRefreshHorizonS, ServerHighestArtifactSequence: 2,
					Entries:            []controlArtifactPoolWireEntry{},
					ResponseDigestB64u: "bad",
				},
			})
			return encoded
		},
		ackResponse: json.RawMessage(`{"ok":true}`),
	}
	if err := a.maintainControlArtifactPool(context.Background(), caller); err == nil {
		t.Fatal("invalid top-up response was accepted")
	}
	loaded, err := config.Load(path)
	if err != nil || loaded.ControlArtifactPool == nil || loaded.ControlArtifactPool.PendingTopUp == nil || loaded.ControlArtifactPool.PendingTopUp.State != config.ControlArtifactTopUpTerminal || loaded.ControlArtifactPool.RecoveryState != config.ControlArtifactRecoveryRelink {
		t.Fatalf("invalid response did not produce relink tombstone: %#v err=%v", loaded, err)
	}
}

func TestControlArtifactPoolExpiredTopUpCreatesFreshRequest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	firstRaw, _ := issuePoolTestArtifact(t, "expired-first")
	secondRaw, _ := issuePoolTestArtifact(t, "expired-second")
	thirdRaw, thirdChannel := issuePoolTestArtifact(t, "expired-third")
	fourthRaw, fourthChannel := issuePoolTestArtifact(t, "expired-fourth")
	cfg := poolTestConfig(path, []config.ControlArtifactEntry{
		{Sequence: 1, ArtifactDigest: digestB64uForTest(firstRaw), ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix(), Spent: true},
		{Sequence: 2, ArtifactJSON: secondRaw, ArtifactDigest: digestB64uForTest(secondRaw), ChannelID: "expired-second-channel", ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()},
	})
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: cfg, configPath: path, stateDir: t.TempDir()}
	caller := &controlPoolTestCaller{topUpError: &flowersec.RPCError{Code: 409, Message: config.ControlArtifactTopUpExpired}}
	if err := a.maintainControlArtifactPool(context.Background(), caller); err == nil {
		t.Fatal("expired top-up was reported successful")
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ControlArtifactPool.PendingTopUp != nil || loaded.ControlArtifactPool.LastTerminalTopUp == nil {
		t.Fatalf("expired top-up did not converge to a tombstone: %#v", loaded.ControlArtifactPool)
	}
	firstRequestID := loaded.ControlArtifactPool.LastTerminalTopUp.RequestIDB64u
	if loaded.ControlArtifactPool.LastTerminalTopUp.Reason != config.ControlArtifactTopUpExpired {
		t.Fatalf("terminal reason = %q", loaded.ControlArtifactPool.LastTerminalTopUp.Reason)
	}
	caller.topUpError = nil
	caller.topUpResponseFactory = makeControlPoolResponse(t, 7, "binding-1", []poolTestWireEntry{
		{ArtifactJSON: thirdRaw, ArtifactChannelID: thirdChannel, BindingGeneration: 7, ArtifactSequence: 5, ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()},
		{ArtifactJSON: fourthRaw, ArtifactChannelID: fourthChannel, BindingGeneration: 7, ArtifactSequence: 6, ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()},
	})
	caller.ackResponse = json.RawMessage(`{"ok":true}`)
	if err := a.maintainControlArtifactPool(context.Background(), caller); err != nil {
		t.Fatal(err)
	}
	if len(caller.requestIDs) != 2 || caller.requestIDs[0] != firstRequestID || caller.requestIDs[1] == firstRequestID {
		t.Fatalf("top-up request IDs = %#v, want a fresh ID after %q", caller.requestIDs, firstRequestID)
	}
	recovered, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := highestControlArtifactSequence(recovered.ControlArtifactPool.Entries); got != 6 {
		t.Fatalf("highest recovered sequence = %d, want authenticated server waterline 6", got)
	}
}

func TestControlArtifactPoolRelinkRequiredTopUpBecomesTerminal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	firstRaw, _ := issuePoolTestArtifact(t, "relink-first")
	secondRaw, _ := issuePoolTestArtifact(t, "relink-second")
	cfg := poolTestConfig(path, []config.ControlArtifactEntry{
		{Sequence: 1, ArtifactDigest: digestB64uForTest(firstRaw), ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix(), Spent: true},
		{Sequence: 2, ArtifactJSON: secondRaw, ArtifactDigest: digestB64uForTest(secondRaw), ChannelID: "relink-second-channel", ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()},
	})
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: cfg, configPath: path, stateDir: t.TempDir()}
	caller := &controlPoolTestCaller{
		topUpError: &flowersec.RPCError{Code: 409, Message: config.ControlArtifactTopUpRelink},
	}

	if err := a.maintainControlArtifactPool(context.Background(), caller); err == nil {
		t.Fatal("relink-required top-up was reported successful")
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ControlArtifactPool == nil || loaded.ControlArtifactPool.PendingTopUp == nil {
		t.Fatalf("terminal top-up was not persisted: %#v", loaded.ControlArtifactPool)
	}
	if loaded.ControlArtifactPool.PendingTopUp.State != config.ControlArtifactTopUpTerminal ||
		loaded.ControlArtifactPool.RecoveryState != config.ControlArtifactRecoveryRelink {
		t.Fatalf("relink-required top-up did not converge: %#v", loaded.ControlArtifactPool)
	}
	if _, _, err := a.acquireControlArtifactEntry(); !errors.Is(err, errControlArtifactPoolRelinkRequired) {
		t.Fatalf("Acquire() after terminal relink = %v, want relink-required rejection", err)
	}

	replayed := &controlPoolTestCaller{}
	if err := a.maintainControlArtifactPool(context.Background(), replayed); err == nil {
		t.Fatal("terminal top-up did not continue to require relink")
	}
	if len(replayed.calls) != 0 {
		t.Fatalf("terminal top-up was retried: %#v", replayed.calls)
	}
}

func TestControlArtifactPoolExpiredAckClearsAppliedPending(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	firstRaw, _ := issuePoolTestArtifact(t, "expired-ack-first")
	secondRaw, _ := issuePoolTestArtifact(t, "expired-ack-second")
	thirdRaw, thirdChannel := issuePoolTestArtifact(t, "expired-ack-third")
	cfg := poolTestConfig(path, []config.ControlArtifactEntry{
		{Sequence: 1, ArtifactDigest: digestB64uForTest(firstRaw), ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix(), Spent: true},
		{Sequence: 2, ArtifactJSON: secondRaw, ArtifactDigest: digestB64uForTest(secondRaw), ChannelID: "expired-ack-second-channel", ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix()},
	})
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: cfg, configPath: path, stateDir: t.TempDir()}
	response := makeControlPoolResponse(t, 7, "binding-1", []poolTestWireEntry{{
		ArtifactJSON: thirdRaw, ArtifactChannelID: thirdChannel, BindingGeneration: 7, ArtifactSequence: 3, ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix(),
	}})
	caller := &controlPoolTestCaller{
		topUpResponseFactory: response,
		ackError:             &flowersec.RPCError{Code: 409, Message: config.ControlArtifactTopUpExpired},
	}
	if err := a.maintainControlArtifactPool(context.Background(), caller); err == nil {
		t.Fatal("expired ACK was reported successful")
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ControlArtifactPool.PendingTopUp != nil || loaded.ControlArtifactPool.LastTerminalTopUp == nil ||
		loaded.ControlArtifactPool.LastTerminalTopUp.RequestIDB64u != caller.requestIDs[0] {
		t.Fatalf("expired ACK did not clear the applied pending request: %#v", loaded.ControlArtifactPool)
	}
}

func TestCompactControlArtifactEntriesNeverDropsUsableEntry(t *testing.T) {
	entries := make([]config.ControlArtifactEntry, 0, config.ControlArtifactMaxPoolEntries+1)
	for sequence := 1; sequence <= config.ControlArtifactMaxPoolEntries+1; sequence++ {
		entries = append(entries, config.ControlArtifactEntry{
			Sequence:       uint64(sequence),
			ArtifactJSON:   json.RawMessage(`{"v":2}`),
			ArtifactDigest: "digest",
			ChannelID:      "channel",
			ExpiresAtUnixS: time.Now().Add(time.Minute).Unix(),
		})
	}
	compacted := compactControlArtifactEntries(entries)
	if len(compacted) != len(entries) {
		t.Fatalf("usable entries were compacted: got %d, want %d", len(compacted), len(entries))
	}
	for index := range entries {
		if compacted[index].Sequence != entries[index].Sequence {
			t.Fatalf("entry %d changed from sequence %d to %d", index, entries[index].Sequence, compacted[index].Sequence)
		}
	}
}

func TestControlArtifactPoolTopUpResponseBindsPendingRequestBeforeApply(t *testing.T) {
	requestID := digestB64uForTest([]byte("pending-request"))
	otherRequestID := digestB64uForTest([]byte("other-request"))
	pending := &config.ControlArtifactPendingTopUp{
		RequestIDB64u: requestID, BindingGeneration: 7, State: config.ControlArtifactTopUpPending,
	}
	current := &config.ControlArtifactPool{
		SchemaVersion: config.ControlArtifactPoolSchemaVersion, LogicalBindingID: "binding-1",
		TargetWaterline: config.ControlArtifactTargetWaterline, RefreshHorizonSeconds: config.ControlArtifactRefreshHorizonS,
		BindingGeneration: 7, RecoveryState: config.ControlArtifactRecoveryDegraded, PendingTopUp: pending,
	}
	responseBytes := makeControlPoolResponse(t, 7, "binding-1", nil)(otherRequestID)
	response, err := validateControlArtifactPoolTopUpResponse(responseBytes, current, pending, time.Now())
	if err == nil {
		t.Fatal("top-up response for another pending request was accepted")
	}
	whitespaceResponse := makeControlPoolResponse(t, 7, "binding-1", nil)(" " + requestID)
	if _, err := validateControlArtifactPoolTopUpResponse(whitespaceResponse, current, pending, time.Now()); err == nil {
		t.Fatal("top-up response with a non-canonical request id was accepted")
	}
	invalidPending := *pending
	invalidPending.RequestIDB64u = " " + requestID
	invalidPool := *current
	invalidPool.PendingTopUp = &invalidPending
	if err := invalidPool.Validate(time.Now().Unix()); err == nil {
		t.Fatal("persisted non-canonical top-up request id was accepted")
	}

	path := filepath.Join(t.TempDir(), "config.json")
	cfg := poolTestConfig(path, nil)
	cfg.ControlArtifactPool.PendingTopUp = pending
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	a := &Agent{cfg: cfg, configPath: path, stateDir: t.TempDir()}
	if err := a.applyControlArtifactTopUp(pending, response); err == nil {
		t.Fatal("top-up response request changed before commit was accepted")
	}
	loaded, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ControlArtifactPool == nil || loaded.ControlArtifactPool.PendingTopUp == nil ||
		loaded.ControlArtifactPool.PendingTopUp.RequestIDB64u != requestID || len(loaded.ControlArtifactPool.Entries) != 0 {
		t.Fatalf("mismatched response changed persisted pool: %#v", loaded.ControlArtifactPool)
	}
}

func TestControlArtifactPoolTopUpGoldenFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "spec", "fixtures", "rcpp-v2", "control_artifact_pool_top_up_v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture controlArtifactPoolTopUpResponse
	if err := decodeExactControlJSON(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	pending := &config.ControlArtifactPendingTopUp{
		RequestIDB64u: fixture.TopUpRequestIDB64u, BindingGeneration: fixture.Pool.BindingGeneration, State: config.ControlArtifactTopUpPending,
	}
	current := &config.ControlArtifactPool{
		SchemaVersion: config.ControlArtifactPoolSchemaVersion, LogicalBindingID: fixture.Pool.LogicalProviderBindingID,
		TargetWaterline: fixture.Pool.TargetWaterline, RefreshHorizonSeconds: fixture.Pool.RefreshHorizonSeconds,
		BindingGeneration: fixture.Pool.BindingGeneration, RecoveryState: config.ControlArtifactRecoveryDegraded, PendingTopUp: pending,
	}
	if _, err := validateControlArtifactPoolTopUpResponse(raw, current, pending, time.Unix(0, 0)); err != nil {
		t.Fatal("golden top-up response:", err)
	}
	mutated := fixture
	mutated.TopUpRequestIDB64u = digestB64uForTest([]byte("different-request"))
	mutatedRaw, err := json.Marshal(mutated)
	if err != nil {
		t.Fatal(err)
	}
	mutatedPending := *pending
	mutatedPending.RequestIDB64u = mutated.TopUpRequestIDB64u
	if _, err := validateControlArtifactPoolTopUpResponse(mutatedRaw, current, &mutatedPending, time.Unix(0, 0)); err == nil {
		t.Fatal("top-up request id changed without changing the response digest")
	}
}

type poolTestWireEntry struct {
	ArtifactJSON      json.RawMessage
	ArtifactChannelID string
	BindingGeneration int64
	ArtifactSequence  uint64
	ExpiresAtUnixS    int64
}

func makeControlPoolResponse(t *testing.T, generation int64, bindingID string, entries []poolTestWireEntry) func(requestID string) json.RawMessage {
	t.Helper()
	wireEntries := make([]controlArtifactPoolWireEntry, 0, len(entries))
	serverHighest := uint64(config.ControlArtifactTargetWaterline)
	for _, entry := range entries {
		wireEntries = append(wireEntries, controlArtifactPoolWireEntry(entry))
		serverHighest = entry.ArtifactSequence
	}
	return func(requestID string) json.RawMessage {
		response := controlArtifactPoolTopUpResponse{
			TopUpRequestIDB64u: requestID,
			Pool: controlArtifactPoolWire{
				Version: config.ControlArtifactPoolContractVersion, LogicalProviderBindingID: bindingID,
				BindingGeneration: generation, TargetWaterline: config.ControlArtifactTargetWaterline,
				RefreshHorizonSeconds:         config.ControlArtifactRefreshHorizonS,
				ServerHighestArtifactSequence: serverHighest, Entries: wireEntries,
			},
		}
		unsigned, err := json.Marshal(response)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(unsigned)
		response.Pool.ResponseDigestB64u = base64.RawURLEncoding.EncodeToString(digest[:])
		encoded, err := json.Marshal(response)
		if err != nil {
			t.Fatal(err)
		}
		return encoded
	}
}

func issuePoolTestArtifact(t *testing.T, suffix string) (json.RawMessage, string) {
	t.Helper()
	endpoints, err := flowercontrol.NewEndpointSet("wss://example.com/flowersec/v2/direct")
	if err != nil {
		t.Fatal(err)
	}
	issued, err := flowercontrol.NewIssuer().IssueDirect(flowercontrol.DirectIssueOptions{
		Session:   flowercontrol.SessionOptions{ChannelID: "pool-" + suffix + "-" + time.Now().Format("150405.000000000"), ExpiresAt: time.Now().Add(4 * time.Minute)},
		Endpoints: endpoints, RendezvousGroupID: "pool-test", ListenerAudience: "redeven", UpstreamAddress: "127.0.0.1:1",
	})
	if err != nil {
		t.Fatal(err)
	}
	return issued.ArtifactJSON(), suffix + "-channel"
}

func poolTestConfig(path string, entries []config.ControlArtifactEntry) *config.Config {
	return &config.Config{
		ProviderOrigin: "https://redeven.test", ControlplaneBaseURL: "https://control.test", EnvironmentID: "env-1", LocalEnvironmentPublicID: "local-1", BindingGeneration: 7, AgentInstanceID: "agent-1",
		ControlArtifactPool: &config.ControlArtifactPool{SchemaVersion: config.ControlArtifactPoolSchemaVersion, LogicalBindingID: "binding-1", TargetWaterline: config.ControlArtifactTargetWaterline, RefreshHorizonSeconds: config.ControlArtifactRefreshHorizonS, BindingGeneration: 7, RecoveryState: config.ControlArtifactRecoveryDegraded, Entries: entries},
	}
}

func digestB64uForTest(value []byte) string {
	digest := sha256.Sum256(value)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func mustJSON(value any) []byte {
	encoded, _ := json.Marshal(value)
	return encoded
}
