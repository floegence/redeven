package ai

import (
	"context"
	"errors"
	"fmt"
	"testing"

	flruntime "github.com/floegence/floret/v2/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

type exactTurnReadTestHost struct {
	floretThreadReadHost
	read          func(flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error)
	exactRequests []flruntime.TurnID
	listRequests  []flruntime.ThreadTurnsRequest
}

func (h *exactTurnReadTestHost) ReadThreadTurn(_ context.Context, turnID flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
	h.exactRequests = append(h.exactRequests, turnID)
	return h.read(turnID)
}

func (h *exactTurnReadTestHost) ListThreadTurns(_ context.Context, req flruntime.ThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	h.listRequests = append(h.listRequests, req)
	return flruntime.ThreadTurnsPage{}, errors.New("unexpected canonical history scan")
}

func bindExactTurnReadTestHost(svc *Service, threadID string, host floretThreadReadHost) {
	svc.floretReads = &floretReadCapabilities{thread: func(_ context.Context, got flruntime.ThreadID) (floretThreadReadHost, error) {
		if string(got) != threadID {
			return nil, fmt.Errorf("unexpected thread %q", got)
		}
		return host, nil
	}}
}

func seedPendingTurnCommands(t *testing.T, svc *Service, threadID string, count int) []threadstore.QueuedTurn {
	t.Helper()
	meta := testSendTurnMeta()
	commands := make([]threadstore.QueuedTurn, 0, count)
	for index := 0; index < count; index++ {
		commands = append(commands, createPendingCommandForTest(
			t, svc, meta, threadID,
			fmt.Sprintf("command_%04d", index),
			fmt.Sprintf("turn_%04d", index),
			fmt.Sprintf("run_%04d", index),
		))
	}
	return commands
}

func listPendingTurnCommandsAfter(t *testing.T, store *threadstore.Store, endpointID, threadID string) []threadstore.QueuedTurn {
	t.Helper()
	var out []threadstore.QueuedTurn
	var afterSortIndex int64
	var afterQueueID string
	for {
		page, err := store.ListFollowupsByLaneAfter(t.Context(), endpointID, threadID, threadstore.FollowupLaneQueued, afterSortIndex, afterQueueID, 500)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, page...)
		if len(page) < 500 {
			return out
		}
		afterSortIndex = page[len(page)-1].SortIndex
		afterQueueID = page[len(page)-1].QueueID
	}
}

func TestFloretThreadContainsTurnUsesOneExactReadAndFailsClosed(t *testing.T) {
	canonicalErr := errors.New("canonical authority corrupt")
	for _, testCase := range []struct {
		name      string
		read      func(flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error)
		want      bool
		wantError error
	}{
		{name: "present", read: func(turnID flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
			return flruntime.ThreadTurnSnapshot{TurnID: turnID}, nil
		}, want: true},
		{name: "absent", read: func(flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
			return flruntime.ThreadTurnSnapshot{}, fmt.Errorf("missing: %w", flruntime.ErrTurnNotFound)
		}},
		{name: "corrupt", read: func(flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
			return flruntime.ThreadTurnSnapshot{}, canonicalErr
		}, wantError: canonicalErr},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			host := &exactTurnReadTestHost{read: testCase.read}
			got, err := floretThreadContainsTurn(t.Context(), host, "thread_exact", "turn_exact")
			if got != testCase.want || !errors.Is(err, testCase.wantError) {
				t.Fatalf("contains=%v err=%v, want=%v err=%v", got, err, testCase.want, testCase.wantError)
			}
			if len(host.exactRequests) != 1 || host.exactRequests[0] != "turn_exact" || len(host.listRequests) != 0 {
				t.Fatalf("exact requests=%#v list requests=%#v", host.exactRequests, host.listRequests)
			}
		})
	}
}

func TestCanonicalPendingTurnReconciliationExhaustsKeysetPagesAndIsIdempotent(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "lifecycle reconciliation", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	commands := seedPendingTurnCommands(t, svc, thread.ThreadID, 501)
	accepted := make(map[flruntime.TurnID]struct{}, 251)
	for index, command := range commands {
		if index%2 == 0 {
			accepted[flruntime.TurnID(command.TurnID)] = struct{}{}
		}
	}
	host := &exactTurnReadTestHost{read: func(turnID flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
		if _, ok := accepted[turnID]; ok {
			return flruntime.ThreadTurnSnapshot{TurnID: turnID}, nil
		}
		return flruntime.ThreadTurnSnapshot{}, flruntime.ErrTurnNotFound
	}}
	bindExactTurnReadTestHost(svc, thread.ThreadID, host)

	if err := svc.reconcileCanonicalPendingTurnCommands(t.Context(), meta.EndpointID, thread.ThreadID, svc.threadsDB); err != nil {
		t.Fatal(err)
	}
	remaining := listPendingTurnCommandsAfter(t, svc.threadsDB, meta.EndpointID, thread.ThreadID)
	if len(remaining) != 250 || len(host.exactRequests) != 501 || len(host.listRequests) != 0 {
		t.Fatalf("remaining=%d exact=%d list=%d", len(remaining), len(host.exactRequests), len(host.listRequests))
	}
	for _, command := range remaining {
		if command.AdmissionState != threadstore.PendingTurnAdmissionInFlight {
			t.Fatalf("missing canonical turn changed command %#v", command)
		}
	}

	if err := svc.reconcileCanonicalPendingTurnCommands(t.Context(), meta.EndpointID, thread.ThreadID, svc.threadsDB); err != nil {
		t.Fatal(err)
	}
	if got := listPendingTurnCommandsAfter(t, svc.threadsDB, meta.EndpointID, thread.ThreadID); len(got) != 250 || len(host.exactRequests) != 751 {
		t.Fatalf("idempotent retry remaining=%d exact=%d", len(got), len(host.exactRequests))
	}
}

