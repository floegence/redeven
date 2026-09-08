package ai

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestForkPublishesNamedDestinationAndReplaysWithoutDuplicates(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Source", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	nextFlowerLiveStreamFrame(t, first)
	nextFlowerLiveStreamFrame(t, second)
	input := ForkThreadRequest{ClientRequestID: "fork-visible", Title: "Source · Fork"}
	forked, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, input)
	if err != nil {
		t.Fatal(err)
	}
	if forked.ThreadID == source.ThreadID || forked.Title != input.Title || forked.TitleStatus != "ready" {
		t.Fatalf("fork=%#v", forked)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	for _, subscription := range []*FlowerLiveStreamSubscription{first, second} {
		for {
			frame, err := subscription.Next(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var envelope FlowerLiveStreamEnvelope
			if err := json.Unmarshal(frame.Data, &envelope); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, summary := range envelope.Summaries {
				if summary.ThreadID == forked.ThreadID {
					if summary.Title != input.Title || summary.TitleStatus != "ready" {
						t.Fatalf("published fork=%#v", summary)
					}
					found = true
				}
			}
			if found {
				break
			}
		}
	}
	replayed, err := svc.ForkThreadWithOptions(t.Context(), meta, source.ThreadID, input)
	if err != nil || replayed.ThreadID != forked.ThreadID {
		t.Fatalf("replayed=%#v err=%v", replayed, err)
	}
	list, err := svc.ListThreads(t.Context(), meta, 100, "")
	if err != nil || len(list.Threads) != 2 {
		t.Fatalf("list=%#v err=%v", list, err)
	}
}
