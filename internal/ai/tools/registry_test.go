package tools

import "testing"

func TestBuiltInDefinitions_AllHaveValidPresentationSpecs(t *testing.T) {
	t.Parallel()

	for name, def := range builtinDefinitions {
		if err := ValidatePresentationSpec(name, def.Presentation); err != nil {
			t.Fatalf("builtin %s presentation spec invalid: %v", name, err)
		}
		if def.Name != name {
			t.Fatalf("builtin key=%q has definition name=%q", name, def.Name)
		}
	}
}

func TestMustPresentationSpec_PanicsForUnknownTool(t *testing.T) {
	t.Parallel()

	defer func() {
		if recover() == nil {
			t.Fatalf("MustPresentationSpec did not panic for unknown tool")
		}
	}()
	_ = MustPresentationSpec("unknown.tool")
}
