package ai

import "testing"

func TestBrowserPopupCannotExpandExternalGrants(t *testing.T) {
	for _, mode := range []string{"cdp", "extension"} {
		t.Run(mode, func(t *testing.T) {
			runtime := &ComputerUseRuntime{executors: map[string]TargetToolExecutor{}}
			if mode == "extension" {
				runtime.executors["source"] = &extensionTargetExecutor{}
			} else {
				runtime.executors["source"] = &PlaywrightTargetExecutor{}
			}
			if err := runtime.admitManagedBrowserPopup(t.Context(), browserHostEvent{Target: "source", TabID: "popup"}); err == nil {
				t.Fatal("popup bypassed its explicit source boundary")
			}
		})
	}
}
