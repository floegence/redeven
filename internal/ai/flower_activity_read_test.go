package ai

import (
	"context"
	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	"testing"
)

type flowerActivityReadRuntime struct {
	flruntime.ThreadService
	flruntime.ThreadFactsSource
	flruntime.ThreadSummaryReader
	structures []flruntime.ThreadActivityStructureInput
	fields     []flruntime.ThreadActivityFieldInput
}

func (r *flowerActivityReadRuntime) View(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
	panic("field request loaded full View")
}
func (r *flowerActivityReadRuntime) ActivityStructure(ctx context.Context, scope threadquery.Scope, input flruntime.ThreadActivityStructureInput) (flruntime.ThreadActivityStructurePage, error) {
	if err := ctx.Err(); err != nil {
		return flruntime.ThreadActivityStructurePage{}, err
	}
	if len(scope.ThreadIDs) != 1 || scope.ThreadIDs[0] != input.ThreadID || scope.Authority == "" {
		panic("missing fresh scope")
	}
	r.structures = append(r.structures, input)
	return flruntime.ThreadActivityStructurePage{ThreadID: input.ThreadID, ItemID: input.ItemID, Field: flruntime.ThreadActivityField{Path: input.Path, Kind: "string", Bytes: 10 << 20}}, nil
}
func (r *flowerActivityReadRuntime) ReadActivityField(ctx context.Context, scope threadquery.Scope, input flruntime.ThreadActivityFieldInput) (flruntime.ThreadActivityFieldChunk, error) {
	if err := ctx.Err(); err != nil {
		return flruntime.ThreadActivityFieldChunk{}, err
	}
	if len(scope.ThreadIDs) != 1 || scope.ThreadIDs[0] != input.ThreadID || scope.Authority == "" {
		panic("missing fresh scope")
	}
	r.fields = append(r.fields, input)
	return flruntime.ThreadActivityFieldChunk{ThreadID: input.ThreadID, Path: input.Path, OffsetBytes: input.OffsetBytes, Text: "🌸"}, nil
}
func TestFlowerActivityReadsAuthorizeEveryFieldWithoutFullView(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	runtime := &flowerActivityReadRuntime{ThreadService: svc.threadRuntime, ThreadFactsSource: svc.threadRuntime.(flruntime.ThreadFactsSource), ThreadSummaryReader: svc.threadRuntime.(flruntime.ThreadSummaryReader)}
	svc.threadRuntime = runtime
	if err := svc.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Field reading", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	structure := flruntime.ThreadActivityStructureInput{ThreadID: "untrusted", ItemID: "tool", Path: "/payload/output", Limit: 1}
	page, err := svc.GetFlowerActivityStructure(t.Context(), meta, thread.ThreadID, structure)
	if err != nil || page.ThreadID.String() != thread.ThreadID || len(runtime.structures) != 1 || len(runtime.fields) != 0 {
		t.Fatalf("structure: %+v %v", page, err)
	}
	field := flruntime.ThreadActivityFieldInput{ThreadID: "untrusted", ItemID: "tool", Path: structure.Path, OffsetBytes: 65536, LimitBytes: 16384, SourceID: "frozen", RunID: "run"}
	chunk, err := svc.GetFlowerActivityField(t.Context(), meta, thread.ThreadID, field)
	if err != nil || chunk.OffsetBytes != field.OffsetBytes || chunk.ThreadID.String() != thread.ThreadID || len(runtime.fields) != 1 {
		t.Fatalf("field: %+v %v", chunk, err)
	}
	foreign := *meta
	foreign.NamespacePublicID = "unrelated"
	if _, err := svc.GetFlowerActivityStructure(t.Context(), &foreign, thread.ThreadID, structure); err == nil {
		t.Fatal("foreign structure accepted")
	}
	if _, err := svc.GetFlowerActivityField(t.Context(), &foreign, thread.ThreadID, field); err == nil {
		t.Fatal("foreign field accepted")
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := svc.GetFlowerActivityField(canceled, meta, thread.ThreadID, field); err == nil {
		t.Fatal("canceled field accepted")
	}
	if len(runtime.structures) != 1 || len(runtime.fields) != 1 {
		t.Fatal("unauthorized request read canonical data")
	}
}
