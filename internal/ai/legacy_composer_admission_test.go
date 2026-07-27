package ai

import (
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestLegacyComposerAdmissionDecisionRequiresExactCanonicalAttachments(t *testing.T) {
	const turnID = "turn_legacy_admission"
	digestA := strings.Repeat("a", 64)
	digestB := strings.Repeat("b", 64)
	legacy := threadstore.LegacyComposerAdmission{
		TurnID: turnID,
		Attachments: []threadstore.LegacyComposerAttachment{
			{UploadID: "upl_aaaaaaaaaaaaaaaaaaaaaaaa", Name: "a.txt", DetectedMediaType: "text/plain", SizeBytes: 11, ContentSHA256: digestA},
			{UploadID: "upl_bbbbbbbbbbbbbbbbbbbbbbbb", Name: "b.txt", DetectedMediaType: "text/plain; charset=utf-8", SizeBytes: 12, ContentSHA256: digestB},
		},
	}
	exactTurn := flruntime.ThreadTurnSnapshot{
		TurnID: turnID,
		UserAttachments: []flruntime.MessageAttachment{
			{ResourceRef: "redeven-upload:v1:upl_aaaaaaaaaaaaaaaaaaaaaaaa:sha256:" + digestA, Name: "a.txt", MIMEType: "text/plain", SizeBytes: 11},
			{ResourceRef: "redeven-upload:v1:upl_bbbbbbbbbbbbbbbbbbbbbbbb:sha256:" + digestB, Name: "b.txt", MIMEType: "text/plain; charset=utf-8", SizeBytes: 12},
		},
	}
	decision, err := legacyComposerAdmissionDecisionFromCanonicalTurn(legacy, exactTurn)
	if err != nil {
		t.Fatal(err)
	}
	if decision.State != threadstore.LegacyComposerAdmissionAdmitted || len(decision.Attachments) != 2 || decision.Attachments[0].UploadID != legacy.Attachments[0].UploadID || decision.Attachments[1].UploadID != legacy.Attachments[1].UploadID {
		t.Fatalf("decision=%#v", decision)
	}

	cloneTurn := func() flruntime.ThreadTurnSnapshot {
		return flruntime.ThreadTurnSnapshot{
			TurnID:          exactTurn.TurnID,
			UserAttachments: append([]flruntime.MessageAttachment(nil), exactTurn.UserAttachments...),
		}
	}
	for _, testCase := range []struct {
		name   string
		mutate func(*flruntime.ThreadTurnSnapshot)
		want   string
	}{
		{name: "turn identity", mutate: func(turn *flruntime.ThreadTurnSnapshot) { turn.TurnID = "turn_other" }, want: "turn identity mismatch"},
		{name: "membership count", mutate: func(turn *flruntime.ThreadTurnSnapshot) { turn.UserAttachments = turn.UserAttachments[:1] }, want: "membership mismatch"},
		{name: "membership order", mutate: func(turn *flruntime.ThreadTurnSnapshot) {
			turn.UserAttachments[0], turn.UserAttachments[1] = turn.UserAttachments[1], turn.UserAttachments[0]
		}, want: "conflicts with product attachment"},
		{name: "legacy resource ref", mutate: func(turn *flruntime.ThreadTurnSnapshot) {
			turn.UserAttachments[0].ResourceRef = "redeven-upload:upl_aaaaaaaaaaaaaaaaaaaaaaaa"
		}, want: "invalid immutable identity"},
		{name: "missing digest", mutate: func(turn *flruntime.ThreadTurnSnapshot) {
			turn.UserAttachments[0].ResourceRef = "redeven-upload:v1:upl_aaaaaaaaaaaaaaaaaaaaaaaa"
		}, want: "invalid immutable identity"},
		{name: "name", mutate: func(turn *flruntime.ThreadTurnSnapshot) { turn.UserAttachments[0].Name = "changed.txt" }, want: "conflicts with product attachment"},
		{name: "MIME", mutate: func(turn *flruntime.ThreadTurnSnapshot) { turn.UserAttachments[0].MIMEType = "application/pdf" }, want: "conflicts with product attachment"},
		{name: "size", mutate: func(turn *flruntime.ThreadTurnSnapshot) { turn.UserAttachments[0].SizeBytes++ }, want: "conflicts with product attachment"},
		{name: "digest", mutate: func(turn *flruntime.ThreadTurnSnapshot) {
			turn.UserAttachments[0].ResourceRef = "redeven-upload:v1:upl_aaaaaaaaaaaaaaaaaaaaaaaa:sha256:" + digestB
		}, want: "conflicts with product attachment"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			turn := cloneTurn()
			testCase.mutate(&turn)
			_, err := legacyComposerAdmissionDecisionFromCanonicalTurn(legacy, turn)
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("error=%v, want %q", err, testCase.want)
			}
		})
	}
}
