package codexbridge

import "testing"

func TestCloneItem_ClonesUserInputTextElements(t *testing.T) {
	t.Parallel()

	original := Item{
		ID:   "item_1",
		Type: "userMessage",
		Inputs: []UserInputEntry{
			{
				Type: "text",
				Text: "raw text",
				TextElements: []TextElement{
					{Start: 0, End: 8, Placeholder: "@repo"},
				},
			},
		},
	}

	cloned := cloneItem(original)
	cloned.Inputs[0].TextElements[0].Placeholder = "@changed"

	if original.Inputs[0].TextElements[0].Placeholder != "@repo" {
		t.Fatalf("original placeholder mutated: %q", original.Inputs[0].TextElements[0].Placeholder)
	}
}