func TestStartupPendingTurnReconciliationExhaustsKeysetPages(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "startup reconciliation", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	commands := seedPendingTurnCommands(t, svc, thread.ThreadID, 501)
	acceptedTurnID := flruntime.TurnID(commands[0].TurnID)
	host := &exactTurnReadTestHost{read: func(turnID flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
		if turnID == acceptedTurnID {
			return flruntime.ThreadTurnSnapshot{TurnID: turnID}, nil
		}
		return flruntime.ThreadTurnSnapshot{}, flruntime.ErrTurnNotFound
	}}
	bindExactTurnReadTestHost(svc, thread.ThreadID, host)

	if err := svc.reconcileStartupPendingTurnCommands(t.Context(), meta.EndpointID, thread.ThreadID, svc.threadsDB); err != nil {
		t.Fatal(err)
	}
	remaining := listPendingTurnCommandsAfter(t, svc.threadsDB, meta.EndpointID, thread.ThreadID)
	if len(remaining) != 500 || len(host.exactRequests) != 501 || len(host.listRequests) != 0 {
		t.Fatalf("remaining=%d exact=%d list=%d", len(remaining), len(host.exactRequests), len(host.listRequests))
	}
	for _, command := range remaining {
		if command.AdmissionState != threadstore.PendingTurnAdmissionReady {
			t.Fatalf("startup did not release command %#v", command)
		}
	}
}

func TestStartupPendingTurnReconciliationResumesAfterPartialFailure(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "partial startup reconciliation", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	commands := seedPendingTurnCommands(t, svc, thread.ThreadID, 3)
	canonicalErr := errors.New("canonical authority corrupt")
	host := &exactTurnReadTestHost{read: func(turnID flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
		switch turnID {
		case flruntime.TurnID(commands[0].TurnID):
			return flruntime.ThreadTurnSnapshot{TurnID: turnID}, nil
		case flruntime.TurnID(commands[1].TurnID):
			return flruntime.ThreadTurnSnapshot{}, canonicalErr
		default:
			return flruntime.ThreadTurnSnapshot{}, flruntime.ErrTurnNotFound
		}
	}}
	bindExactTurnReadTestHost(svc, thread.ThreadID, host)

	err = svc.reconcileStartupPendingTurnCommands(t.Context(), meta.EndpointID, thread.ThreadID, svc.threadsDB)
	if !errors.Is(err, canonicalErr) {
		t.Fatalf("error=%v, want %v", err, canonicalErr)
	}
	remaining := listPendingTurnCommandsAfter(t, svc.threadsDB, meta.EndpointID, thread.ThreadID)
	if len(remaining) != 2 || remaining[0].AdmissionState != threadstore.PendingTurnAdmissionInFlight || remaining[1].AdmissionState != threadstore.PendingTurnAdmissionInFlight {
		t.Fatalf("partial progress=%#v", remaining)
	}

	host.read = func(flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
		return flruntime.ThreadTurnSnapshot{}, flruntime.ErrTurnNotFound
	}
	if err := svc.reconcileStartupPendingTurnCommands(t.Context(), meta.EndpointID, thread.ThreadID, svc.threadsDB); err != nil {
		t.Fatal(err)
	}
	remaining = listPendingTurnCommandsAfter(t, svc.threadsDB, meta.EndpointID, thread.ThreadID)
	if len(remaining) != 2 || remaining[0].AdmissionState != threadstore.PendingTurnAdmissionReady || remaining[1].AdmissionState != threadstore.PendingTurnAdmissionReady {
		t.Fatalf("resumed progress=%#v", remaining)
	}
}

func TestCanonicalReadFailureBlocksForkAndDeleteIntents(t *testing.T) {
	for _, operation := range []string{"fork", "delete"} {
		t.Run(operation, func(t *testing.T) {
			svc := newSendTurnTestService(t)
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "canonical read failure", "", "", "")
			if err != nil {
				t.Fatal(err)
			}
			seedPendingTurnCommands(t, svc, thread.ThreadID, 1)
			realReadHost, err := svc.openFloretThreadReadHost(t.Context(), thread.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			canonicalErr := errors.New("canonical authority corrupt")
			host := &exactTurnReadTestHost{
				floretThreadReadHost: realReadHost,
				read: func(flruntime.TurnID) (flruntime.ThreadTurnSnapshot, error) {
					return flruntime.ThreadTurnSnapshot{}, canonicalErr
				},
			}
			bindExactTurnReadTestHost(svc, thread.ThreadID, host)

			switch operation {
			case "fork":
				if _, err := svc.ForkThread(t.Context(), meta, thread.ThreadID, "must not fork"); !errors.Is(err, canonicalErr) {
					t.Fatalf("fork error=%v, want %v", err, canonicalErr)
				}
				operations, err := svc.threadsDB.ListPendingForkOperations(t.Context(), 10)
				if err != nil || len(operations) != 0 {
					t.Fatalf("fork operations=%#v err=%v", operations, err)
				}
			case "delete":
				if _, err := svc.DeleteThread(t.Context(), meta, thread.ThreadID, true); !errors.Is(err, canonicalErr) {
					t.Fatalf("delete error=%v, want %v", err, canonicalErr)
				}
				intent, err := svc.threadsDB.GetThreadDeleteOperation(t.Context(), meta.EndpointID, thread.ThreadID)
				if err != nil || intent != nil {
					t.Fatalf("delete intent=%#v err=%v", intent, err)
				}
			}
			if len(host.exactRequests) != 1 || len(host.listRequests) != 0 {
				t.Fatalf("exact requests=%#v list requests=%#v", host.exactRequests, host.listRequests)
			}
		})
	}
}
