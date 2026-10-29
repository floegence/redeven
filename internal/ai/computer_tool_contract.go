package ai

// Selection gives the core signatures once. Extensions are available through ui.help.
func computerTargetContract(target TargetDescriptor) map[string]any {
	browser := computerBrowserTarget(target.Kind)
	guide, _ := computerScriptHelp("core", browser)
	return map[string]any{"version": 2, "backend": target.Kind, "browser_methods": browser, "image_coordinates": browser || target.Kind == "desktop.window", "documentation": guide, "help_topics": []string{"read", "visual", "downloads"}, "unknown_effect_replay": false}
}
